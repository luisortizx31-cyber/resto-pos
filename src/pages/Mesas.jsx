import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { rtdb, db } from '../lib/firebase'
import { ref, onValue, remove, update, set } from 'firebase/database'
import { collection, addDoc, doc, getDoc, setDoc, updateDoc, query, where, getDocs } from 'firebase/firestore'
import { useToast, useSession } from '../components/Layout'
import { fmt12, mergeItems } from '../lib/utils'

export default function Mesas() {
  const session = useSession()
  const restoId = session?.restoId
  const [activeOrders, setActiveOrders]   = useState({})
  const [mesasActivas, setMesasActivas]   = useState(new Set())
  const [confirming, setConfirming]       = useState(null)
  const [confirmandoCliente, setConfirmandoCliente] = useState(null)
  const [processing, setProcessing]       = useState(false)
  const [deletingKey, setDeletingKey]     = useState(null)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null)
  const [descuento, setDescuento]         = useState({ tipo:'pct', valor:'' })
  const [pago, setPago]                   = useState({ yape: '', efectivo: '' }) // montos por método
  const [comprobante, setComprobante]     = useState(null)
  const [numMesas, setNumMesas]           = useState(10)
  const [editandoMesas, setEditandoMesas] = useState(false)
  const [nuevoNum, setNuevoNum]           = useState('')
  const [notifMesas, setNotifMesas]       = useState(new Set())
  const prevListoCount  = useRef({})
  const prevClienteCount = useRef(0)
  const navigate = useNavigate()
  const showToast = useToast()

  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId, 'config', 'mesas')).then(snap => {
      if (snap.exists()) setNumMesas(snap.data().total || 10)
    })
  }, [restoId])

  useEffect(() => {
    if (!restoId) return
    const unsub = onValue(ref(rtdb, `${restoId}/pedidos_activos`), snap => {
      const data = snap.val() || {}
      setActiveOrders(data)
      // Todos los pedidos del cliente (incluyendo solo bebidas) pasan por confirmación del mesero
    })
    return () => unsub()
  }, [restoId])

  useEffect(() => {
    if (!restoId) return
    const unsub = onValue(ref(rtdb, `${restoId}/mesas_activas`), snap => {
      const data = snap.val() || {}
      setMesasActivas(new Set(Object.keys(data).map(Number)))
    })
    return () => unsub()
  }, [restoId])

  // Sonido pedido listo
  useEffect(() => {
    const listosByMesa = {}
    Object.values(activeOrders).forEach(o => {
      if (o.status === 'listo') listosByMesa[o.mesa] = (listosByMesa[o.mesa] || 0) + 1
    })
    const nuevas = new Set()
    Object.keys(listosByMesa).forEach(mesa => {
      if (listosByMesa[mesa] > (prevListoCount.current[mesa] || 0)) nuevas.add(Number(mesa))
    })
    if (nuevas.size > 0) {
      setNotifMesas(prev => new Set([...prev, ...nuevas]))
      if (navigator.vibrate) navigator.vibrate([200,100,200])
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 660; osc.type = 'sine'
        gain.gain.setValueAtTime(0.4, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
        osc.start(); osc.stop(ctx.currentTime + 0.8)
      } catch {}
    }
    prevListoCount.current = listosByMesa
  }, [activeOrders])

  // Sonido pedido cliente
  useEffect(() => {
    const esperando = Object.values(activeOrders).filter(o => o.status === 'esperando_confirmacion').length
    if (esperando > prevClienteCount.current) {
      if (navigator.vibrate) navigator.vibrate([100,50,100,50,200])
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        ;[0,0.2,0.4].forEach((t,i) => {
          const osc = ctx.createOscillator(), gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.value = i%2===0 ? 520 : 660
          gain.gain.setValueAtTime(0.35, ctx.currentTime+t)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+t+0.25)
          osc.start(ctx.currentTime+t); osc.stop(ctx.currentTime+t+0.25)
        })
      } catch {}
    }
    prevClienteCount.current = esperando
  }, [activeOrders])

  const getOrdersForMesa = (num) =>
    Object.entries(activeOrders).filter(([,o]) => o.mesa===num && (o.status==='pending'||o.status==='listo'))

  const getPedidosEsperando = () =>
    Object.entries(activeOrders).filter(([,o]) => o.status==='esperando_confirmacion')

  const getMesaStatus = (num) => {
    const orders = getOrdersForMesa(num)
    if (orders.length === 0) return 'libre'
    if (orders.every(([,o]) => o.status==='listo')) return 'listo'
    return 'ocupada'
  }

  const calcTotal = (orders, desc) => {
    const bruto = orders.reduce((a,[,o]) =>
      a + (o.items||[]).reduce((b,i) => b+i.price*i.qty, 0) + (o.extrasPrice||0), 0)
    if (!desc.valor || parseFloat(desc.valor)<=0) return { bruto, descuentoAmt:0, total:bruto }
    const descuentoAmt = desc.tipo==='pct' ? bruto*parseFloat(desc.valor)/100 : parseFloat(desc.valor)
    return { bruto, descuentoAmt: Math.min(descuentoAmt,bruto), total: Math.max(0,bruto-descuentoAmt) }
  }


  const handleMesaClick = async (num) => {
    const status = getMesaStatus(num)
    setNotifMesas(prev => { const s=new Set(prev); s.delete(num); return s })
    if (status==='listo'||status==='ocupada') {
      setDescuento({ tipo:'pct', valor:'' })
      setConfirming({ num, orders: getOrdersForMesa(num) })
    } else {
      navigate(`/pedido/${num}`)
    }
  }

  // Limpiar TODOS los pedidos de una mesa (cualquier status) y liberar mesa
  const limpiarPedidosAtascados = async (num) => {
    const todos = Object.entries(activeOrders).filter(([, o]) => o.mesa === num)
    for (const [key] of todos) {
      await remove(ref(rtdb, `${restoId}/pedidos_activos/${key}`))
    }
    await remove(ref(rtdb, `${restoId}/mesas_activas/${num}`))
    showToast(`🧹 Mesa ${num} liberada (${todos.length} pedido(s) eliminado(s))`)
    setConfirming(null)
  }

  const eliminarPedido = async (key) => {
    setConfirmDeleteKey(key)
  }

  const eliminarPedidoConfirmado = async () => {
    const key = confirmDeleteKey
    setConfirmDeleteKey(null)
    setDeletingKey(key)
    try {
      await remove(ref(rtdb, `${restoId}/pedidos_activos/${key}`))
      showToast('🗑 Pedido eliminado')
      if (confirming) {
        const newOrders = confirming.orders.filter(([k]) => k!==key)
        if (newOrders.length===0) setConfirming(null)
        else setConfirming({ ...confirming, orders: newOrders })
      }
    } catch { showToast('Error al eliminar','error') }
    setDeletingKey(null)
  }

  const confirmarPedidoCliente = async (key, mesa) => {
    const order = activeOrders[key]
    const nuevoStatus = order?.soloBebidas ? 'listo' : 'pending'
    await update(ref(rtdb, `${restoId}/pedidos_activos/${key}`), { status: nuevoStatus })
    await set(ref(rtdb, `${restoId}/mesas_activas/${mesa}`), true)
    setConfirmandoCliente(null)
    showToast(order?.soloBebidas ? '🥤 Bebidas confirmadas — listas para cobrar' : '✅ Pedido confirmado — enviado a cocina')
  }

  const rechazarPedidoCliente = async (key) => {
    await remove(ref(rtdb, `${restoId}/pedidos_activos/${key}`))
    setConfirmandoCliente(null)
    showToast('❌ Pedido rechazado')
  }

  const cobrar = async () => {
    if (!confirming||processing) return
    setProcessing(true)
    const { bruto, descuentoAmt, total } = calcTotal(confirming.orders, descuento)
    const merged = mergeItems(confirming.orders)
    const pagoYape     = parseFloat(pago.yape)     || 0
    const pagoEfectivo = parseFloat(pago.efectivo) || 0
    // Efectivo real recibido (sin vuelto)
    const efectivoNecesario      = Math.max(0, total - pagoYape)
    const efectivoRealRecibido   = pagoEfectivo > efectivoNecesario ? efectivoNecesario : pagoEfectivo
    try {
      // 1. Guardar UN SOLO registro en historial con el total correcto y todos los items fusionados
      try {
        await addDoc(collection(db, 'restaurantes', restoId, 'historial'), {
          mesa:          confirming.num,
          items:         merged,
          extras:        confirming.orders.map(([,o]) => o.extras||'').filter(Boolean).join(' / '),
          extrasPrice:   confirming.orders.reduce((a,[,o]) => a+(o.extrasPrice||0), 0),
          timeISO:       confirming.orders[0]?.[1]?.timeISO || new Date().toISOString(),
          completedAtISO: new Date().toISOString(),
          descuento:     descuentoAmt,
          totalFinal:    total,
          pagoYape,
          pagoEfectivo:  efectivoRealRecibido,
        })
      } catch {}

      // 2. Limpiar todos los pedidos RTDB de la mesa
      for (const [key] of confirming.orders) {
        await remove(ref(rtdb, `${restoId}/pedidos_activos/${key}`))
      }

      // 2. Finalizar pedido en Firestore y limpiar mesa
      try {
        const mesaDocRef = doc(db, 'restaurantes', restoId, 'mesas', String(confirming.num))

        // Recopilar todos los pedidoFirestoreId únicos de los pedidos RTDB
        const firestoreIds = [...new Set(
          confirming.orders.map(([,o]) => o.pedidoFirestoreId).filter(Boolean)
        )]

        // Marcar cada pedido Firestore como finalizado
        for (const pid of firestoreIds) {
          try {
            await updateDoc(doc(db, 'restaurantes', restoId, 'pedidos', pid), {
              estado: 'finalizado',
              finalizadoEn: new Date().toISOString(),
              totalFinal: total,
              descuento: descuentoAmt,
            })
          } catch {}
        }

        // Fallback: también intentar via pedidoActivoId del doc de mesa
        const mesaSnap = await getDoc(mesaDocRef)
        if (mesaSnap.exists() && mesaSnap.data().pedidoActivoId) {
          const pid = mesaSnap.data().pedidoActivoId
          if (!firestoreIds.includes(pid)) {
            try {
              await updateDoc(doc(db, 'restaurantes', restoId, 'pedidos', pid), {
                estado: 'finalizado',
                finalizadoEn: new Date().toISOString(),
                totalFinal: total,
                descuento: descuentoAmt,
              })
            } catch {}
          }
        }

        const cobradoEn = new Date().toISOString()
        await setDoc(mesaDocRef, { estado: 'libre', pedidoActivoId: null, cobradoEn }, { merge: true })
      } catch {}

      // 3. Limpiar RTDB mesas_activas
      await remove(ref(rtdb, `${restoId}/mesas_activas/${confirming.num}`))

      // 4. Cerrar QR de esta mesa automáticamente
      try {
        const restoRef  = doc(db, 'restaurantes', restoId)
        const restoSnap = await getDoc(restoRef)
        const mesasOff  = restoSnap.exists() ? (restoSnap.data().qrMesasOff || []) : []
        if (!mesasOff.includes(confirming.num)) {
          await updateDoc(restoRef, { qrMesasOff: [...mesasOff, confirming.num] })
        }
      } catch {}

      setComprobante({ num:confirming.num, orders:confirming.orders,
        mergedItems:merged, bruto, descuentoAmt, total,
        pagoYape, pagoEfectivo: efectivoRealRecibido,
        vuelto: Math.max(0, pagoEfectivo - efectivoNecesario),
        hora: fmt12(new Date().toISOString()) })
      setConfirming(null)
      setPago({ yape:'', efectivo:'' })
    } catch { showToast('Error al cobrar','error') }
    setProcessing(false)
  }

  const guardarMesas = async () => {
    const n = parseInt(nuevoNum)
    if (!n||n<1||n>50) { showToast('Ingresa entre 1 y 50','error'); return }
    await setDoc(doc(db,'restaurantes',restoId,'config','mesas'), { total:n })
    setNumMesas(n); setEditandoMesas(false); setNuevoNum('')
    showToast(`✅ Mesas actualizadas a ${n}`)
  }

  const statusColors = {
    libre:   { border:'var(--border)',  bg:'var(--card)',        iconBg:'linear-gradient(135deg,var(--accent),var(--accent2))', iconColor:'#111' },
    ocupada: { border:'var(--accent2)', bg:'rgba(232,82,26,.1)', iconBg:'linear-gradient(135deg,var(--accent2),var(--accent))', iconColor:'#111' },
    listo:   { border:'var(--green)',   bg:'rgba(39,201,122,.1)',iconBg:'linear-gradient(135deg,var(--green),#1aad63)',         iconColor:'#0a1a12' },
  }

  const mesasList = Array.from({ length: numMesas }, (_,i) => i+1)

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">{(session?.restoNombre || restoId || 'RESTO POS').toUpperCase()}</span>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:12, color:'var(--muted)', letterSpacing:2 }}>
            {Object.keys(activeOrders).length} PEDIDOS
          </span>
          <button onClick={() => { setEditandoMesas(true); setNuevoNum(String(numMesas)) }}
            style={{ background:'var(--surface)', border:'1px solid var(--border)',
              color:'var(--muted)', borderRadius:8, padding:'4px 10px',
              fontSize:11, cursor:'pointer', fontFamily:'var(--font)', letterSpacing:1 }}>
            ⚙ MESAS
          </button>
        </div>
      </div>

      {/* Banner pedidos listos */}
      {notifMesas.size > 0 && (
        <div style={{ background:'rgba(39,201,122,.12)', borderBottom:'2px solid var(--green)',
          padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:20 }}>🔔</span>
          <span style={{ color:'var(--green)', fontWeight:800, fontSize:13, letterSpacing:1 }}>
            ¡PEDIDO LISTO! — Mesa{notifMesas.size>1?'s':''} {[...notifMesas].sort((a,b)=>a-b).join(', ')}
          </span>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}`}</style>
        </div>
      )}

      {/* Banner pedidos cliente */}
      {getPedidosEsperando().length > 0 && (
        <div style={{ background:'rgba(74,158,255,.12)', borderBottom:'2px solid var(--blue)',
          padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:20 }}>📱</span>
            <div>
              <div style={{ color:'var(--blue)', fontWeight:800, fontSize:13, letterSpacing:1 }}>
                {getPedidosEsperando().length} PEDIDO(S) DE CLIENTES
              </div>
              <div style={{ color:'var(--muted)', fontSize:11 }}>Esperando tu confirmación</div>
            </div>
          </div>
          <button onClick={() => setConfirmandoCliente(getPedidosEsperando()[0])}
            style={{ background:'var(--blue)', color:'white', border:'none',
              borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:800,
              cursor:'pointer', fontFamily:'var(--font)' }}>REVISAR</button>
        </div>
      )}

      {/* Leyenda */}
      <div style={{ display:'flex', gap:12, padding:'10px 16px 4px', flexWrap:'wrap' }}>
        {[['var(--border)','Libre'],['var(--accent2)','Con pedido'],['var(--green)','Listo — cobrar']].map(([color,label]) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--muted)' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />{label}
          </div>
        ))}
      </div>

      {/* Grid mesas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14, padding:'10px 16px 20px' }}>
        {mesasList.map(num => {
          const status = getMesaStatus(num)
          const c = statusColors[status]
          const pedidosCount = getOrdersForMesa(num).length
          const tieneListo = notifMesas.has(num)
          const qrActivo = mesasActivas.has(num)
          const tieneClienteEsperando = Object.values(activeOrders).some(o => o.status==='esperando_confirmacion' && o.mesa===num)
          return (
            <div key={num} style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <button onClick={() => handleMesaClick(num)}
                style={{ background:c.bg, border:`2px solid ${tieneListo?'var(--green)':c.border}`,
                  borderRadius:20, aspectRatio:'1', display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', cursor:'pointer',
                  position:'relative', transition:'all .2s', color:'var(--text)',
                  fontFamily:'var(--font)', width:'100%',
                  boxShadow:(status==='listo'||tieneListo)?'0 0 20px rgba(39,201,122,.3)':'none',
                  animation:(status==='listo'||tieneListo)?'pulse 2s infinite':'none' }}
                onTouchStart={e => e.currentTarget.style.transform='scale(0.94)'}
                onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}>
                {status!=='libre' && (
                  <div style={{ position:'absolute', top:10, right:10,
                    background:status==='listo'?'rgba(39,201,122,.2)':'var(--accent2)',
                    border:status==='listo'?'1px solid var(--green)':'none',
                    color:status==='listo'?'var(--green)':'white',
                    fontSize:9, fontWeight:800, padding:'3px 8px', borderRadius:20 }}>
                    {status==='listo'?'✅ LISTO':'PEDIDO'}
                  </div>
                )}
                {tieneClienteEsperando && (
                  <div style={{ position:'absolute', bottom:10, left:10,
                    background:'var(--blue)', color:'white',
                    fontSize:9, fontWeight:800, padding:'3px 8px', borderRadius:20,
                    animation:'pulse 1.5s infinite' }}>📱 CLIENTE</div>
                )}
                {pedidosCount > 1 && (
                  <div style={{ position:'absolute', top:10, left:10,
                    background:'var(--blue)', color:'white',
                    fontSize:9, fontWeight:800, padding:'3px 8px', borderRadius:20 }}>
                    {pedidosCount}x
                  </div>
                )}
                <div style={{ width:64, height:64, background:c.iconBg, borderRadius:16,
                  display:'flex', alignItems:'center', justifyContent:'center', marginBottom:10 }}>
                  <span style={{ fontSize:34, fontWeight:900, color:c.iconColor,
                    lineHeight:1, fontFamily:'var(--mono)' }}>{num}</span>
                </div>
                <span style={{ fontSize:12, fontWeight:700, letterSpacing:2 }}>MESA {num}</span>
                <span style={{ fontSize:10, marginTop:4,
                  fontWeight:status==='listo'?700:400,
                  color:(status==='listo'||tieneListo)?'var(--green)':'var(--muted)' }}>
                  {status==='libre'?'Toca para pedir':status==='listo'?'Toca para cobrar':tieneListo?'¡Pedido listo!':'Cobrar / Agregar pedido'}
                </span>
              </button>

            </div>
          )
        })}
      </div>

      {/* Modal editar mesas */}
      {editandoMesas && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--blue)',
            padding:26, width:'100%', maxWidth:320 }}>
            <div style={{ fontSize:28, textAlign:'center', marginBottom:8 }}>⚙</div>
            <div style={{ fontWeight:800, fontSize:18, textAlign:'center', marginBottom:6 }}>Número de Mesas</div>
            <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center', marginBottom:18 }}>
              Actualmente: <strong style={{ color:'var(--accent)' }}>{numMesas}</strong> mesas
            </div>
            <input className="input" type="number" min="1" max="50"
              placeholder="Nuevo número (1-50)" value={nuevoNum}
              onChange={e => setNuevoNum(e.target.value)} style={{ marginBottom:14 }} />
            <button className="btn btn-primary"
              style={{ width:'100%', padding:14, marginBottom:10, fontSize:14, letterSpacing:2 }}
              onClick={guardarMesas}>✅ GUARDAR</button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => { setEditandoMesas(false); setNuevoNum('') }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal confirmar pedido cliente */}
      {confirmandoCliente && (() => {
        const pedido = confirmandoCliente[1]
        const pedidoKey = confirmandoCliente[0]
        const pedidoItems = pedido?.items || []
        const pedidoTotal = pedidoItems.reduce((a,i) => a+i.price*i.qty, 0) + (pedido?.extrasPrice||0)
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
            <div style={{ background:'var(--card)', borderRadius:'20px 20px 0 0',
              border:'2px solid var(--blue)', borderBottom:'none', width:'100%', maxWidth:480,
              maxHeight:'90vh', display:'flex', flexDirection:'column' }}>

              {/* Header fijo */}
              <div style={{
                background: pedido?.soloBebidas ? 'linear-gradient(135deg,#0d2a1a,#0a1f12)' : 'linear-gradient(135deg,#1a2a4a,#0d1a35)',
                padding:'20px 22px 16px', textAlign:'center', flexShrink:0,
                borderRadius:'18px 18px 0 0',
                borderBottom:`2px solid ${pedido?.soloBebidas ? 'var(--green)' : 'var(--blue)'}` }}>
                <div style={{ fontSize:11, color: pedido?.soloBebidas ? 'var(--green)' : '#4a9eff',
                  letterSpacing:4, textTransform:'uppercase', marginBottom:4, fontWeight:800 }}>
                  📱 PEDIDO DEL CLIENTE
                </div>
                {pedido?.soloBebidas && (
                  <div style={{ display:'inline-block', background:'rgba(39,201,122,.2)',
                    border:'1.5px solid var(--green)', borderRadius:20,
                    padding:'3px 14px', fontSize:11, fontWeight:800,
                    color:'var(--green)', letterSpacing:2, marginBottom:8 }}>
                    🥤 SOLO BEBIDAS — NO VA A COCINA
                  </div>
                )}
                <div style={{ fontSize:80, fontWeight:900, lineHeight:1, color:'white',
                  fontFamily:'var(--mono)',
                  textShadow: pedido?.soloBebidas ? '0 0 40px rgba(39,201,122,.6)' : '0 0 40px rgba(74,158,255,.6)' }}>
                  {pedido?.mesa}
                </div>
                <div style={{ fontSize:13, color: pedido?.soloBebidas ? 'var(--green)' : '#4a9eff',
                  fontWeight:700, letterSpacing:3, marginTop:2 }}>MESA</div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>
                  {pedido?.timeISO ? new Date(pedido.timeISO).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : ''}
                </div>
              </div>

              {/* Items — scrolleable */}
              <div style={{ overflowY:'auto', flex:1, padding:'16px 22px 8px' }}>
                <div style={{ background:'var(--surface)', borderRadius:12, padding:12 }}>
                  {pedidoItems.map((item,i) => (
                    <div key={i} style={{ padding:'8px 0',
                      borderBottom:i<pedidoItems.length-1?'1px solid var(--border)':'none' }}>
                      <div style={{ display:'flex', justifyContent:'space-between',
                        fontSize:14, color:'var(--muted2)' }}>
                        <span style={{ fontWeight:700 }}>×{item.qty} {item.name}</span>
                        <span style={{ fontFamily:'var(--mono)', fontWeight:700 }}>
                          S/{(item.price*item.qty).toFixed(2)}
                        </span>
                      </div>
                      {item.nota && (
                        <div style={{ fontSize:11, color:'var(--yellow)', marginTop:3,
                          background:'rgba(245,200,66,.08)', borderRadius:6,
                          padding:'2px 8px', display:'inline-block' }}>
                          ✏️ {item.nota}
                        </div>
                      )}
                    </div>
                  ))}
                  {pedido?.extras && (
                    <div style={{ marginTop:8, fontSize:12, color:'var(--yellow)',
                      paddingTop:8, borderTop:'1px solid var(--border)' }}>
                      📝 {pedido.extras}
                      {pedido.extrasPrice > 0 && (
                        <span style={{ float:'right', fontFamily:'var(--mono)', fontWeight:700 }}>
                          S/{Number(pedido.extrasPrice).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ display:'flex', justifyContent:'space-between',
                    fontWeight:800, fontSize:17, marginTop:10,
                    paddingTop:8, borderTop:'2px solid var(--border)' }}>
                    <span>Total</span>
                    <span style={{ color:'var(--green)', fontFamily:'var(--mono)' }}>
                      S/{pedidoTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
                {getPedidosEsperando().length > 1 && (
                  <div style={{ fontSize:12, color:'var(--blue)', textAlign:'center', marginTop:10 }}>
                    +{getPedidosEsperando().length-1} pedido(s) más esperando
                  </div>
                )}
              </div>

              {/* Botones — fijos abajo */}
              <div style={{ padding:'12px 22px 28px', flexShrink:0,
                borderTop:'1px solid var(--border)', background:'var(--card)' }}>
                <button className="btn btn-success"
                  style={{ width:'100%', fontSize:15, letterSpacing:2, padding:15, marginBottom:10,
                    background: pedido?.soloBebidas ? 'linear-gradient(135deg,var(--green),#1aad63)' : undefined }}
                  onClick={() => confirmarPedidoCliente(pedidoKey, pedido?.mesa)}>
                  {pedido?.soloBebidas ? '🥤 CONFIRMAR — BEBIDAS LISTAS' : '✅ CONFIRMAR — ENVIAR A COCINA'}
                </button>
                <button onClick={() => rechazarPedidoCliente(pedidoKey)}
                  style={{ width:'100%', background:'rgba(255,77,77,.12)',
                    border:'1.5px solid var(--red)', color:'var(--red)',
                    borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                    cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:8 }}>
                  ❌ RECHAZAR PEDIDO
                </button>
                <button className="btn btn-ghost" style={{ width:'100%', padding:11 }}
                  onClick={() => setConfirmandoCliente(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal cobrar */}
      {confirming && (() => {
        const { bruto, descuentoAmt, total } = calcTotal(confirming.orders, descuento)
        const merged = mergeItems(confirming.orders)
        // Solo bloquear si hay pedidos en cocina (pending, no bebidas) o esperando confirmación (no bebidas)
        const liveOrders = Object.entries(activeOrders).filter(([,o]) => o.mesa === confirming.num)
        const hayPendientes = liveOrders.some(([,o]) => o.status === 'pending'                  && o.soloBebidas !== true)
        const hayEsperando  = liveOrders.some(([,o]) => o.status === 'esperando_confirmacion'   && o.soloBebidas !== true)
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--green)',
              padding:22, width:'100%', maxWidth:380, maxHeight:'92vh', overflowY:'auto' }}>
              <div style={{ fontSize:32, textAlign:'center', marginBottom:6 }}>💰</div>
              <div style={{ fontWeight:800, fontSize:20, textAlign:'center', marginBottom:16 }}>
                Cobrar Mesa {confirming.num}
              </div>
              <div style={{ background:'var(--surface)', borderRadius:12, padding:12, marginBottom:10 }}>
                <div style={{ fontSize:11, color:'var(--blue)', fontWeight:800, letterSpacing:1, marginBottom:8 }}>RESUMEN</div>
                {merged.map((item,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between',
                    fontSize:13, padding:'4px 0',
                    borderBottom:i<merged.length-1?'1px solid var(--border)':'none',
                    color:'var(--muted2)' }}>
                    <span>×{item.qty} {item.name}</span>
                    <span style={{ fontFamily:'var(--mono)' }}>S/{(item.price*item.qty).toFixed(2)}</span>
                  </div>
                ))}
                {confirming.orders.filter(([,o])=>o.extras).map(([k,o]) => (
                  <div key={k} style={{ fontSize:12, color:'var(--yellow)', marginTop:6 }}>
                    ⭐ {o.extras}{o.extrasPrice>0?` S/${Number(o.extrasPrice).toFixed(2)}`:''}
                  </div>
                ))}
              </div>
              {confirming.orders.length > 1 && (
                <div style={{ background:'var(--surface)', borderRadius:12, padding:10, marginBottom:10 }}>
                  {confirming.orders.map(([key,order],oi) => (
                    <div key={key} style={{ display:'flex', justifyContent:'space-between',
                      alignItems:'center', padding:'4px 0' }}>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>
                        {oi===0?'1er':`${oi+1}°`} pedido · {fmt12(order.timeISO)}
                      </span>
                      <button onClick={() => eliminarPedido(key)} disabled={deletingKey===key}
                        style={{ background:'none', border:'none', color:'var(--red)',
                          fontSize:16, cursor:'pointer', padding:'0 4px' }}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background:'var(--surface)', borderRadius:12, padding:12, marginBottom:12 }}>
                <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>🏷 Descuento</div>
                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  {[['pct','%'],['monto','S/']].map(([t,l]) => (
                    <button key={t} onClick={() => setDescuento(d => ({ ...d, tipo:t, valor:'' }))}
                      style={{ flex:1, background:descuento.tipo===t?'var(--accent)':'var(--card)',
                        border:`1.5px solid ${descuento.tipo===t?'var(--accent)':'var(--border)'}`,
                        color:descuento.tipo===t?'#111':'var(--muted)',
                        borderRadius:10, padding:'8px 0', fontWeight:700,
                        cursor:'pointer', fontFamily:'var(--font)', fontSize:14 }}>{l}</button>
                  ))}
                </div>
                <input className="input" type="number" min="0"
                  placeholder={descuento.tipo==='pct'?'Ej: 10 (10%)':'Ej: 5 (S/5)'}
                  value={descuento.valor} onChange={e => setDescuento(d => ({ ...d, valor:e.target.value }))} />
              </div>
              <div style={{ background:'var(--surface)', borderRadius:12, padding:14, marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--muted)', marginBottom:6 }}>
                  <span>Subtotal</span><span style={{ fontFamily:'var(--mono)' }}>S/{bruto.toFixed(2)}</span>
                </div>
                {descuentoAmt>0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--red)', marginBottom:6 }}>
                    <span>Descuento</span><span style={{ fontFamily:'var(--mono)' }}>-S/{descuentoAmt.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'space-between',
                  fontWeight:800, fontSize:20, borderTop:'1px solid var(--border)', paddingTop:10 }}>
                  <span>TOTAL</span>
                  <span style={{ color:'var(--green)', fontFamily:'var(--mono)' }}>S/{total.toFixed(2)}</span>
                </div>
              </div>
              {/* Método de pago */}
              <div style={{ background:'var(--surface)', borderRadius:12, padding:12, marginBottom:12 }}>
                <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>💳 Forma de pago</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {/* Yape */}
                  <div style={{ background:'var(--card)', border:`1.5px solid ${pago.yape ? '#6c47ff' : 'var(--border)'}`,
                    borderRadius:12, padding:'10px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                      <span style={{ fontSize:18 }}>📲</span>
                      <span style={{ fontWeight:800, fontSize:13, color: pago.yape ? '#a78bfa' : 'var(--muted)' }}>Yape</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ fontSize:12, color:'var(--muted)', fontFamily:'var(--mono)' }}>S/</span>
                      <input type="number" min="0" step="0.10"
                        placeholder="0.00"
                        value={pago.yape}
                        onChange={e => {
                          const yapeVal = parseFloat(e.target.value) || 0
                          const resto   = Math.max(0, total - yapeVal)
                          setPago({ yape: e.target.value, efectivo: resto > 0 ? resto.toFixed(2) : '' })
                        }}
                        style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)',
                          borderRadius:8, padding:'6px 8px', color:'white',
                          fontFamily:'var(--mono)', fontSize:15, fontWeight:700,
                          outline:'none' }} />
                    </div>
                  </div>
                  {/* Efectivo */}
                  <div style={{ background:'var(--card)', border:`1.5px solid ${pago.efectivo ? 'var(--green)' : 'var(--border)'}`,
                    borderRadius:12, padding:'10px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                      <span style={{ fontSize:18 }}>💵</span>
                      <span style={{ fontWeight:800, fontSize:13, color: pago.efectivo ? 'var(--green)' : 'var(--muted)' }}>Efectivo</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ fontSize:12, color:'var(--muted)', fontFamily:'var(--mono)' }}>S/</span>
                      <input type="number" min="0" step="0.10"
                        placeholder={total.toFixed(2)}
                        value={pago.efectivo}
                        onChange={e => setPago(p => ({ ...p, efectivo: e.target.value }))}
                        style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)',
                          borderRadius:8, padding:'6px 8px', color:'white',
                          fontFamily:'var(--mono)', fontSize:15, fontWeight:700,
                          outline:'none' }} />
                    </div>
                  </div>
                </div>
                {/* Resumen de lo ingresado */}
                {(parseFloat(pago.yape)||0) + (parseFloat(pago.efectivo)||0) > 0 && (() => {
                  const ingresado = (parseFloat(pago.yape)||0) + (parseFloat(pago.efectivo)||0)
                  const diferencia = ingresado - total
                  return (
                    <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8,
                      background: Math.abs(diferencia) < 0.01 ? 'rgba(39,201,122,.1)' : diferencia > 0 ? 'rgba(74,158,255,.1)' : 'rgba(255,77,77,.1)',
                      border: `1px solid ${Math.abs(diferencia) < 0.01 ? 'var(--green)' : diferencia > 0 ? 'var(--blue)' : 'var(--red)'}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                        <span style={{ color:'var(--muted)' }}>Ingresado</span>
                        <span style={{ fontFamily:'var(--mono)', fontWeight:700 }}>S/{ingresado.toFixed(2)}</span>
                      </div>
                      {Math.abs(diferencia) >= 0.01 && (
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginTop:4 }}>
                          <span style={{ color: diferencia > 0 ? 'var(--blue)' : 'var(--red)' }}>
                            {diferencia > 0 ? 'Vuelto' : 'Falta'}
                          </span>
                          <span style={{ fontFamily:'var(--mono)', fontWeight:700,
                            color: diferencia > 0 ? 'var(--blue)' : 'var(--red)' }}>
                            S/{Math.abs(diferencia).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {(() => {
                return (
                  <button className="btn btn-success"
                    style={{ width:'100%', fontSize:15, letterSpacing:2, padding:16, marginBottom:10,
                      opacity:hayPendientes?0.4:1, cursor:hayPendientes?'not-allowed':'pointer' }}
                    disabled={processing||hayPendientes||hayEsperando} onClick={cobrar}>
                    {processing?'PROCESANDO...':hayEsperando?'⏳ ESPERANDO CONFIRMACIÓN...':(hayPendientes?'⏳ ESPERANDO COCINA...':'💰 CONFIRMAR COBRO')}
                  </button>
                )
              })()}
              <button onClick={() => limpiarPedidosAtascados(confirming.num)}
                style={{ width:'100%', fontSize:12, padding:10, marginBottom:8,
                  background:'none', border:'1px solid var(--border)', color:'var(--muted)',
                  borderRadius:10, cursor:'pointer', fontFamily:'var(--font)' }}>
                🧹 Limpiar pedidos atascados
              </button>
              <button className="btn btn-primary"
                style={{ width:'100%', fontSize:14, letterSpacing:2, padding:14, marginBottom:10,
                  background:'var(--blue)', borderColor:'var(--blue)' }}
                onClick={() => { setConfirming(null); navigate(`/pedido/${confirming.num}`) }}>
                ➕ AGREGAR MÁS PEDIDO
              </button>
              <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
                onClick={() => { setConfirming(null); setPago({ yape:'', efectivo:'' }) }}>Cancelar</button>
            </div>
          </div>
        )
      })()}

      {/* Comprobante */}
      {comprobante && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.9)',
          zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'white', borderRadius:16, padding:24,
            width:'100%', maxWidth:320, color:'#111', fontFamily:'var(--mono)' }}>
            <div style={{ textAlign:'center', marginBottom:16 }}>
              <div style={{ fontSize:28, marginBottom:4 }}>🧾</div>
              <div style={{ fontSize:20, fontWeight:900, letterSpacing:2 }}>{(session?.restoNombre || restoId || 'RESTO POS').toUpperCase()}</div>
              <div style={{ fontSize:12, color:'#666', marginTop:2 }}>
                Mesa {comprobante.num} · {comprobante.hora}
              </div>
            </div>
            <div style={{ borderTop:'2px dashed #ccc', borderBottom:'2px dashed #ccc',
              padding:'12px 0', marginBottom:12 }}>
              {comprobante.mergedItems.map((item,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between',
                  fontSize:13, padding:'3px 0' }}>
                  <span>×{item.qty} {item.name}</span>
                  <span>S/{(item.price*item.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
            {comprobante.descuentoAmt>0 && (
              <div style={{ display:'flex', justifyContent:'space-between',
                fontSize:13, color:'#e74c3c', marginBottom:4 }}>
                <span>Descuento</span><span>-S/{comprobante.descuentoAmt.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between',
              fontWeight:900, fontSize:20, marginBottom:16 }}>
              <span>TOTAL</span><span>S/{comprobante.total.toFixed(2)}</span>
            </div>
            <div style={{ textAlign:'center', fontSize:11, color:'#999', marginBottom:16 }}>¡Gracias por su visita!</div>
            <button onClick={() => setComprobante(null)}
              style={{ width:'100%', background:'#111', color:'white', border:'none',
                borderRadius:10, padding:'14px 0', fontSize:15, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2 }}>✓ CERRAR</button>
          </div>
        </div>
      )}

      {/* Modal confirmar eliminación de pedido */}
      {confirmDeleteKey && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
          zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'var(--card)', borderRadius:20, border:'2px solid var(--red)',
            padding:26, width:'100%', maxWidth:320, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🗑</div>
            <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>¿Eliminar pedido?</div>
            <div style={{ fontSize:13, color:'var(--muted)', marginBottom:22 }}>
              Esta acción no se puede deshacer.
            </div>
            <button onClick={eliminarPedidoConfirmado}
              style={{ width:'100%', background:'var(--red)', color:'white', border:'none',
                borderRadius:12, padding:'13px 0', fontSize:14, fontWeight:800,
                cursor:'pointer', fontFamily:'var(--font)', letterSpacing:2, marginBottom:10 }}>
              ❌ SÍ, ELIMINAR
            </button>
            <button className="btn btn-ghost" style={{ width:'100%', padding:12 }}
              onClick={() => setConfirmDeleteKey(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
