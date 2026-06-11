import { useEffect, useState } from 'react'
import { rtdb, db } from '../lib/firebase'
import { ref, onValue, update } from 'firebase/database'
import { collection, addDoc } from 'firebase/firestore'
import { useSession, useToast } from '../components/Layout'

function Timer({ timeISO }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = timeISO ? new Date(timeISO).getTime() : Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [timeISO])
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const urgent = elapsed >= 1800
  const warn   = elapsed >= 900
  return (
    <div style={{ textAlign:'right' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:26, fontWeight:700, lineHeight:1,
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

export default function Repartidor() {
  const session    = useSession()
  const restoId    = session?.restoId
  const showToast  = useToast()
  const miId       = session?.repartidorId
  const miNombre   = session?.repartidorNombre || 'Repartidor'
  const miCelular  = session?.repartidorCelular || ''

  const [pedidos, setPedidos]           = useState([])
  const [tab, setTab]                   = useState('disponibles')
  const [welcomeVisible, setWelcomeVisible] = useState(true)
  const [confirmando, setConfirmando]   = useState(null) // key del pedido a confirmar entrega

  useEffect(() => {
    const t = setTimeout(() => setWelcomeVisible(false), 4000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!restoId) return
    return onValue(ref(rtdb, `${restoId}/delivery_pedidos`), snap => {
      const data = snap.val() || {}
      setPedidos(
        Object.entries(data)
          .map(([key, o]) => ({ key, ...o }))
          .sort((a, b) => new Date(a.timeISO) - new Date(b.timeISO))
      )
    })
  }, [restoId])

  const disponibles = pedidos.filter(p => p.status === 'listo' && !p.repartidorId)
  const misPedidos  = pedidos.filter(p => p.repartidorId === miId && ['en_camino','listo'].includes(p.status))
  const entregados  = pedidos.filter(p => p.repartidorId === miId && p.status === 'entregado')

  const tomarPedido = async (key) => {
    const pedido = pedidos.find(p => p.key === key)
    if (!pedido || pedido.repartidorId) {
      showToast('⚠️ Ya fue tomado por otro repartidor', 'error'); return
    }
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
      status: 'en_camino',
      repartidorId: miId,
      repartidorNombre: miNombre,
      repartidorCelular: miCelular,
      tomadoISO: new Date().toISOString(),
    })
    showToast('🛵 ¡Pedido tomado!')
    setTab('mis_pedidos')
  }

  const marcarEntregado = async (key) => {
    const pedido = pedidos.find(p => p.key === key)
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
      status: 'entregado',
      entregadoISO: new Date().toISOString(),
    })
    if (pedido) {
      try {
        await addDoc(collection(db, 'restaurantes', restoId, 'historial'), {
          tipo: 'delivery', mesa: 'Delivery',
          items: pedido.items || [], extras: pedido.notas || '',
          extrasPrice: 0,
          timeISO: pedido.timeISO || new Date().toISOString(),
          completedAtISO: new Date().toISOString(),
          descuento: 0, totalFinal: pedido.total || 0,
          clienteNombre: pedido.cliente?.nombre || '',
          clienteDireccion: pedido.cliente?.direccion || '',
          clientePago: pedido.cliente?.pago || 'efectivo',
          telefonoCliente: pedido.telefonoCliente || '',
          repartidorNombre: miNombre, repartidorId: miId,
        })
      } catch {}
    }
    setConfirmando(null)
    showToast('✅ Entregado y guardado en historial')
  }

  const cancelarEntrega = async (key) => {
    await update(ref(rtdb, `${restoId}/delivery_pedidos/${key}`), {
      status: 'listo',
      repartidorId: null,
      repartidorNombre: null,
      repartidorCelular: null,
      tomadoISO: null,
    })
    showToast('↩️ Pedido devuelto — ya disponible para otros repartidores', 'error')
  }

  const renderCard = (pedido, tipo) => {
    const tel = pedido.telefonoCliente || pedido.cliente?.telefono || ''
    const waMsg = `Hola ${pedido.cliente?.nombre || 'cliente'}, soy ${miNombre} tu repartidor 🛵. Voy en camino con tu pedido a: ${pedido.cliente?.direccion}`
    const total = (pedido.items || []).reduce((a, i) => a + i.price * i.qty, 0)
    const borderColor = tipo === 'mis' ? 'var(--green)' : tipo === 'disponible' ? 'var(--blue)' : 'var(--border)'
    const bgColor     = tipo === 'mis' ? 'rgba(39,201,122,.07)' : tipo === 'disponible' ? 'rgba(74,158,255,.07)' : 'rgba(245,166,35,.05)'

    return (
      <div key={pedido.key} style={{ background:'var(--card)', border:`2px solid ${borderColor}`,
        borderRadius:20, overflow:'hidden', marginBottom:16,
        boxShadow: tipo==='mis' ? '0 0 20px rgba(39,201,122,.15)' : tipo==='disponible' ? '0 0 16px rgba(74,158,255,.1)' : 'none' }}>

        {/* Header */}
        <div style={{ padding:'14px 18px', background: bgColor,
          borderBottom:'1px solid var(--border)',
          display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:900, fontSize:17, marginBottom:4 }}>
              👤 {pedido.cliente?.nombre}
            </div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:2 }}>
              📍 {pedido.cliente?.direccion}
            </div>
            {pedido.cliente?.referencia && (
              <div style={{ fontSize:12, color:'var(--muted)' }}>
                📌 {pedido.cliente.referencia}
              </div>
            )}
            {tel && (
              <div style={{ fontSize:12, color:'var(--blue)', marginTop:3, fontFamily:'var(--mono)' }}>
                📱 {tel}
              </div>
            )}
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:4 }}>
              🕐 {fmt12(pedido.timeISO)}
              {pedido.tomadoISO && tipo==='mis' && ` · Tomado: ${fmt12(pedido.tomadoISO)}`}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
            {tipo === 'disponible' && <Timer timeISO={pedido.timeISO} />}
            <div style={{ fontWeight:900, fontSize:20, color:'var(--green)', fontFamily:'var(--mono)' }}>
              S/{total.toFixed(2)}
            </div>
            <div style={{ fontSize:11, fontWeight:700,
              color: pedido.cliente?.pago==='yape' ? 'var(--blue)' : 'var(--accent)' }}>
              {pedido.cliente?.pago==='yape' ? '📲 Yape' : '💵 Efectivo'}
            </div>
          </div>
        </div>

        {/* Items */}
        <div style={{ padding:'10px 18px' }}>
          {(pedido.items || []).map((item, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', padding:'5px 0',
              borderBottom: i < pedido.items.length-1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ background:'var(--accent)', color:'#111', fontWeight:900, fontSize:11,
                  width:24, height:24, borderRadius:'50%', display:'flex',
                  alignItems:'center', justifyContent:'center' }}>×{item.qty}</div>
                <span style={{ fontSize:14, fontWeight:600 }}>{item.name}</span>
              </div>
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

        {/* Acciones */}
        <div style={{ padding:'0 18px 16px', display:'flex', flexDirection:'column', gap:8 }}>
          {tipo === 'disponible' && (
            <button className="btn btn-primary"
              style={{ width:'100%', padding:'14px 0', fontSize:15, letterSpacing:2,
                background:'var(--blue)', border:'none' }}
              onClick={() => tomarPedido(pedido.key)}>
              🛵 TOMAR PEDIDO
            </button>
          )}

          {tipo === 'mis' && (
            <>
              {/* Botones contacto */}
              {tel && (
                <div style={{ display:'flex', gap:8 }}>
                  <a href={`https://wa.me/${tel.replace(/\D/g,'')}?text=${encodeURIComponent(waMsg)}`}
                    target="_blank" rel="noreferrer"
                    style={{ flex:1, background:'#25d366', border:'none', color:'white',
                      borderRadius:12, padding:'12px 0', fontSize:14, fontWeight:800,
                      textDecoration:'none', display:'flex', alignItems:'center',
                      justifyContent:'center', gap:6 }}>
                    💬 WhatsApp
                  </a>
                  <a href={`tel:${tel.replace(/\D/g,'')}`}
                    style={{ flex:1, background:'rgba(74,158,255,.15)',
                      border:'1.5px solid var(--blue)', color:'var(--blue)',
                      borderRadius:12, padding:'12px 0', fontSize:14, fontWeight:800,
                      textDecoration:'none', display:'flex', alignItems:'center',
                      justifyContent:'center', gap:6 }}>
                    📞 Llamar
                  </a>
                </div>
              )}
              {/* Botón entregar */}
              {confirmando === pedido.key ? (
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => marcarEntregado(pedido.key)}
                    style={{ flex:2, background:'var(--green)', color:'white', border:'none',
                      borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                      cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
                    ✅ SÍ, ENTREGADO
                  </button>
                  <button onClick={() => setConfirmando(null)}
                    style={{ flex:1, background:'var(--card)', border:'1px solid var(--border)',
                      color:'var(--muted)', borderRadius:12, padding:'13px 0',
                      fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmando(pedido.key)}
                  className="btn btn-success"
                  style={{ width:'100%', padding:'13px 0', fontSize:14, letterSpacing:2 }}>
                  📦 PEDIDO ENTREGADO
                </button>
              )}
              {/* Botón cancelar entrega — solo visible cuando no está en modo confirmar */}
              {confirmando !== pedido.key && (
                <button onClick={() => cancelarEntrega(pedido.key)}
                  style={{ width:'100%', background:'transparent',
                    border:'1px solid rgba(255,77,77,.35)', color:'var(--red)',
                    borderRadius:12, padding:'10px 0', fontSize:13, fontWeight:700,
                    cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1,
                    marginTop:2 }}>
                  ↩️ Cancelar entrega
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const empty = (icon, msg, sub='') => (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', padding:'60px 0', gap:12, color:'var(--muted)' }}>
      <div style={{ fontSize:64, opacity:.2 }}>{icon}</div>
      <div style={{ fontSize:15, letterSpacing:3, fontWeight:700 }}>{msg}</div>
      {sub && <div style={{ fontSize:12 }}>{sub}</div>}
    </div>
  )

  return (
    <div className="page">
      {welcomeVisible && (
        <div style={{ background:'linear-gradient(135deg,rgba(39,201,122,.15),rgba(39,201,122,.05))',
          borderBottom:'2px solid var(--green)', padding:'14px 20px',
          display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:28 }}>👋</span>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:'var(--green)' }}>
              ¡Bienvenido, {miNombre}!
            </div>
            <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>Listo para entregar 🛵</div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <span className="page-title">🛵 REPARTIDOR</span>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            <strong style={{ color:'var(--green)' }}>{miNombre}</strong>
            {miCelular && <span> · 📱 {miCelular}</span>}
          </div>
        </div>
        <div style={{ textAlign:'right', fontSize:12, color:'var(--muted)' }}>
          <div style={{ color:'var(--blue)', fontWeight:800 }}>{disponibles.length} disponibles</div>
          <div style={{ color:'var(--green)', fontWeight:800 }}>{misPedidos.length} activos</div>
        </div>
      </div>

      <div style={{ display:'flex', borderBottom:'2px solid var(--border)' }}>
        {[
          ['disponibles', `📦 Disponibles`, disponibles.length, 'var(--blue)'],
          ['mis_pedidos', `🛵 Mis pedidos`, misPedidos.length, 'var(--green)'],
          ['entregados',  `✅ Entregados`,  entregados.length,  'var(--muted)'],
        ].map(([t, l, count, c]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:'11px 0', background:'none', border:'none',
              borderBottom: tab===t ? `3px solid ${c}` : '3px solid transparent',
              color: tab===t ? c : 'var(--muted)',
              fontWeight:800, fontSize:11, letterSpacing:1,
              cursor:'pointer', fontFamily:'var(--font)', marginBottom:-2 }}>
            {l}{count > 0 ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        {tab === 'disponibles' && (
          disponibles.length === 0
            ? empty('📦', 'SIN PEDIDOS DISPONIBLES', 'Los pedidos listos en cocina aparecerán aquí')
            : disponibles.map(p => renderCard(p, 'disponible'))
        )}
        {tab === 'mis_pedidos' && (
          misPedidos.length === 0
            ? empty('🛵', 'SIN PEDIDOS ACTIVOS')
            : misPedidos.map(p => renderCard(p, 'mis'))
        )}
        {tab === 'entregados' && (
          entregados.length === 0
            ? empty('✅', 'SIN ENTREGADOS HOY')
            : entregados.map(pedido => (
                <div key={pedido.key} style={{ background:'var(--card)',
                  border:'1.5px solid var(--border)', borderRadius:14,
                  padding:'12px 16px', marginBottom:10, opacity:0.7 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ fontWeight:700 }}>✅ {pedido.cliente?.nombre}</div>
                      <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{pedido.cliente?.direccion}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:1 }}>
                        {fmt12(pedido.entregadoISO || pedido.timeISO)}
                      </div>
                    </div>
                    <div style={{ fontFamily:'var(--mono)', fontWeight:800, color:'var(--green)', fontSize:16 }}>
                      S/{pedido.total?.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))
        )}
      </div>
    </div>
  )
}
