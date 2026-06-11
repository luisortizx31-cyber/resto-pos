import { useEffect, useState, useRef } from 'react'
import { rtdb, db } from '../lib/firebase'
import { useSession } from '../components/Layout'
import DeliveryTab from './DeliveryTab'
import { ref, onValue, update } from 'firebase/database'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { fmt12, BEBIDAS_CAT } from '../lib/utils'

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function Timer({ timeISO }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = timeISO ? new Date(timeISO).getTime() : Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [timeISO])
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const urgent = elapsed >= 1200  // 20 min — crítico
  const warn   = elapsed >= 600   // 10 min — alerta
  const alarm  = elapsed >= 600 && elapsed % 60 === 0  // pitido cada minuto desde los 10 min

  useEffect(() => {
    if (alarm) playBeepMesa()
  }, [alarm])

  return (
    <div style={{ textAlign:'right' }}>
      <div style={{
        fontFamily:'var(--mono)', fontSize:32, fontWeight:500, lineHeight:1,
        color: urgent ? 'var(--red)' : warn ? 'var(--yellow)' : 'var(--green)',
        animation: urgent ? 'timerUrgent 0.5s infinite' : warn ? 'pulse 1s infinite' : 'none',
        textShadow: urgent ? '0 0 12px rgba(255,77,77,.8)' : warn ? '0 0 8px rgba(255,200,0,.5)' : 'none',
      }}>
        {mm}:{ss}
      </div>
      {warn && (
        <div style={{ fontSize:9, color: urgent ? 'var(--red)' : 'var(--yellow)',
          letterSpacing:1, fontWeight:800, textTransform:'uppercase', marginTop:2,
          animation:'pulse 1s infinite' }}>
          {urgent ? '⚠ URGENTE' : '⏰ DEMORADO'}
        </div>
      )}
      {!warn && (
        <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginTop:2 }}>
          en espera
        </div>
      )}
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes timerUrgent{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.05)}}
      `}</style>
    </div>
  )
}

function playBeepMesa() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.15, 0.3].forEach(t => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0, ctx.currentTime + t)
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + t + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3)
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.3)
    })
  } catch {}
}


export default function Cocina() {
  const session = useSession()
  const restoId = session?.restoId
  const [orders, setOrders]           = useState({})
  const [tab, setTab]                 = useState('pendientes')
  const [tieneDelivery, setTieneDelivery] = useState(true)
  const [togglingDelivery, setTogglingDelivery] = useState(false)
  const prevMesaKeys     = useRef(new Set())
  useClock() // mantiene timers vivos

  // Cargar config delivery del restaurante
  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId)).then(snap => {
      if (snap.exists()) setTieneDelivery(snap.data().tieneDelivery !== false)
    })
  }, [restoId])

  // Listener pedidos de mesa
  useEffect(() => {
    if (!restoId) return
    const unsub = onValue(ref(rtdb, `${restoId}/pedidos_activos`), snap => {
      const data = snap.val() || {}
      const newKeys = new Set(Object.keys(data))
      let hayNuevo = false
      newKeys.forEach(k => { if (!prevMesaKeys.current.has(k)) hayNuevo = true })
      if (hayNuevo) {
        playBeepMesa()
        setTab('pendientes') // auto-cambiar a pendientes cuando llega pedido de mesa
      }
      prevMesaKeys.current = newKeys
      setOrders(data)
    })
    return () => unsub()
  }, [restoId])

  // La detección de nuevos pedidos delivery y el auto-tab la hace DeliveryTab via onNuevoPedido

  const toggleDelivery = async () => {
    setTogglingDelivery(true)
    const nuevo = !tieneDelivery
    try {
      await updateDoc(doc(db, 'restaurantes', restoId), { tieneDelivery: nuevo })
      setTieneDelivery(nuevo)
      if (!nuevo && tab === 'delivery') setTab('pendientes')
    } catch {}
    setTogglingDelivery(false)
  }

  // Separar pedidos
  const pendingOrders = {}, listoOrders = {}
  Object.entries(orders).forEach(([key, order]) => {
    const itemsCocina = (order.items || []).filter(item =>
      !BEBIDAS_CAT.includes((item.category || '').toLowerCase().trim())
    )
    if (itemsCocina.length === 0 && !order.extras) return
    const enriched = { key, ...order, items: itemsCocina }
    if (order.status === 'listo')    listoOrders[key]   = enriched
    else if (order.status === 'pending') pendingOrders[key] = enriched
  })

  const groupByMesa = (obj) => {
    const byMesa = {}
    Object.values(obj).forEach(o => {
      if (!byMesa[o.mesa]) byMesa[o.mesa] = []
      byMesa[o.mesa].push(o)
    })
    Object.values(byMesa).forEach(arr => arr.sort((a,b) => new Date(a.timeISO)-new Date(b.timeISO)))
    return byMesa
  }

  const byMesaPending = groupByMesa(pendingOrders)
  const byMesaListo   = groupByMesa(listoOrders)
  const mesasPending  = Object.entries(byMesaPending).sort(([,a],[,b]) => {
    const oa = a.reduce((m,o)=>!m||new Date(o.timeISO)<new Date(m)?o.timeISO:m, null)
    const ob = b.reduce((m,o)=>!m||new Date(o.timeISO)<new Date(m)?o.timeISO:m, null)
    return new Date(oa)-new Date(ob)
  })
  const mesasListo = Object.entries(byMesaListo).sort(([a],[b])=>a-b)
  const totalPendientes = mesasPending.length
  const totalEntregados = mesasListo.length

  const marcarListo    = (key) => update(ref(rtdb, `${restoId}/pedidos_activos/${key}`), { status:'listo' })
  const desbloquearMesa = (key) => update(ref(rtdb, `${restoId}/pedidos_activos/${key}`), { status:'pending' })

  const days   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const renderMesaCard = (mesa, mesaOrders, isListo) => {
    const allItems  = mesaOrders.flatMap(o => o.items || [])
    const totalMesa = allItems.reduce((a,i) => a+i.price*i.qty, 0)
      + mesaOrders.reduce((a,o) => a+(o.extrasPrice||0), 0)
    return (
      <div key={mesa} style={{ background:'var(--card)',
        border:`2px solid ${isListo?'var(--green)':'var(--accent)'}`,
        borderRadius:18, overflow:'hidden',
        boxShadow: isListo?'0 0 24px rgba(39,201,122,.2)':'0 0 16px rgba(245,166,35,.1)',
        opacity: isListo ? 0.85 : 1 }}>
        <div style={{ padding:'14px 18px',
          background: isListo?'rgba(39,201,122,.07)':'rgba(245,166,35,.07)',
          borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:52, fontWeight:500,
              color: isListo?'var(--green)':'var(--accent)', lineHeight:1 }}>{mesa}</div>
            <div>
              <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:3, textTransform:'uppercase' }}>Mesa</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:14, color:'var(--accent)', fontWeight:700, marginTop:2 }}>
                S/{totalMesa.toFixed(2)}
              </div>
              {mesaOrders.length > 1 && (
                <div style={{ fontSize:10, color:'var(--blue)', fontWeight:800, marginTop:2 }}>
                  {mesaOrders.length} pedidos acumulados
                </div>
              )}
            </div>
          </div>
          {!isListo ? <Timer timeISO={mesaOrders[0]?.timeISO} /> : <div style={{ fontSize:32 }}>✅</div>}
        </div>
        <div style={{ padding:'12px 18px' }}>
          {mesaOrders.map((order, oi) => (
            <div key={order.key}>
              {mesaOrders.length > 1 && (
                <div style={{ display:'flex', alignItems:'center', gap:8,
                  marginBottom:6, marginTop: oi>0?10:0 }}>
                  <div style={{ height:1, flex:1, background:'var(--border)' }} />
                  <span style={{ fontSize:10, color:'var(--blue)', fontWeight:800,
                    letterSpacing:1, whiteSpace:'nowrap' }}>
                    {oi===0?'1er PEDIDO':`+PEDIDO ${oi+1}`} · {fmt12(order.timeISO)}
                  </span>
                  <div style={{ height:1, flex:1, background:'var(--border)' }} />
                </div>
              )}
              {(order.items||[]).map((item,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
                  padding:'6px 0', borderBottom: i<order.items.length-1?'1px solid var(--border)':'none' }}>
                  <div style={{ background:'var(--accent)', color:'#111', fontWeight:900, fontSize:12,
                    width:28, height:28, borderRadius:'50%', display:'flex',
                    alignItems:'center', justifyContent:'center', flexShrink:0 }}>×{item.qty}</div>
                  <div style={{ flex:1, fontWeight:600, fontSize:14 }}>{item.name}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--muted)' }}>
                    S/{(item.price*item.qty).toFixed(2)}
                  </div>
                </div>
              ))}
              {order.extras && (
                <div style={{ background:'rgba(245,200,66,.08)', border:'1px solid rgba(245,200,66,.25)',
                  borderRadius:10, padding:'8px 12px', marginTop:8 }}>
                  <div style={{ fontSize:9, color:'var(--yellow)', letterSpacing:2,
                    textTransform:'uppercase', fontWeight:800, marginBottom:3 }}>⭐ Adicional</div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div style={{ fontSize:13, color:'#ffe082', lineHeight:1.4, flex:1 }}>{order.extras}</div>
                    {order.extrasPrice > 0 && (
                      <div style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--yellow)',
                        fontWeight:700, marginLeft:8 }}>S/{Number(order.extrasPrice).toFixed(2)}</div>
                    )}
                  </div>
                </div>
              )}
              {mesaOrders.length === 1 && order.timeISO && (
                <div style={{ fontSize:10, color:'var(--muted)', marginTop:8 }}>
                  📌 Pedido: {fmt12(order.timeISO)}
                </div>
              )}
              {!isListo ? (
                <button className="btn btn-success"
                  style={{ width:'100%', borderRadius:10, fontSize:14,
                    letterSpacing:2, padding:'12px 0', marginTop:10 }}
                  onClick={() => marcarListo(order.key)}>
                  ✅ LISTO — {mesaOrders.length>1?`PEDIDO ${oi+1}`:'ENTREGAR'}
                </button>
              ) : (
                <button onClick={() => desbloquearMesa(order.key)}
                  style={{ width:'100%', background:'rgba(74,158,255,.15)',
                    border:'1px solid var(--blue)', color:'var(--blue)',
                    borderRadius:10, padding:'10px 14px', marginTop:10,
                    fontSize:12, fontWeight:800, cursor:'pointer',
                    fontFamily:'var(--font)', letterSpacing:1 }}>
                  🔓 VOLVER A PENDIENTE
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span className="page-title">COCINA</span>
            {totalPendientes > 0 && (
              <span style={{ background:'var(--accent)', color:'#111', borderRadius:20,
                fontSize:11, fontWeight:900, padding:'2px 8px' }}>{totalPendientes}</span>
            )}
          </div>
          <div style={{ fontSize:10, color:'var(--muted)', letterSpacing:2, marginTop:2 }}>
            {session?.restoNombre?.toUpperCase()} · {days[new Date().getDay()]} {new Date().getDate()} {months[new Date().getMonth()]}
          </div>
        </div>
        {/* Switch Delivery */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, color:'var(--muted)', letterSpacing:1 }}>DELIVERY</span>
          <button onClick={toggleDelivery} disabled={togglingDelivery}
            style={{ width:48, height:26, borderRadius:13, border:'none', cursor:'pointer',
              background: tieneDelivery ? 'var(--green)' : 'var(--border)',
              position:'relative', transition:'background .2s', flexShrink:0 }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:'white',
              position:'absolute', top:3,
              left: tieneDelivery ? 25 : 3,
              transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,.3)' }} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'2px solid var(--border)' }}>
        <button onClick={() => setTab('pendientes')}
          style={{ flex:1, padding:'12px 0', background:'none', border:'none',
            borderBottom: tab==='pendientes'?'3px solid var(--accent)':'3px solid transparent',
            color: tab==='pendientes'?'var(--accent)':'var(--muted)',
            fontWeight:800, fontSize:13, letterSpacing:2, cursor:'pointer',
            fontFamily:'var(--font)', marginBottom:-2 }}>
          🔥 PENDIENTES {totalPendientes>0?`(${totalPendientes})`:''}
        </button>
        {tieneDelivery && (
          <button onClick={() => setTab('delivery')}
            style={{ flex:1, padding:'12px 0', background:'none', border:'none',
              borderBottom: tab==='delivery'?'3px solid var(--blue)':'3px solid transparent',
              color: tab==='delivery'?'var(--blue)':'var(--muted)',
              fontWeight:800, fontSize:13, letterSpacing:2, cursor:'pointer',
              fontFamily:'var(--font)', marginBottom:-2 }}>
            🛵 DELIVERY
          </button>
        )}
        <button onClick={() => setTab('entregados')}
          style={{ flex:1, padding:'12px 0', background:'none', border:'none',
            borderBottom: tab==='entregados'?'3px solid var(--green)':'3px solid transparent',
            color: tab==='entregados'?'var(--green)':'var(--muted)',
            fontWeight:800, fontSize:13, letterSpacing:2, cursor:'pointer',
            fontFamily:'var(--font)', marginBottom:-2 }}>
          ✅ ENTREGADOS {totalEntregados>0?`(${totalEntregados})`:''}
        </button>
      </div>

      {tab==='pendientes' && (
        mesasPending.length===0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', flex:1, padding:40, gap:12, color:'var(--muted)' }}>
            <div style={{ fontSize:72, opacity:.2 }}>🍽</div>
            <div style={{ fontSize:16, letterSpacing:3, fontWeight:700 }}>SIN PEDIDOS PENDIENTES</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',
            gap:20, padding:20 }}>
            {mesasPending.map(([mesa, orders]) => renderMesaCard(mesa, orders, false))}
          </div>
        )
      )}

      {tab==='delivery' && tieneDelivery && <DeliveryTab restoId={restoId} onNuevoPedido={() => setTab('delivery')} />}

      {tab==='entregados' && (
        mesasListo.length===0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', flex:1, padding:40, gap:12, color:'var(--muted)' }}>
            <div style={{ fontSize:72, opacity:.2 }}>✅</div>
            <div style={{ fontSize:16, letterSpacing:3, fontWeight:700 }}>SIN PEDIDOS ENTREGADOS</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',
            gap:20, padding:20 }}>
            {mesasListo.map(([mesa, orders]) => renderMesaCard(mesa, orders, true))}
          </div>
        )
      )}
    </div>
  )
}
