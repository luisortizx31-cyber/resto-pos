import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { useSession, useToast } from '../components/Layout'

export default function Config() {
  const session  = useSession()
  const showToast = useToast()
  const restoId  = session?.restoId
  const [tab, setTab]     = useState('pines')
  const [pins, setPins]   = useState({ mesero:'', cocina:'', dueno:'' })
  const [currentPin, setCurrentPin] = useState('')
  const [whatsapp, setWhatsapp]     = useState('')
  const [repartidores, setRepartidores] = useState([])
  const [nuevoRep, setNuevoRep] = useState({ nombre:'', celular:'', pin:'' })
  const [saving, setSaving]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmEliminarId, setConfirmEliminarId] = useState(null)

  useEffect(() => { if (restoId) loadConfig() }, [restoId])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const authSnap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'))
      if (authSnap.exists()) {
        const d = authSnap.data()
        setPins({ mesero: d.pins?.mesero||'', cocina: d.pins?.cocina||'', dueno: d.pins?.dueno||'' })
        setRepartidores(d.repartidores || [])
      }
      const restoSnap = await getDoc(doc(db, 'restaurantes', restoId))
      if (restoSnap.exists()) setWhatsapp(restoSnap.data().whatsapp || '')
    } catch {}
    setLoading(false)
  }

  const savePins = async () => {
    if (!currentPin) { showToast('Ingresa tu PIN actual de dueño', 'error'); return }
    const snap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'))
    const currentDuenoPin = snap.data()?.pins?.dueno || '3333'
    if (currentPin !== currentDuenoPin) { showToast('PIN actual incorrecto', 'error'); return }
    setSaving(true)
    try {
      const newPins = {}
      if (pins.mesero.length === 4) newPins.mesero = pins.mesero
      if (pins.cocina.length === 4)  newPins.cocina  = pins.cocina
      if (pins.dueno.length === 4)   newPins.dueno   = pins.dueno
      await updateDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'),
        { pins: { ...snap.data()?.pins, ...newPins } })
      showToast('✅ PINs actualizados')
      setCurrentPin('')
    } catch { showToast('Error al guardar', 'error') }
    setSaving(false)
  }

  const saveWhatsapp = async () => {
    if (!whatsapp.trim()) { showToast('Ingresa un número', 'error'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'restaurantes', restoId), { whatsapp: whatsapp.trim() })
      await updateDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'), { whatsapp: whatsapp.trim() })
      showToast('✅ WhatsApp actualizado')
    } catch { showToast('Error al guardar', 'error') }
    setSaving(false)
  }

  const agregarRepartidor = async () => {
    if (!nuevoRep.nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    if (!nuevoRep.celular.trim()) { showToast('El celular es obligatorio', 'error'); return }
    if (nuevoRep.pin.length !== 4) { showToast('PIN de exactamente 4 dígitos requerido', 'error'); return }
    // Verificar PIN único
    if (repartidores.some(r => r.pin === nuevoRep.pin)) {
      showToast('Ese PIN ya lo usa otro repartidor', 'error'); return
    }
    const nuevo = [...repartidores, {
      nombre: nuevoRep.nombre.trim(),
      celular: nuevoRep.celular.trim(),
      pin: nuevoRep.pin,
      id: Date.now().toString()
    }]
    setSaving(true)
    try {
      await updateDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'), { repartidores: nuevo })
      setRepartidores(nuevo)
      setNuevoRep({ nombre:'', celular:'', pin:'' })
      showToast('✅ Repartidor agregado')
    } catch { showToast('Error al guardar', 'error') }
    setSaving(false)
  }

  const eliminarRepartidor = async (id) => {
    const nuevo = repartidores.filter(r => r.id !== id)
    await updateDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'), { repartidores: nuevo })
    setRepartidores(nuevo)
    setConfirmEliminarId(null)
    showToast('🗑 Repartidor eliminado')
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'var(--muted)' }}>Cargando...</div>

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">CONFIGURACIÓN</span>
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
        {[['pines','🔑 PINs'],['whatsapp','📱 WhatsApp'],['repartidores','🛵 Repartidores']].map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, padding:'12px 0', background:'none', border:'none',
            borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab===t ? 'var(--accent)' : 'var(--muted)',
            fontFamily:'var(--font)', fontWeight:700, fontSize:12,
            cursor:'pointer', letterSpacing:1 }}>{l}</button>
        ))}
      </div>

      {/* PINs — sin PIN global de repartidor */}
      {tab === 'pines' && (
        <div style={{ padding:20 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16, lineHeight:1.6 }}>
            Cada repartidor tiene su propio PIN personal configurado en la pestaña Repartidores.
          </div>
          {[['mesero','🍽 Mesero'],['cocina','🍳 Cocina'],['dueno','👑 Dueño (nuevo PIN)']].map(([k,l]) => (
            <div key={k} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
                textTransform:'uppercase', marginBottom:6 }}>{l}</div>
              <input className="input" type="number" placeholder="Nuevo PIN de 4 dígitos"
                value={pins[k]} onChange={e => setPins(p => ({ ...p, [k]: e.target.value.slice(0,4) }))} />
            </div>
          ))}
          <div style={{ marginBottom:20, borderTop:'1px solid var(--border)', paddingTop:16 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginBottom:6 }}>Tu PIN actual de dueño (requerido)</div>
            <input className="input" type="number" placeholder="PIN actual"
              value={currentPin} onChange={e => setCurrentPin(e.target.value.slice(0,4))} />
          </div>
          <button className="btn btn-primary"
            style={{ width:'100%', padding:16, fontSize:15, letterSpacing:2 }}
            disabled={saving} onClick={savePins}>
            {saving ? 'GUARDANDO...' : '💾 GUARDAR PINs'}
          </button>
        </div>
      )}

      {/* WhatsApp */}
      {tab === 'whatsapp' && (
        <div style={{ padding:20 }}>
          <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16, lineHeight:1.6 }}>
            Número de WhatsApp del dueño. Los clientes de delivery también podrán contactarte si no hay repartidor asignado. Incluye código de país (ej: 51935009190).
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginBottom:6 }}>Número WhatsApp</div>
            <input className="input" type="tel" placeholder="Ej: 51935009190"
              value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
          </div>
          <button className="btn btn-primary"
            style={{ width:'100%', padding:16, fontSize:15, letterSpacing:2 }}
            disabled={saving} onClick={saveWhatsapp}>
            {saving ? 'GUARDANDO...' : '💾 GUARDAR NÚMERO'}
          </button>
        </div>
      )}

      {/* Repartidores */}
      {tab === 'repartidores' && (
        <div style={{ padding:20 }}>
          <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
            borderRadius:14, padding:16, marginBottom:20 }}>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginBottom:12 }}>➕ Agregar Repartidor</div>
            <input className="input" placeholder="Nombre completo *"
              value={nuevoRep.nombre} onChange={e => setNuevoRep(r => ({ ...r, nombre: e.target.value }))}
              style={{ marginBottom:10 }} />
            <input className="input" type="tel" placeholder="Celular (con código país, ej: 51987654321) *"
              value={nuevoRep.celular} onChange={e => setNuevoRep(r => ({ ...r, celular: e.target.value }))}
              style={{ marginBottom:10 }} />
            <input className="input" type="number" placeholder="PIN único de 4 dígitos *"
              value={nuevoRep.pin} onChange={e => setNuevoRep(r => ({ ...r, pin: e.target.value.slice(0,4) }))}
              style={{ marginBottom:10 }} />
            <div style={{ fontSize:11, color:'var(--muted)', marginBottom:12, lineHeight:1.5 }}>
              El repartidor usará su nombre + este PIN para ingresar al sistema.
            </div>
            <button className="btn btn-primary" style={{ width:'100%', padding:13 }}
              disabled={saving} onClick={agregarRepartidor}>
              ➕ AGREGAR
            </button>
          </div>

          <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
            textTransform:'uppercase', marginBottom:10 }}>
            Repartidores ({repartidores.length})
          </div>
          {repartidores.length === 0 ? (
            <div style={{ textAlign:'center', padding:'30px 0', color:'var(--muted)', fontSize:13 }}>
              Sin repartidores aún
            </div>
          ) : repartidores.map(r => (
            <div key={r.id} style={{ background:'var(--card)', border:'1.5px solid var(--border)',
              borderRadius:12, padding:'12px 14px', marginBottom:8 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:15 }}>🛵 {r.nombre}</div>
                  {r.celular && (
                    <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>📱 {r.celular}</div>
                  )}
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, fontFamily:'var(--mono)' }}>
                    PIN: {'●'.repeat(r.pin?.length||4)}
                  </div>
                </div>
                <button onClick={() => setConfirmEliminarId(r.id)}
                  style={{ background:'rgba(255,77,77,.1)', border:'1px solid rgba(255,77,77,.3)',
                    color:'var(--red)', borderRadius:10, padding:'8px 12px',
                    fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal confirmar eliminar repartidor */}
      {confirmEliminarId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--red)',
            padding:26, width:'100%', maxWidth:320, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>¿Eliminar repartidor?</div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:22 }}>
              Esta acción no se puede deshacer.
            </div>
            <button onClick={() => eliminarRepartidor(confirmEliminarId)}
              style={{ width:'100%', background:'var(--red)', color:'white', border:'none',
                borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:10 }}>
              🗑 SÍ, ELIMINAR
            </button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => setConfirmEliminarId(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
