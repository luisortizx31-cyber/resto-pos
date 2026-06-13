import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { collection, query, orderBy, limit, getDocs, where, writeBatch, getDoc, doc } from 'firebase/firestore'
import { useToast, useSession } from '../components/Layout'
import { fmt12Date } from '../lib/utils'

export default function Historial() {
  const session = useSession()
  const restoId = session?.restoId
  const [orders, setOrders]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [filter, setFilter]           = useState('hoy')
  const [fechaDesde, setFechaDesde]   = useState('')
  const [fechaHasta, setFechaHasta]   = useState('')
  const [clearing, setClearing]       = useState(false)
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  const [whatsapp, setWhatsapp]       = useState('')
  const [enviando, setEnviando]       = useState(false)
  const showToast = useToast()

  // Cargar WhatsApp del dueño
  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId)).then(snap => {
      if (snap.exists()) setWhatsapp(snap.data().whatsapp || '')
    })
  }, [restoId])

  const load = async () => {
    setLoading(true)
    try {
      const col = collection(db, 'restaurantes', restoId, 'historial')
      let q
      if (filter === 'hoy') {
        const start = new Date(); start.setHours(0,0,0,0)
        q = query(col, where('completedAtISO','>=',start.toISOString()),
          orderBy('completedAtISO','desc'), limit(100))
      } else if (filter === 'semana') {
        const start = new Date(); start.setDate(start.getDate()-7)
        q = query(col, where('completedAtISO','>=',start.toISOString()),
          orderBy('completedAtISO','desc'), limit(200))
      } else if (filter === 'fecha' && fechaDesde) {
        const start = new Date(fechaDesde); start.setHours(0,0,0,0)
        const end   = fechaHasta ? new Date(fechaHasta) : new Date(fechaDesde)
        end.setHours(23,59,59,999)
        q = query(col,
          where('completedAtISO','>=',start.toISOString()),
          where('completedAtISO','<=',end.toISOString()),
          orderBy('completedAtISO','desc'), limit(300))
      } else {
        q = query(col, orderBy('completedAtISO','desc'), limit(300))
      }
      const snap = await getDocs(q)
      setOrders(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    } catch (e) {
      console.error(e)
      try {
        const snap = await getDocs(query(
          collection(db,'restaurantes',restoId,'historial'),
          orderBy('completedAtISO','desc'), limit(200)))
        setOrders(snap.docs.map(d => ({ id:d.id, ...d.data() })))
      } catch {}
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [filter, fechaDesde, fechaHasta])

  const limpiarHistorial = async () => {
    if (!confirmLimpiar) { setConfirmLimpiar(true); return }
    setClearing(true)
    try {
      const snap = await getDocs(collection(db,'restaurantes',restoId,'historial'))
      const batch = writeBatch(db)
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      setOrders([])
      showToast('🗑 Historial limpiado')
    } catch { showToast('Error al limpiar','error') }
    setClearing(false)
    setConfirmLimpiar(false)
  }

  // ── Cálculos separados mesa / delivery ───────────────────────────
  const pedidosMesa     = orders.filter(o => o.tipo !== 'delivery')
  const pedidosDelivery = orders.filter(o => o.tipo === 'delivery')

  const getTotal = o => o.totalFinal ||
    (o.items||[]).reduce((a,i) => a+i.price*i.qty, 0) + (o.extrasPrice||0)

  const totalMesa         = pedidosMesa.reduce((a,o) => a+getTotal(o), 0)
  const totalDelivery     = pedidosDelivery.reduce((a,o) => a+getTotal(o), 0)
  const totalVentas       = totalMesa + totalDelivery

  // Yape: mesas usan pagoYape; delivery usa clientePago==='yape'
  const totalYapeMesa     = pedidosMesa.reduce((a,o) => a+(o.pagoYape||0), 0)
  const totalYapeDelivery = pedidosDelivery
    .filter(o => o.clientePago === 'yape')
    .reduce((a,o) => a+getTotal(o), 0)
  const totalYape         = totalYapeMesa + totalYapeDelivery

  // Efectivo
  const totalEfectivoMesa     = pedidosMesa.reduce((a,o) => a+(o.pagoEfectivo||0), 0)
  const totalEfectivoDelivery = pedidosDelivery
    .filter(o => o.clientePago !== 'yape')
    .reduce((a,o) => a+getTotal(o), 0)
  const totalEfectivo = totalEfectivoMesa + totalEfectivoDelivery

  // ── Generar y enviar reporte por WhatsApp ────────────────────────
  const enviarReporteWA = () => {
    if (!whatsapp) { showToast('⚠️ Configura el WhatsApp en Config primero', 'error'); return }
    setEnviando(true)

    const hoy = new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' })
    const periodo = filter === 'hoy' ? 'Hoy' : filter === 'semana' ? 'Últimos 7 días' :
      filter === 'fecha' && fechaDesde ? `${fechaDesde}${fechaHasta?' → '+fechaHasta:''}` : 'Todo'

    const lineas = [
      `📊 *REPORTE DE VENTAS*`,
      `📅 ${periodo} — ${hoy}`,
      ``,
      `🍽 *MESAS*`,
      `   Pedidos: ${pedidosMesa.length}`,
      `   Total: S/${totalMesa.toFixed(2)}`,
      `   📲 Yape: S/${totalYapeMesa.toFixed(2)}`,
      `   💵 Efectivo: S/${totalEfectivoMesa.toFixed(2)}`,
    ]

    if (pedidosDelivery.length > 0) {
      lineas.push(``)
      lineas.push(`🛵 *DELIVERY*`)
      lineas.push(`   Pedidos: ${pedidosDelivery.length}`)
      lineas.push(`   Total: S/${totalDelivery.toFixed(2)}`)
      lineas.push(`   📲 Yape: S/${totalYapeDelivery.toFixed(2)}`)
      lineas.push(`   💵 Efectivo: S/${totalEfectivoDelivery.toFixed(2)}`)
    }

    lineas.push(``)
    lineas.push(`━━━━━━━━━━━━━━━`)
    lineas.push(`💰 *TOTAL GENERAL: S/${totalVentas.toFixed(2)}*`)
    lineas.push(`   📲 Total Yape: S/${totalYape.toFixed(2)}`)
    lineas.push(`   💵 Total Efectivo: S/${totalEfectivo.toFixed(2)}`)
    lineas.push(`━━━━━━━━━━━━━━━`)
    lineas.push(`_GastroFlow · ${new Date().toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}_`)

    const texto = lineas.join('\n')
    const num = whatsapp.replace(/\D/g,'')
    const url = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
    window.open(url, '_blank')
    setEnviando(false)
  }

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">HISTORIAL</span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--green)', fontWeight:700 }}>
            S/{totalVentas.toFixed(2)}
          </span>
          <button onClick={enviarReporteWA} disabled={enviando || orders.length===0}
            style={{ background:'#25D366', color:'white', border:'none',
              borderRadius:10, padding:'7px 12px', fontSize:12, fontWeight:800,
              cursor:'pointer', fontFamily:'var(--font)', display:'flex',
              alignItems:'center', gap:5 }}>
            📤 WhatsApp
          </button>
          <button className="btn btn-danger"
            style={{ padding:'7px 12px', fontSize:12 }}
            disabled={clearing || orders.length===0}
            onClick={limpiarHistorial}>
            {clearing ? '...' : '🗑'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom: filter==='fecha' ? 10 : 0 }}>
          {[['hoy','Hoy'],['semana','7 días'],['todo','Todo'],['fecha','📅 Fecha']].map(([val,label]) => (
            <button key={val} onClick={() => setFilter(val)} style={{
              background: filter===val ? 'var(--accent)' : 'var(--card)',
              border: `1.5px solid ${filter===val ? 'var(--accent)' : 'var(--border)'}`,
              color: filter===val ? '#111' : 'var(--muted)',
              borderRadius:20, padding:'7px 16px',
              fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)',
            }}>{label}</button>
          ))}
        </div>
        {filter === 'fecha' && (
          <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:3, flex:1 }}>
              <label style={{ fontSize:10, color:'var(--muted)', letterSpacing:1,
                textTransform:'uppercase', fontWeight:700 }}>Desde</label>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                style={{ background:'var(--card)', border:'1.5px solid var(--border)',
                  borderRadius:10, padding:'8px 12px', color:'var(--text)',
                  fontSize:14, fontFamily:'var(--font)', outline:'none', width:'100%' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:3, flex:1 }}>
              <label style={{ fontSize:10, color:'var(--muted)', letterSpacing:1,
                textTransform:'uppercase', fontWeight:700 }}>Hasta</label>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                min={fechaDesde}
                style={{ background:'var(--card)', border:'1.5px solid var(--border)',
                  borderRadius:10, padding:'8px 12px', color:'var(--text)',
                  fontSize:14, fontFamily:'var(--font)', outline:'none', width:'100%' }} />
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ padding:'14px 16px 6px', display:'flex', flexDirection:'column', gap:10 }}>
        {/* Fila 1 — totales generales */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
            borderRadius:14, padding:'14px 16px' }}>
            <div style={{ fontSize:20, marginBottom:4 }}>📋</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:22, fontWeight:500,
              color:'var(--accent)' }}>{orders.length}</div>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginTop:2 }}>Pedidos</div>
          </div>
          <div style={{ background:'var(--card)', border:'1.5px solid var(--green)',
            borderRadius:14, padding:'14px 16px' }}>
            <div style={{ fontSize:20, marginBottom:4 }}>💰</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:22, fontWeight:500,
              color:'var(--green)' }}>S/{totalVentas.toFixed(2)}</div>
            <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginTop:2 }}>Total ventas</div>
          </div>
        </div>
        {/* Fila 2 — métodos de pago */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          <div style={{ background:'var(--card)', border:'1.5px solid #6c47ff33',
            borderRadius:14, padding:'12px 14px' }}>
            <div style={{ fontSize:18, marginBottom:4 }}>📲</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:17, fontWeight:700,
              color:'#a78bfa' }}>S/{totalYape.toFixed(2)}</div>
            <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginTop:2 }}>Yape</div>
          </div>
          <div style={{ background:'var(--card)', border:'1.5px solid rgba(39,201,122,.25)',
            borderRadius:14, padding:'12px 14px' }}>
            <div style={{ fontSize:18, marginBottom:4 }}>💵</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:17, fontWeight:700,
              color:'var(--green)' }}>S/{totalEfectivo.toFixed(2)}</div>
            <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginTop:2 }}>Efectivo</div>
          </div>
          <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
            borderRadius:14, padding:'12px 14px' }}>
            <div style={{ fontSize:18, marginBottom:4 }}>🧾</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:17, fontWeight:700,
              color:'var(--accent)' }}>S/{(totalYape+totalEfectivo).toFixed(2)}</div>
            <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
              textTransform:'uppercase', marginTop:2 }}>Cobrado</div>
          </div>
        </div>
        {/* Fila 3 — desglose mesa vs delivery (solo si hay delivery) */}
        {pedidosDelivery.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div style={{ background:'var(--card)', border:'1.5px solid rgba(245,166,35,.3)',
              borderRadius:14, padding:'12px 14px' }}>
              <div style={{ fontSize:16, marginBottom:4 }}>🍽</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:16, fontWeight:700,
                color:'var(--accent)' }}>S/{totalMesa.toFixed(2)}</div>
              <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                textTransform:'uppercase', marginTop:2 }}>Mesas ({pedidosMesa.length})</div>
            </div>
            <div style={{ background:'var(--card)', border:'1.5px solid rgba(74,158,255,.3)',
              borderRadius:14, padding:'12px 14px' }}>
              <div style={{ fontSize:16, marginBottom:4 }}>🛵</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:16, fontWeight:700,
                color:'var(--blue)' }}>S/{totalDelivery.toFixed(2)}</div>
              <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2,
                textTransform:'uppercase', marginTop:2 }}>Delivery ({pedidosDelivery.length})</div>
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Cargando...</div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
          <div style={{ fontSize:48, opacity:.3, marginBottom:12 }}>📋</div>
          <div style={{ letterSpacing:2, fontSize:14 }}>Sin pedidos en este período</div>
        </div>
      ) : (
        <div style={{ padding:'8px 16px' }}>
          {orders.map(order => {
            const total       = getTotal(order)
            const esDelivery  = order.tipo === 'delivery'
            // Soportar ambos formatos: clientePago (Repartidor) y pagoYape/pagoEfectivo (DeliveryTab)
            let tieneYape, tieneEfec, montoYape, montoEfec
            if (esDelivery) {
              if (order.clientePago) {
                tieneYape  = order.clientePago === 'yape'
                tieneEfec  = order.clientePago !== 'yape'
                montoYape  = tieneYape  ? total : 0
                montoEfec  = tieneEfec  ? total : 0
              } else {
                tieneYape  = (order.pagoYape  || 0) > 0
                tieneEfec  = (order.pagoEfectivo || 0) > 0
                montoYape  = order.pagoYape      || 0
                montoEfec  = order.pagoEfectivo  || 0
              }
            } else {
              tieneYape  = (order.pagoYape     || 0) > 0
              tieneEfec  = (order.pagoEfectivo || 0) > 0
              montoYape  = order.pagoYape      || 0
              montoEfec  = order.pagoEfectivo  || 0
            }
            return (
              <div key={order.id} style={{ background:'var(--card)',
                border:`1.5px solid ${esDelivery ? 'rgba(74,158,255,.4)' : 'var(--border)'}`,
                borderRadius:14, padding:14, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{
                      background: esDelivery ? 'var(--blue)' : 'var(--accent)',
                      color:'#111', fontFamily:'var(--mono)', fontWeight:700,
                      fontSize: esDelivery ? 14 : 18,
                      width:42, height:42, borderRadius:10,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {esDelivery ? '🛵' : order.mesa}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
                        {esDelivery ? (
                          <>
                            <span style={{ color:'var(--blue)' }}>Delivery</span>
                            {order.clienteNombre && (
                              <span style={{ fontSize:11, color:'var(--muted)', fontWeight:400 }}>
                                · {order.clienteNombre}
                              </span>
                            )}
                          </>
                        ) : `Mesa ${order.mesa}`}
                      </div>
                      <div style={{ fontSize:11, color:'var(--muted)' }}>
                        {fmt12Date(order.completedAtISO)}
                      </div>
                      {esDelivery && order.clienteDireccion && (
                        <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                          📍 {order.clienteDireccion}
                        </div>
                      )}
                      {esDelivery && order.repartidorNombre && (
                        <div style={{ fontSize:11, marginTop:4, display:'flex', alignItems:'center', gap:4 }}>
                          <span style={{ background:'rgba(74,158,255,.12)', border:'1px solid rgba(74,158,255,.3)',
                            borderRadius:20, padding:'2px 8px', color:'#4a9eff', fontWeight:700 }}>
                            🛵 {order.repartidorNombre}
                          </span>
                          {order.repartidorAnterior && order.repartidorAnterior !== order.repartidorNombre && (
                            <span style={{ fontSize:10, color:'var(--muted)' }}>
                              (antes: {order.repartidorAnterior})
                            </span>
                          )}
                        </div>
                      )}
                      {esDelivery && !order.repartidorNombre && (
                        <div style={{ fontSize:11, marginTop:4 }}>
                          <span style={{ background:'rgba(255,77,77,.1)', border:'1px solid rgba(255,77,77,.3)',
                            borderRadius:20, padding:'2px 8px', color:'var(--red)', fontWeight:700 }}>
                            Sin repartidor asignado
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'var(--mono)',
                      color: esDelivery ? 'var(--blue)' : 'var(--green)',
                      fontSize:16, fontWeight:700 }}>S/{total.toFixed(2)}</div>
                    {order.descuento > 0 && (
                      <div style={{ fontSize:10, color:'var(--red)', fontFamily:'var(--mono)' }}>
                        -S/{order.descuento.toFixed(2)} dto.
                      </div>
                    )}
                  </div>
                </div>

                {/* Pago */}
                <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                  {tieneYape && (
                    <div style={{ flex:1, background:'rgba(108,71,255,.08)',
                      border:'1px solid rgba(108,71,255,.25)',
                      borderRadius:8, padding:'5px 10px',
                      display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'#a78bfa' }}>📲 Yape</span>
                      <span style={{ fontFamily:'var(--mono)', fontSize:12,
                        fontWeight:700, color:'#a78bfa' }}>
                        S/{montoYape.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {tieneEfec && (
                    <div style={{ flex:1, background:'rgba(39,201,122,.08)',
                      border:'1px solid rgba(39,201,122,.25)',
                      borderRadius:8, padding:'5px 10px',
                      display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'var(--green)' }}>💵 Efectivo</span>
                      <span style={{ fontFamily:'var(--mono)', fontSize:12,
                        fontWeight:700, color:'var(--green)' }}>
                        S/{montoEfec.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Items */}
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:8 }}>
                  {(order.items||[]).map((item,i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between',
                      fontSize:13, color:'var(--muted2)', padding:'3px 0' }}>
                      <span>×{item.qty} {item.name}</span>
                      <span style={{ fontFamily:'var(--mono)' }}>S/{(item.price*item.qty).toFixed(2)}</span>
                    </div>
                  ))}
                  {order.extras && (
                    <div style={{ fontSize:12, color:'var(--yellow)', marginTop:4, fontStyle:'italic' }}>
                      ⭐ {order.extras}
                      {order.extrasPrice > 0 && (
                        <span style={{ fontFamily:'var(--mono)', marginLeft:6 }}>
                          S/{Number(order.extrasPrice).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal confirmar limpiar */}
      {confirmLimpiar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--red)',
            padding:26, width:'100%', maxWidth:320, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>¿Limpiar historial?</div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:22 }}>
              Esta acción no se puede deshacer.
            </div>
            <button onClick={limpiarHistorial} disabled={clearing}
              style={{ width:'100%', background:'var(--red)', color:'white', border:'none',
                borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:10 }}>
              {clearing ? 'LIMPIANDO...' : '🗑 SÍ, LIMPIAR TODO'}
            </button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => setConfirmLimpiar(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
