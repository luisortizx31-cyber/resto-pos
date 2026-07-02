import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, rtdb, functions, auth } from '../lib/firebase'
import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import { ref, remove, get } from 'firebase/database'
import { httpsCallable } from 'firebase/functions'
import { onAuthStateChanged } from 'firebase/auth'
import { isSuperAdmin, clearSession } from '../lib/auth'

const gestionarAuthResto = httpsCallable(functions, 'gestionarAuthResto')
const adminListarRestos  = httpsCallable(functions, 'adminListarRestos')

const DEFAULT_FORM = { id:'', nombre:'', whatsapp:'', mesaCount:'10', delivery:true,
  pinMesero:'1111', pinCocina:'2222', pinDueno:'3333', pinRepartidor:'4444' }

export default function AdminPanel() {
  const [restos, setRestos]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('lista')
  const [form, setForm]         = useState(DEFAULT_FORM)
  const [editId, setEditId]     = useState(null)   // null = nuevo, string = editando
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [deleting, setDeleting] = useState(null)   // id del resto que se está borrando
  const navigate = useNavigate()

  useEffect(() => {
    if (!isSuperAdmin()) { navigate('/login'); return }
    // Esperar a que Firebase Auth restaure la sesión antes de llamar a
    // adminListarRestos (requiere request.auth con claim role=='superadmin')
    const unsub = onAuthStateChanged(auth, user => {
      if (!user) { navigate('/login'); return }
      loadRestos()
    })
    return () => unsub()
  }, [])

  const loadRestos = async () => {
    setLoading(true)
    try {
      const res = await adminListarRestos()
      setRestos(res.data.restos || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // ── Crear ────────────────────────────────────────────────────────
  const crearResto = async () => {
    const id = form.id.trim().toLowerCase().replace(/\s+/g, '-')
    if (!id || !form.nombre.trim()) { setMsg('Completa ID y nombre'); return }
    setSaving(true); setMsg('')
    try {
      await setDoc(doc(db, 'restaurantes', id), {
        nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim(),
        active: true, tieneDelivery: form.delivery,
        creadoEn: new Date().toISOString(),
      })
      await gestionarAuthResto({
        restoId: id, accion: 'adminCreate',
        payload: {
          nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim(),
          pins: { mesero: form.pinMesero, cocina: form.pinCocina,
                  dueno: form.pinDueno, repartidor: form.pinRepartidor },
          repartidores: [],
        },
      })
      await setDoc(doc(db, 'restaurantes', id, 'config', 'mesas'), {
        total: parseInt(form.mesaCount) || 10
      })
      await setDoc(doc(db, 'restaurantes', id, 'config', 'categorias'), {
        lista: ['Ceviches','Combinados','Bebidas','Guarniciones','Entradas','Postres','Otros']
      })
      await setDoc(doc(db, 'restaurantes', id, 'config', 'general'), {
        nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim(),
        moneda: 'S/', mesas: parseInt(form.mesaCount) || 10,
      })
      setMsg(`✅ Restaurante "${id}" creado correctamente`)
      setForm(DEFAULT_FORM)
      loadRestos()
    } catch (e) { setMsg('❌ Error: ' + e.message) }
    setSaving(false)
  }

  // ── Editar ───────────────────────────────────────────────────────
  const abrirEditar = (r) => {
    setEditId(r.id)
    setForm({
      id: r.id,
      nombre: r.nombre || '',
      whatsapp: r.whatsapp || '',
      mesaCount: String(r.mesaCount || 10),
      delivery: r.tieneDelivery !== false,
    })
    setMsg('')
    setTab('form')
  }

  const guardarEdicion = async () => {
    if (!form.nombre.trim()) { setMsg('Completa el nombre'); return }
    setSaving(true); setMsg('')
    try {
      await updateDoc(doc(db, 'restaurantes', editId), {
        nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim(),
        tieneDelivery: form.delivery,
      })
      // Nota: no se reenvían los PINs aquí — al editar ya no se leen desde
      // el servidor (config/auth es ilegible por el cliente), así que
      // reenviarlos sobreescribiría los PINs reales con los valores por
      // defecto del formulario. Los PINs solo se fijan al crear el resto;
      // para cambiarlos después se usa Config → PINs (como dueño).
      await gestionarAuthResto({
        restoId: editId, accion: 'adminUpdate',
        payload: { nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim() },
      })
      await updateDoc(doc(db, 'restaurantes', editId, 'config', 'general'), {
        nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim(),
      }).catch(() => {}) // puede no existir
      setMsg('✅ Cambios guardados')
      loadRestos()
    } catch (e) { setMsg('❌ Error: ' + e.message) }
    setSaving(false)
  }

  const cancelarForm = () => {
    setEditId(null); setForm(DEFAULT_FORM); setMsg(''); setTab('lista')
  }

  // ── Eliminar ─────────────────────────────────────────────────────
  const eliminarResto = async (id) => {
    if (!confirm(`¿Eliminar "${id}" y TODA su data? Esta acción no se puede deshacer.`)) return
    setDeleting(id)
    try {
      // Borrar subcolecciones conocidas
      const subCols = ['menu', 'pedidos', 'historial']
      for (const col of subCols) {
        const snap = await getDocs(collection(db, 'restaurantes', id, col))
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.delete(d.ref))
        if (snap.docs.length > 0) await batch.commit()
      }
      // Borrar configs
      const configs = ['mesas', 'categorias', 'general']
      for (const cfg of configs) {
        await deleteDoc(doc(db, 'restaurantes', id, 'config', cfg)).catch(() => {})
      }
      await gestionarAuthResto({ restoId: id, accion: 'adminDelete' }).catch(() => {})
      // Borrar documento principal
      await deleteDoc(doc(db, 'restaurantes', id))
      setRestos(r => r.filter(x => x.id !== id))
    } catch (e) { alert('Error al eliminar: ' + e.message) }
    setDeleting(null)
  }

  // ── Limpiar todas las mesas ──────────────────────────────────────
  const [limpiando, setLimpiando] = useState(false)
  const [limpiezaMsg, setLimpiezaMsg] = useState('')

  const limpiarTodasLasMesas = async () => {
    if (!window.confirm('¿Limpiar pedidos activos y mesas de TODOS los restaurantes?\nEsto no borra el historial.')) return
    setLimpiando(true)
    setLimpiezaMsg('')
    let total = 0
    try {
      for (const r of restos) {
        const pedidosSnap = await get(ref(rtdb, `${r.id}/pedidos_activos`))
        if (pedidosSnap.exists()) {
          const count = Object.keys(pedidosSnap.val()).length
          await remove(ref(rtdb, `${r.id}/pedidos_activos`))
          total += count
        }
        await remove(ref(rtdb, `${r.id}/mesas_activas`))
      }
      setLimpiezaMsg(`✅ Listo — ${total} pedido(s) eliminado(s) en ${restos.length} restaurante(s)`)
    } catch (e) {
      setLimpiezaMsg('❌ Error: ' + e.message)
    }
    setLimpiando(false)
  }

  // ── Toggles ──────────────────────────────────────────────────────
  const toggleActivo    = async (id, activo)        => { await updateDoc(doc(db,'restaurantes',id),{active:!activo}); loadRestos() }
  const toggleDelivery  = async (id, tieneDelivery) => { await updateDoc(doc(db,'restaurantes',id),{tieneDelivery:!tieneDelivery}); loadRestos() }
  const toggleQR        = async (id, qrActivo)      => { await updateDoc(doc(db,'restaurantes',id),{qrActivo:!qrActivo}); loadRestos() }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)', fontFamily:'var(--font)', paddingBottom:40 }}>

      {/* Header */}
      <div style={{ background:'var(--card)', borderBottom:'1px solid var(--border)',
        padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:3 }}>SUPER ADMIN</div>
          <div style={{ fontWeight:900, fontSize:22, color:'var(--accent)' }}>Panel de Control</div>
        </div>
        <button onClick={() => { clearSession(); navigate('/login') }}
          style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)',
            borderRadius:10, padding:'8px 14px', cursor:'pointer', fontFamily:'var(--font)', fontSize:13 }}>
          🚪 Salir
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
        {[
          ['lista', `🍽 Restaurantes (${restos.length})`],
          ['form',  editId ? '✏️ Editando' : '➕ Nuevo'],
        ].map(([t,l]) => (
          <button key={t} onClick={() => { if(t==='lista') cancelarForm(); else setTab(t) }} style={{
            flex:1, padding:'13px 0', background:'none', border:'none',
            borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab===t ? 'var(--accent)' : 'var(--muted)',
            fontFamily:'var(--font)', fontWeight:700, fontSize:14, cursor:'pointer' }}>{l}</button>
        ))}
      </div>

      {/* ── LISTA ── */}
      {tab === 'lista' && (
        <div style={{ padding:16 }}>
          {/* Limpiar todas las mesas */}
          <div style={{ background:'rgba(245,64,58,.06)', border:'1.5px solid rgba(245,64,58,.25)',
            borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
            <div style={{ fontWeight:800, fontSize:13, color:'var(--red)', marginBottom:6 }}>
              🧹 Limpieza de emergencia
            </div>
            <div style={{ fontSize:12, color:'var(--muted)', marginBottom:12, lineHeight:1.5 }}>
              Elimina todos los pedidos activos y libera todas las mesas de todos los restaurantes.
              El historial <strong style={{ color:'var(--text)' }}>no se borra</strong>.
            </div>
            <button onClick={limpiarTodasLasMesas} disabled={limpiando || restos.length === 0}
              style={{ background: limpiando ? 'var(--surface)' : 'rgba(245,64,58,.15)',
                border:'1.5px solid var(--red)', color:'var(--red)',
                borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:800,
                cursor: limpiando ? 'not-allowed' : 'pointer',
                fontFamily:'var(--font)', letterSpacing:1, opacity: limpiando ? .5 : 1 }}>
              {limpiando ? '⏳ Limpiando...' : '🧹 LIMPIAR TODAS LAS MESAS'}
            </button>
            {limpiezaMsg && (
              <div style={{ marginTop:10, fontSize:12,
                color: limpiezaMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)',
                fontWeight:700 }}>{limpiezaMsg}</div>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Cargando...</div>
          ) : restos.length === 0 ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
              <div style={{ fontSize:48, opacity:.3 }}>🍽</div>
              <div style={{ marginTop:12 }}>Sin restaurantes aún</div>
            </div>
          ) : restos.map(r => {
            // Soportar campo 'active' (nuevo canónico) y 'activo' (legacy)
            const estaActivo = r.active !== false && r.activo !== false
            return (
            <div key={r.id} style={{ background:'var(--card)',
              border:`1.5px solid ${estaActivo ? 'var(--green)' : 'var(--border)'}`,
              borderRadius:14, padding:16, marginBottom:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>{r.nombre}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--accent)', marginTop:2 }}>ID: {r.id}</div>
                  {r.whatsapp && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>📱 {r.whatsapp}</div>}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end', flexShrink:0 }}>
                  <div style={{ fontSize:10, fontWeight:800, padding:'3px 10px', borderRadius:20,
                    background: estaActivo ? 'rgba(39,201,122,.15)' : 'rgba(255,77,77,.15)',
                    color: estaActivo ? 'var(--green)' : 'var(--red)',
                    border:`1px solid ${estaActivo?'var(--green)':'var(--red)'}` }}>
                    {estaActivo ? 'ACTIVO' : 'SUSPENDIDO'}
                  </div>
                  <button onClick={() => toggleActivo(r.id, estaActivo)}
                    style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--muted)',
                      borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer', fontFamily:'var(--font)' }}>
                    {estaActivo ? '🔒 Suspender' : '✅ Activar'}
                  </button>
                  <button onClick={() => toggleDelivery(r.id, r.tieneDelivery!==false)}
                    style={{ background: r.tieneDelivery!==false ? 'rgba(39,201,122,.1)' : 'rgba(255,77,77,.1)',
                      border:`1px solid ${r.tieneDelivery!==false?'var(--green)':'var(--red)'}`,
                      color: r.tieneDelivery!==false ? 'var(--green)' : 'var(--red)',
                      borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer', fontFamily:'var(--font)' }}>
                    {r.tieneDelivery!==false ? '🛵 Delivery ON' : '🛵 Delivery OFF'}
                  </button>
                  <button onClick={() => toggleQR(r.id, r.qrActivo!==false)}
                    style={{ background: r.qrActivo!==false ? 'rgba(39,201,122,.1)' : 'rgba(255,77,77,.1)',
                      border:`1px solid ${r.qrActivo!==false?'var(--green)':'var(--red)'}`,
                      color: r.qrActivo!==false ? 'var(--green)' : 'var(--red)',
                      borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer', fontFamily:'var(--font)' }}>
                    {r.qrActivo!==false ? '📷 QR ON' : '📷 QR OFF'}
                  </button>
                  {/* Editar / Eliminar */}
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={() => abrirEditar(r)}
                      style={{ background:'rgba(74,158,255,.1)', border:'1px solid rgba(74,158,255,.3)',
                        color:'var(--blue)', borderRadius:8, padding:'5px 10px',
                        fontSize:11, cursor:'pointer', fontFamily:'var(--font)', fontWeight:700 }}>
                      ✏️ Editar
                    </button>
                    <button onClick={async () => {
                      if (!window.confirm(`¿Limpiar mesas de "${r.nombre}"?`)) return
                      await remove(ref(rtdb, `${r.id}/pedidos_activos`))
                      await remove(ref(rtdb, `${r.id}/mesas_activas`))
                      setLimpiezaMsg(`✅ Mesas de "${r.nombre}" liberadas`)
                    }}
                      style={{ background:'rgba(245,166,35,.08)', border:'1px solid rgba(245,166,35,.3)',
                        color:'var(--accent)', borderRadius:8, padding:'5px 10px',
                        fontSize:11, cursor:'pointer', fontFamily:'var(--font)', fontWeight:700 }}>
                      🧹 Mesas
                    </button>
                    <button onClick={() => eliminarResto(r.id)} disabled={deleting===r.id}
                      style={{ background:'rgba(255,77,77,.1)', border:'1px solid rgba(255,77,77,.3)',
                        color:'var(--red)', borderRadius:8, padding:'5px 10px',
                        fontSize:11, cursor:'pointer', fontFamily:'var(--font)', fontWeight:700,
                        opacity: deleting===r.id ? .5 : 1 }}>
                      {deleting===r.id ? '...' : '🗑 Eliminar'}
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ marginTop:10, padding:'8px 12px', background:'var(--surface)',
                borderRadius:8, fontSize:11, color:'var(--blue)' }}>
                🔗 Login: <strong>/login</strong> → código: <strong>{r.id}</strong>
                &nbsp;|&nbsp;
                🛵 Delivery: <strong>/delivery/{r.id}</strong>
              </div>
            </div>
          )})}
        </div>
      )}

      {/* ── FORMULARIO (Nuevo / Editar) ── */}
      {tab === 'form' && (
        <div style={{ padding:20 }}>
          {editId && (
            <div style={{ background:'rgba(74,158,255,.08)', border:'1px solid rgba(74,158,255,.2)',
              borderRadius:10, padding:'10px 14px', marginBottom:20, fontSize:13, color:'var(--blue)' }}>
              ✏️ Editando: <strong>{editId}</strong>
            </div>
          )}

          {/* ID — solo en creación */}
          {!editId && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>ID del restaurante</div>
              <input className="input" placeholder="Ej: lacasa, elrincon, mariscos123"
                value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g,'-') }))} />
              <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>Solo letras, números y guiones. No se puede cambiar después.</div>
            </div>
          )}

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>Nombre del restaurante</div>
            <input className="input" placeholder="Ej: La Casa de los Ceviches"
              value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
          </div>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>WhatsApp delivery</div>
            <input className="input" placeholder="Ej: 51935009190"
              value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
          </div>

          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>🛵 Delivery</div>
            <div style={{ display:'flex', gap:10 }}>
              {[[true,'✅ Activado'],[false,'❌ Sin delivery']].map(([val,label]) => (
                <button key={String(val)} onClick={() => setForm(f=>({...f,delivery:val}))}
                  style={{ flex:1, background:form.delivery===val?'rgba(39,201,122,.15)':'var(--card)',
                    border:`2px solid ${form.delivery===val?'var(--green)':'var(--border)'}`,
                    color:form.delivery===val?'var(--green)':'var(--muted)',
                    borderRadius:12, padding:'12px 0', fontSize:13, fontWeight:800,
                    cursor:'pointer', fontFamily:'var(--font)' }}>{label}</button>
              ))}
            </div>
          </div>

          {!editId && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>Número de mesas</div>
              <input className="input" type="number" min="1" max="50"
                value={form.mesaCount} onChange={e => setForm(f => ({ ...f, mesaCount: e.target.value }))} />
            </div>
          )}

          {/* PINs — solo al crear. Para cambiarlos después, usar Config → PINs como dueño */}
          {!editId && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>🔑 PINs de acceso</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {[
                  ['pinMesero',    '🍽 Mesero'],
                  ['pinCocina',    '🍳 Cocina'],
                  ['pinDueno',     '👑 Dueño'],
                  ['pinRepartidor','🛵 Repartidor'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <div style={{ fontSize:11, color:'var(--muted)', marginBottom:5 }}>{label}</div>
                    <input className="input" maxLength={6} placeholder="PIN"
                      value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ marginBottom:0 }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {msg && (
            <div style={{ background: msg.startsWith('✅') ? 'rgba(39,201,122,.1)' : 'rgba(255,77,77,.1)',
              border:`1px solid ${msg.startsWith('✅') ? 'var(--green)' : 'var(--red)'}`,
              borderRadius:10, padding:12, fontSize:13, margin:'16px 0',
              color: msg.startsWith('✅') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>
          )}

          <button className="btn btn-primary"
            style={{ width:'100%', padding:16, fontSize:15, letterSpacing:2, marginTop:16 }}
            disabled={saving} onClick={editId ? guardarEdicion : crearResto}>
            {saving ? 'GUARDANDO...' : editId ? '💾 GUARDAR CAMBIOS' : '🍽 CREAR RESTAURANTE'}
          </button>

          {editId && (
            <button onClick={cancelarForm}
              style={{ width:'100%', marginTop:10, padding:14, background:'none',
                border:'1px solid var(--border)', color:'var(--muted)', borderRadius:12,
                fontSize:14, cursor:'pointer', fontFamily:'var(--font)' }}>
              Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
