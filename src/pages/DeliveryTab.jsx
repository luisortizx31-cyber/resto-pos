import { useEffect, useState, useRef } from 'react'
import { rtdb, db } from '../lib/firebase'
import { ref, onValue, update, remove } from 'firebase/database'
import { doc, getDoc, writeBatch, collection, getDocs } from 'firebase/firestore'
import { useToast, useSession } from '../components/Layout'

// ── Timer idéntico al del Repartidor ────────────────────────────────
function Timer({ timeISO, urgentSecs = 1200, warnSecs = 600 }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = timeISO ? new Date(timeISO).getTime() : Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [timeISO])
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const urgent = elapsed >= urgentSecs
  const warn   = elapsed >= warnSecs
  return (
    <div style={{ textAlign:'right' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:28, fontWeight:700, lineHeight:1,
        color: urgent ? 'var(--red)' : warn ? 'var(--yellow)' : 'var(--green)',
        animation: urgent ? 'pulse 1s infinite' : 'none' }}>
        {mm}:{ss}
      </div>
      <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase' }}>
        en espera
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  )
}

function fmt12(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  let h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`
}

function playBeepNuevoPedido() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notes = [523, 659, 784]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'triangle'; osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.4, t + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      osc.start(t); osc.stop(t + 0.35)
    })
  } catch {}
}

function playBeepRepartidorTomó() {
  // Melodía distinta: Sol-Mi-Do-Sol ascendente
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notes = [392, 523, 659, 784]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.15
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.35, t + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      osc.start(t); osc.stop(t + 0.3)
    })
  } catch {}
}

export default function DeliveryTab({ restoId, onNuevoPedido }) {
  const session   = useSession()
  const showToast = useToast()

  const [pedidos, setPedidos]           = useState([])
  const [tab, setTab]                   = useState('nuevos')
  const [repartidores, setRepartidores] = useState([])
  const [asignando, setAsignando]       = useState(null)
  const [cambiandoRep, setCambiandoRep] = useState(null) // key del pedido al que se cambia rep
  const [confirmEliminar, setConfirmEliminar] = useState(null)
  const [confirmLimpiar, setConfirmLimpiar]   = useState(false)
  const [limpiando, setLimpiando]             = useState(false)
  const [confirmEntregado, setConfirmEntregado] = useState(null) // key para confirmar entrega desde cocina
  // Banner de repartidor que tomó un pedido
  const [bannerRep, setBannerRep]   = useState(null)

  const prevKeysRef       = useRef(new Set())
  const prevEnCaminoRef   = useRef(new Set()) // keys que ya estaban en_camino

  // Carga datos de config una sola vez
  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId, 'config', 'auth')).then(snap => {
      if (snap.exists()) setRepartidores(snap.data().repartidores || [])
    })
  }, [restoId])

  // Listener RTDB — siempre activo (no depende de audioActivo)
  useEffect(() => {
    if (!restoId) return
    const unsub = onValue(ref(rtdb, `${restoId}/delivery_pedidos`), snap => {
      const data = snap.val() || {}
      const newKeys = new Set(Object.keys(data))

      // Detectar pedidos NUEVOS (esperando_confirmacion) → beep + cambiar tab en Cocina
      const hayNuevo = [...newKeys].some(k =>
        !prevKeysRef.current.has(k) && data[k]?.status === 'esperando_confirmacion'
      )
      if (hayNuevo) {
        playBeepNuevoPedido()
        if (onNuevoPedido) onNuevoPedido() // sube a Cocina para cambiar tab
      }

      // Detectar pedidos que ACABAN de pasar a en_camino (repartidor los tomó)
      Object.entries(data).forEach(([k, o]) => {
        if (o.status === 'en_camino' && !prevEnCaminoRef.current.has(k)) {
          playBeepRepartidorTomó()
          setBannerRep({ nombre: o.repartidorNombre || 'Repartidor', key: k })
          setTimeout(() => setBannerRep(null), 6000)
        }
      })
      prevEnCaminoRef.current = new Set(
        Object.entries(data).filter(([, o]) => o.status === 'en_camino').map(([k]) => k)
      )

      prevKeysRef.current = newKeys

      const lista = Object.entries(data)
        .map(([key, o]) => ({ key, ...o }))
        .sort((a, b) => new Date(a.timeISO) - new Date(b.timeISO))
      setPedidos(lista)
    })
    return () => unsub()
  }, [restoId])

  // ── Acciones ─────────────────────────────────────────────────────
  const aceptar = async (key) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), { status: 'pending' })
    showToast('✅ Pedido aceptado — en cocina')
    setTab('en_proceso') // auto-cambiar a en proceso
  }

  const rechazar = async (key) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), { status: 'rechazado' })
    showToast('❌ Pedido rechazado')
  }

  const eliminarPedido = async (key) => {
    await remove(ref(rtdb, `${restoId}/delivery_pedidos/${key}`))
    setConfirmEliminar(null)
    showToast('🗑 Pedido eliminado')
  }

  const marcarListo = async (key) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), { status: 'listo' })
    showToast('✅ Listo — esperando repartidor')
    setAsignando(key)
  }

  const asignarRepartidor = async (key, repartidor) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
      status: 'listo',
      repartidorNombre: repartidor === 'otro' ? 'Otro' : repartidor.nombre,
      repartidorId:     repartidor === 'otro' ? 'otro' : repartidor.id,
      repartidorCelular:repartidor === 'otro' ? '' : (repartidor.celular || ''),
    })
    setAsignando(null)
    showToast(repartidor === 'otro' ? '✅ Asignado a repartidor externo' : `✅ Asignado a ${repartidor.nombre}`)
  }

  const toggleDinero = async (key, actual) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), { dineroEntregado: !actual })
  }

  const marcarEntregadoCocina = async (key) => {
    try {
      const pedido = pedidos.find(p => p.key === key)
      const entregadoISO = new Date().toISOString()

      // Marcar entregado en RTDB
      await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
        status: 'entregado',
        entregadoISO,
      })

      // Guardar en historial Firestore
      if (pedido) {
        const total = pedido.total ?? (pedido.items || []).reduce((a, i) => a + i.price * i.qty, 0)
        const batch = writeBatch(db)
        const histRef = doc(collection(db, 'restaurantes', restoId, 'historial'))
        batch.set(histRef, {
          tipo:             'delivery',
          cliente:          pedido.nombre    || '',
          telefono:         pedido.telefono  || '',
          direccion:        pedido.direccion || '',
          items:            pedido.items     || [],
          extras:           pedido.extras    || '',
          extrasPrice:      pedido.extrasPrice || 0,
          totalFinal:       total,
          pagoYape:         pedido.pagoYape       || 0,
          pagoEfectivo:     pedido.pagoEfectivo   || 0,
          repartidorNombre: pedido.repartidorNombre || '',
          repartidorAnterior: pedido.repartidorAnterior || null,
          completedAtISO:   entregadoISO,
          creadoISO:        pedido.timeISO || entregadoISO,
        })
        await batch.commit()
      }

      setConfirmEntregado(null)
      showToast('✅ Pedido marcado como entregado')
      setTab('entregados')
    } catch (e) {
      console.error(e)
      showToast('Error al marcar entregado', 'error')
    }
  }

  const cambiarRepartidor = async (key, repartidor) => {
    const pedidoActual = pedidos.find(p => p.key === key)
    const nombreAnterior = pedidoActual?.repartidorNombre || null
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
      status: 'listo',
      repartidorNombre:   repartidor === 'otro' ? 'Otro' : repartidor.nombre,
      repartidorId:       repartidor === 'otro' ? 'otro' : repartidor.id,
      repartidorCelular:  repartidor === 'otro' ? '' : (repartidor.celular || ''),
      repartidorAnterior: nombreAnterior,
      tomadoISO: null,
    })
    setCambiandoRep(null)
    showToast(repartidor === 'otro' ? '🔄 Repartidor cambiado a externo' : `🔄 Repartidor cambiado a ${repartidor.nombre}`)
  }

  const limpiarEntregados = async () => {
    setLimpiando(true)
    try {
      const entregados = pedidos.filter(p => p.status === 'entregado')
      for (const p of entregados) {
        await remove(ref(rtdb, `${restoId}/delivery_pedidos/${p.key}`))
      }
      showToast(`🗑 ${entregados.length} pedido(s) eliminado(s)`)
    } catch { showToast('Error al limpiar', 'error') }
    setLimpiando(false)
    setConfirmLimpiar(false)
  }

  // ── Filtros ───────────────────────────────────────────────────────
  const nuevos    = pedidos.filter(p => p.status === 'esperando_confirmacion')
  const enProceso = pedidos.filter(p => ['pending', 'listo', 'en_camino'].includes(p.status))
  // Entregados ordenados más reciente primero
  const entregados = pedidos
    .filter(p => p.status === 'entregado')
    .sort((a, b) => new Date(b.entregadoISO || b.timeISO) - new Date(a.entregadoISO || a.timeISO))

  const esRolAdmin = session?.role === 'dueno' || session?.role === 'superadmin'

  // ── Render tarjeta ────────────────────────────────────────────────
  const renderPedido = (pedido, tipo) => {
    const borderColor = tipo === 'nuevo'
      ? 'var(--blue)'
      : tipo === 'proceso' ? 'var(--accent)'
      : tipo === 'entregado' ? 'var(--green)'
      : 'var(--border)'
    const bgHeader = tipo === 'nuevo'
      ? 'rgba(74,158,255,.07)'
      : tipo === 'proceso' ? 'rgba(245,166,35,.07)'
      : 'rgba(39,201,122,.07)'
    const total = pedido.total ?? (pedido.items || []).reduce((a, i) => a + i.price * i.qty, 0)

    return (
      <div key={pedido.key} style={{ background:'var(--card)',
        border:`2px solid ${borderColor}`, borderRadius:20,
        marginBottom:14, overflow:'hidden',
        boxShadow: tipo==='nuevo' ? '0 0 16px rgba(74,158,255,.12)' : 'none' }}>

        {/* Header — idéntico en estética al Repartidor */}
        <div style={{ padding:'14px 18px', background:bgHeader,
          borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:900, fontSize:16, marginBottom:4 }}>
              👤 {pedido.cliente?.nombre}
            </div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:2 }}>
              📍 {pedido.cliente?.direccion}
            </div>
            {pedido.cliente?.referencia && (
              <div style={{ fontSize:12, color:'var(--muted)', marginBottom:2 }}>
                📌 {pedido.cliente.referencia}
              </div>
            )}
            {pedido.telefonoCliente && (
              <div style={{ fontSize:12, color:'var(--blue)', fontFamily:'var(--mono)', marginBottom:2 }}>
                📱 {pedido.telefonoCliente}
              </div>
            )}
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
              🕐 Pedido: {fmt12(pedido.timeISO)}
              {pedido.entregadoISO && tipo === 'entregado' && (
                <span style={{ color:'var(--green)', fontWeight:700 }}>
                  {' · '}✅ Entregado: {fmt12(pedido.entregadoISO)}
                </span>
              )}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
            {tipo === 'nuevo' && <Timer timeISO={pedido.timeISO} />}
            {tipo === 'proceso' && pedido.status !== 'en_camino' && (
              <Timer timeISO={pedido.timeISO} />
            )}
            <div style={{ fontWeight:900, fontSize:18, color:'var(--green)', fontFamily:'var(--mono)' }}>
              S/{Number(total).toFixed(2)}
            </div>
            <div style={{ fontSize:11, fontWeight:700,
              color: pedido.cliente?.pago==='yape' ? 'var(--blue)' : 'var(--accent)' }}>
              {pedido.cliente?.pago==='yape' ? '📲 Yape' : '💵 Efectivo'}
            </div>
          </div>
        </div>

        {/* Repartidor asignado — LETRAS GRANDES y destacadas */}
        {pedido.repartidorNombre && (
          <div style={{
            padding:'10px 18px',
            background: pedido.status === 'en_camino'
              ? 'rgba(39,201,122,.1)'
              : 'rgba(74,158,255,.07)',
            borderBottom:'1px solid var(--border)',
            display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                textTransform:'uppercase', marginBottom:2 }}>
                {pedido.status === 'en_camino' ? '🛵 En camino con' : '✅ Asignado a'}
              </div>
              <div style={{ fontSize:22, fontWeight:900,
                color: pedido.status === 'en_camino' ? 'var(--green)' : 'var(--blue)',
                letterSpacing:1 }}>
                {pedido.repartidorNombre}
              </div>
              {pedido.tomadoISO && (
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                  Tomado: {fmt12(pedido.tomadoISO)}
                </div>
              )}
            </div>
            {pedido.status === 'en_camino' && (
              <div style={{ fontSize:36 }}>🛵</div>
            )}
          </div>
        )}

        {/* Items */}
        <div style={{ padding:'10px 18px' }}>
          {(pedido.items || []).map((item, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
              padding:'5px 0',
              borderBottom: i < pedido.items.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ background:'var(--accent)', color:'#111', fontWeight:900, fontSize:11,
                width:24, height:24, borderRadius:'50%', display:'flex',
                alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                ×{item.qty}
              </div>
              <span style={{ fontSize:14, fontWeight:600, flex:1 }}>{item.name}</span>
              <span style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--muted)' }}>
                S/{(item.price * item.qty).toFixed(2)}
              </span>
            </div>
          ))}
          {pedido.notas && (
            <div style={{ marginTop:8, fontSize:12, color:'var(--yellow)',
              background:'rgba(240,230,140,.08)', borderRadius:8, padding:'6px 10px' }}>
              📝 {pedido.notas}
            </div>
          )}
        </div>

        {/* Acciones por tipo */}
        <div style={{ padding:'0 18px 16px', display:'flex', flexDirection:'column', gap:8 }}>

          {/* NUEVOS — Aceptar / Rechazar */}
          {tipo === 'nuevo' && (
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => aceptar(pedido.key)}
                style={{ flex:2, background:'var(--green)', color:'white', border:'none',
                  borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                  cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                ✅ ACEPTAR
              </button>
              <button onClick={() => rechazar(pedido.key)}
                style={{ flex:1, background:'rgba(255,77,77,.15)',
                  border:'1px solid var(--red)', color:'var(--red)',
                  borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                  cursor:'pointer', fontFamily:'var(--font)' }}>
                ❌
              </button>
            </div>
          )}

          {/* EN PROCESO — Marcar listo + asignar + cambiar rep + marcar entregado */}
          {tipo === 'proceso' && (
            <>
              {pedido.status === 'pending' && (
                <button className="btn btn-success"
                  style={{ width:'100%', padding:'12px 0', fontSize:13, letterSpacing:1 }}
                  onClick={() => marcarListo(pedido.key)}>
                  ✅ LISTO — ASIGNAR REPARTIDOR
                </button>
              )}
              {((pedido.status === 'listo' && !pedido.repartidorId) || asignando === pedido.key) && (
                asignando === pedido.key ? (
                  <div>
                    <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
                      marginBottom:8, textTransform:'uppercase' }}>Asignar a:</div>
                    {repartidores.map(r => (
                      <button key={r.id} onClick={() => asignarRepartidor(pedido.key, r)}
                        style={{ width:'100%', background:'rgba(39,201,122,.1)',
                          border:'1px solid var(--green)', color:'var(--green)',
                          borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:800,
                          cursor:'pointer', fontFamily:'var(--font)', marginBottom:6 }}>
                        🛵 {r.nombre}
                      </button>
                    ))}
                    <button onClick={() => asignarRepartidor(pedido.key, 'otro')}
                      style={{ width:'100%', background:'rgba(245,166,35,.1)',
                        border:'1px solid var(--accent)', color:'var(--accent)',
                        borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:800,
                        cursor:'pointer', fontFamily:'var(--font)', marginBottom:6 }}>
                      🔄 Otro (externo)
                    </button>
                    <button onClick={() => setAsignando(null)}
                      style={{ width:'100%', background:'none', border:'1px solid var(--border)',
                        color:'var(--muted)', borderRadius:10, padding:'8px 0',
                        fontSize:12, cursor:'pointer', fontFamily:'var(--font)' }}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setAsignando(pedido.key)}
                    style={{ width:'100%', background:'rgba(74,158,255,.1)',
                      border:'1px solid var(--blue)', color:'var(--blue)',
                      borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:800,
                      cursor:'pointer', fontFamily:'var(--font)' }}>
                    🛵 ASIGNAR REPARTIDOR
                  </button>
                )
              )}

              {/* Cambiar repartidor — visible cuando ya hay uno asignado */}
              {pedido.repartidorId && cambiandoRep !== pedido.key && (
                <button onClick={() => setCambiandoRep(pedido.key)}
                  style={{ width:'100%', background:'rgba(245,166,35,.08)',
                    border:'1px solid rgba(245,166,35,.4)', color:'var(--accent)',
                    borderRadius:10, padding:'9px 0', fontSize:12, fontWeight:800,
                    cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                  🔄 CAMBIAR REPARTIDOR
                </button>
              )}
              {cambiandoRep === pedido.key && (
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:12, padding:12 }}>
                  <div style={{ fontSize:11, color:'var(--accent)', letterSpacing:2,
                    marginBottom:8, textTransform:'uppercase', fontWeight:800 }}>
                    🔄 Asignar a otro repartidor:
                  </div>
                  {repartidores.map(r => (
                    <button key={r.id} onClick={() => cambiarRepartidor(pedido.key, r)}
                      style={{ width:'100%', background:'rgba(39,201,122,.1)',
                        border:'1px solid var(--green)', color:'var(--green)',
                        borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:800,
                        cursor:'pointer', fontFamily:'var(--font)', marginBottom:6 }}>
                      🛵 {r.nombre}
                    </button>
                  ))}
                  <button onClick={() => cambiarRepartidor(pedido.key, 'otro')}
                    style={{ width:'100%', background:'rgba(245,166,35,.1)',
                      border:'1px solid var(--accent)', color:'var(--accent)',
                      borderRadius:10, padding:'10px 0', fontSize:13, fontWeight:800,
                      cursor:'pointer', fontFamily:'var(--font)', marginBottom:6 }}>
                    🔄 Otro (externo)
                  </button>
                  <button onClick={() => setCambiandoRep(null)}
                    style={{ width:'100%', background:'none', border:'1px solid var(--border)',
                      color:'var(--muted)', borderRadius:10, padding:'8px 0',
                      fontSize:12, cursor:'pointer', fontFamily:'var(--font)' }}>
                    Cancelar
                  </button>
                </div>
              )}

              {/* Marcar entregado desde cocina */}
              {(pedido.status === 'en_camino' || pedido.status === 'listo') && confirmEntregado !== pedido.key && (
                <button onClick={() => setConfirmEntregado(pedido.key)}
                  style={{ width:'100%', background:'rgba(39,201,122,.1)',
                    border:'1px solid var(--green)', color:'var(--green)',
                    borderRadius:10, padding:'11px 0', fontSize:13, fontWeight:800,
                    cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                  📦 MARCAR ENTREGADO
                </button>
              )}
              {confirmEntregado === pedido.key && (
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => marcarEntregadoCocina(pedido.key)}
                    style={{ flex:2, background:'var(--green)', color:'white', border:'none',
                      borderRadius:12, padding:'12px 0', fontSize:13, fontWeight:800,
                      cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                    ✅ SÍ, ENTREGADO
                  </button>
                  <button onClick={() => setConfirmEntregado(null)}
                    style={{ flex:1, background:'var(--card)', border:'1px solid var(--border)',
                      color:'var(--muted)', borderRadius:12, padding:'12px 0',
                      fontSize:12, cursor:'pointer', fontFamily:'var(--font)' }}>
                    Cancelar
                  </button>
                </div>
              )}
              <button onClick={() => setConfirmEliminar(pedido.key)}
                style={{ width:'100%', background:'rgba(255,77,77,.08)',
                  border:'1px solid rgba(255,77,77,.3)', color:'var(--red)',
                  borderRadius:10, padding:'9px 0', fontSize:12, fontWeight:800,
                  cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                🗑 ELIMINAR PEDIDO
              </button>
            </>
          )}

          {/* ENTREGADOS — switch dinero (solo admin/dueño) */}
          {tipo === 'entregado' && esRolAdmin && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:12, padding:'10px 14px' }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700 }}>¿Entregó dinero?</div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                  Rindió cuenta en caja
                </div>
              </div>
              <button
                onClick={() => toggleDinero(pedido.key, pedido.dineroEntregado)}
                style={{
                  width:52, height:28, borderRadius:14, border:'none', cursor:'pointer',
                  background: pedido.dineroEntregado ? 'var(--green)' : 'var(--border)',
                  position:'relative', transition:'background .2s', flexShrink:0
                }}>
                <div style={{
                  width:22, height:22, borderRadius:'50%', background:'white',
                  position:'absolute', top:3,
                  left: pedido.dineroEntregado ? 27 : 3,
                  transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,.3)'
                }} />
              </button>
              <span style={{ fontSize:12, fontWeight:800,
                color: pedido.dineroEntregado ? 'var(--green)' : 'var(--red)',
                minWidth:36, textAlign:'right' }}>
                {pedido.dineroEntregado ? 'PAGÓ' : 'DEBE'}
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Render principal ──────────────────────────────────────────────
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column' }}>

      {/* Banner de repartidor que tomó un pedido */}
      {bannerRep && (
        <div style={{
          background:'rgba(39,201,122,.15)', borderBottom:'2px solid var(--green)',
          padding:'12px 18px', display:'flex', alignItems:'center',
          justifyContent:'space-between', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:28 }}>🛵</span>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
                textTransform:'uppercase' }}>Pedido tomado por</div>
              <div style={{ fontSize:20, fontWeight:900, color:'var(--green)' }}>
                {bannerRep.nombre}
              </div>
            </div>
          </div>
          <button onClick={() => setBannerRep(null)}
            style={{ background:'none', border:'none', color:'var(--muted)',
              fontSize:20, cursor:'pointer', lineHeight:1 }}>✕</button>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)',
        background:'var(--surface)' }}>
        {[
          ['nuevos',    `📱 Nuevos`,     nuevos.length,     'var(--blue)'],
          ['en_proceso',`🍳 En proceso`, enProceso.length,  'var(--accent)'],
          ['entregados',`✅ Entregados`, entregados.length, 'var(--green)'],
        ].map(([t, l, count, c]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, padding:'10px 0', background:'none', border:'none',
            borderBottom: tab===t ? `2px solid ${c}` : '2px solid transparent',
            color: tab===t ? c : 'var(--muted)', fontWeight:700, fontSize:11,
            letterSpacing:1, cursor:'pointer', fontFamily:'var(--font)' }}>
            {l}{count > 0 ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {/* Botón limpiar entregados — solo en tab entregados y para admin */}
      {tab === 'entregados' && esRolAdmin && entregados.length > 0 && (
        <div style={{ padding:'10px 16px 0' }}>
          <button onClick={() => setConfirmLimpiar(true)}
            style={{ background:'rgba(255,77,77,.08)', border:'1px solid rgba(255,77,77,.3)',
              color:'var(--red)', borderRadius:10, padding:'9px 16px', fontSize:12,
              fontWeight:800, cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
            🗑 Limpiar entregados ({entregados.length})
          </button>
        </div>
      )}

      <div style={{ padding:16, overflowY:'auto' }}>
        {tab === 'nuevos' && (
          nuevos.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--muted)' }}>
              <div style={{ fontSize:48, opacity:.2 }}>📱</div>
              <div style={{ marginTop:12, letterSpacing:2, fontSize:13 }}>SIN PEDIDOS NUEVOS</div>
            </div>
          ) : nuevos.map(p => renderPedido(p, 'nuevo'))
        )}
        {tab === 'en_proceso' && (
          enProceso.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--muted)' }}>
              <div style={{ fontSize:48, opacity:.2 }}>🍳</div>
              <div style={{ marginTop:12, letterSpacing:2, fontSize:13 }}>SIN PEDIDOS EN PROCESO</div>
            </div>
          ) : enProceso.map(p => renderPedido(p, 'proceso'))
        )}
        {tab === 'entregados' && (
          entregados.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:'var(--muted)' }}>
              <div style={{ fontSize:48, opacity:.2 }}>✅</div>
              <div style={{ marginTop:12, letterSpacing:2, fontSize:13 }}>SIN ENTREGADOS</div>
            </div>
          ) : entregados.map(p => renderPedido(p, 'entregado'))
        )}
      </div>

      {/* Modal confirmar eliminar pedido */}
      {confirmEliminar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--red)',
            padding:26, width:'100%', maxWidth:320, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🗑</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>¿Eliminar pedido?</div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:22 }}>
              Esta acción no se puede deshacer.
            </div>
            <button onClick={() => eliminarPedido(confirmEliminar)}
              style={{ width:'100%', background:'var(--red)', color:'white', border:'none',
                borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:10 }}>
              ❌ SÍ, ELIMINAR
            </button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => setConfirmEliminar(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal confirmar limpiar entregados */}
      {confirmLimpiar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--red)',
            padding:26, width:'100%', maxWidth:320, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🗑</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>¿Limpiar entregados?</div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:22 }}>
              Se eliminarán {entregados.length} pedido(s) entregados de la vista. El historial en Firestore no se borra.
            </div>
            <button onClick={limpiarEntregados} disabled={limpiando}
              style={{ width:'100%', background:'var(--red)', color:'white', border:'none',
                borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:10 }}>
              {limpiando ? 'LIMPIANDO...' : `🗑 SÍ, LIMPIAR (${entregados.length})`}
            </button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => setConfirmLimpiar(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
