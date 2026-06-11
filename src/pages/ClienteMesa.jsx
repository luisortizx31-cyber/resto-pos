import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { db, rtdb } from '../lib/firebase'
import {
  doc, getDoc, setDoc, onSnapshot, collection, getDocs, runTransaction
} from 'firebase/firestore'
import { ref as rtRef, onValue, push, set } from 'firebase/database'

const BEBIDAS_CAT = ['bebidas', 'bebida', 'drinks', 'drink']

function genPedidoId() {
  return 'pedido_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// sessionStorage: datos de la sesión activa del cliente en esta pestaña
function getClienteSession(mesaKey) {
  try {
    const s = sessionStorage.getItem('gastro_mesa_' + mesaKey)
    return s ? JSON.parse(s) : null
  } catch { return null }
}
function saveClienteSession(mesaKey, data) {
  sessionStorage.setItem('gastro_mesa_' + mesaKey, JSON.stringify(data))
}
function clearClienteSession(mesaKey) {
  sessionStorage.removeItem('gastro_mesa_' + mesaKey)
}
// Marca en sessionStorage que esta mesa fue cobrada en esta pestaña
// sessionStorage NO persiste entre pestañas nuevas (escaneos de QR), solo en refresco
function marcarCobradoEnSession(mesaKey) {
  sessionStorage.setItem('gastro_cobrado_' + mesaKey, '1')
}
function sesionFueCobrada(mesaKey) {
  return sessionStorage.getItem('gastro_cobrado_' + mesaKey) === '1'
}
function limpiarCobradoEnSession(mesaKey) {
  sessionStorage.removeItem('gastro_cobrado_' + mesaKey)
}

const DEFAULT_MENU = {}

// Componente interno para enviar boleta por WhatsApp
function BoletaWsp({ totalBoleta, generarMensajeWsp }) {
  const [tel, setTel]       = useState('')
  const [enviado, setEnviado] = useState(false)

  const handleEnviar = () => {
    const num = tel.replace(/\D/g, '')
    if (num.length < 9) return
    window.open(generarMensajeWsp(tel), '_blank')
    setEnviado(true)
  }

  return (
    <div style={{ background:'rgba(39,201,122,.08)', border:'2px solid rgba(39,201,122,.3)',
      borderRadius:20, padding:'20px 24px', maxWidth:300, width:'100%',
      marginBottom:20, textAlign:'left' }}>
      <div style={{ fontSize:22, marginBottom:8, textAlign:'center' }}>📲</div>
      <div style={{ fontWeight:800, fontSize:14, color:'#27c97a', letterSpacing:1,
        marginBottom:4, textAlign:'center' }}>
        Recibir boleta por WhatsApp
      </div>
      <div style={{ fontSize:12, color:'#8b949e', marginBottom:14, textAlign:'center' }}>
        Total: <strong style={{ color:'#27c97a' }}>S/{totalBoleta.toFixed(2)}</strong>
      </div>
      {!enviado ? (
        <>
          <div style={{ display:'flex', alignItems:'center', background:'#161b22',
            border:'1.5px solid #30363d', borderRadius:12, overflow:'hidden', marginBottom:10 }}>
            <span style={{ padding:'0 12px', fontSize:16, color:'#8b949e' }}>🇵🇪</span>
            <input
              type="tel" placeholder="Ej: 987654321"
              value={tel} onChange={e => setTel(e.target.value)}
              style={{ flex:1, background:'none', border:'none', color:'white',
                fontSize:15, padding:'12px 8px', outline:'none',
                fontFamily:'system-ui,sans-serif' }}
            />
          </div>
          <button onClick={handleEnviar}
            disabled={tel.replace(/\D/g,'').length < 9}
            style={{ width:'100%', background: tel.replace(/\D/g,'').length < 9 ? '#21262d' : '#25d366',
              color: tel.replace(/\D/g,'').length < 9 ? '#8b949e' : 'white',
              border:'none', borderRadius:12, padding:'13px 0',
              fontSize:14, fontWeight:800, cursor: tel.replace(/\D/g,'').length < 9 ? 'not-allowed' : 'pointer',
              letterSpacing:1 }}>
            📨 ENVIAR POR WHATSAPP
          </button>
        </>
      ) : (
        <div style={{ textAlign:'center', color:'#27c97a', fontWeight:800, fontSize:14, padding:'8px 0' }}>
          ✅ ¡Boleta enviada! Revisa tu WhatsApp
        </div>
      )}
    </div>
  )
}

export default function ClienteMesa() {
  const { restoId, num } = useParams()
  const mesaNum  = parseInt(num)
  const mesaKey  = `${restoId}_mesa_${mesaNum}`
  const mesaDocRef = doc(db, 'restaurantes', restoId, 'mesas', String(mesaNum))

  // screen: 'loading' | 'carta' | 'seguimiento' | 'gracias'
  const [screen, setScreen]   = useState('loading')
  const [pedidoId, setPedidoId] = useState(null)
  const [pedidoData, setPedidoData] = useState(null)
  const [menu, setMenu]       = useState(null)
  const [carrito, setCarrito] = useState({})
  const [notas, setNotas]     = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab]         = useState('estado')
  const [activeOrders, setActiveOrders] = useState({})
  const [buscar, setBuscar]   = useState('')
  const [deshabilitados, setDeshabilitados] = useState(new Set())
  const [notasPlato, setNotasPlato] = useState({}) // { itemId: 'sin cebolla' }
  const unsubPedidoRef = useRef(null)

  // Persistir screen en sesión para restaurar al refrescar
  useEffect(() => {
    if (screen === 'loading' || screen === 'gracias' || screen === 'qr_bloqueado') return
    const session = getClienteSession(mesaKey)
    if (session?.pedidoId) {
      saveClienteSession(mesaKey, { ...session, screen })
    }
  }, [screen])

  // ── 1. Cargar menú ──────────────────────────────────────────────
  useEffect(() => {
    async function loadMenu() {
      try {
        const snap = await getDocs(collection(db, 'restaurantes', restoId, 'menu'))
        if (snap.empty) { setMenu(DEFAULT_MENU); return }
        const bycat = {}
        snap.forEach(d => {
          const data = d.data()
          if (!bycat[data.category]) bycat[data.category] = []
          bycat[data.category].push({ id: d.id, ...data })
        })
        setMenu(Object.keys(bycat).length ? bycat : {})
      } catch { setMenu({}) }
    }
    loadMenu()
  }, [restoId])

  const unsubRestoRef = useRef(null)

  // ── 1b. Escuchar platos deshabilitados en tiempo real ───────────
  useEffect(() => {
    if (!restoId) return
    const unsub = onSnapshot(doc(db, 'restaurantes', restoId, 'config', 'menu'), snap => {
      if (snap.exists()) setDeshabilitados(new Set(snap.data().deshabilitados || []))
    })
    return () => unsub()
  }, [restoId])
  useEffect(() => {
    async function init() {
      try {
        // Si esta pestaña fue cobrada, mostrar gracias sin ir a Firebase
        if (sesionFueCobrada(mesaKey)) {
          setScreen('gracias')
          return
        }

        // Leer en paralelo: estado QR del resto + estado de la mesa
        const [restoSnap, mesaSnap] = await Promise.all([
          getDoc(doc(db, 'restaurantes', restoId)),
          getDoc(mesaDocRef),
        ])

        // Verificar QR activo
        if (restoSnap.exists()) {
          const rd = restoSnap.data()
          if (rd.qrActivo === false || (Array.isArray(rd.qrMesasOff) && rd.qrMesasOff.includes(mesaNum))) {
            setScreen('qr_bloqueado')
            return
          }
        }

        const mesaData  = mesaSnap.exists() ? mesaSnap.data() : {}
        const cobradoEn = mesaData.cobradoEn || null
        const session   = getClienteSession(mesaKey)

        if (session?.pedidoId) {
          // Si la mesa fue cobrada DESPUÉS de que el cliente inició sesión → bloqueado
          if (cobradoEn && session.iniciadoEn && cobradoEn > session.iniciadoEn) {
            clearClienteSession(mesaKey)
            marcarCobradoEnSession(mesaKey)
            setScreen('gracias')
            return
          }
          // Verificar que el pedido exista y esté activo
          const pedSnap = await getDoc(doc(db, 'restaurantes', restoId, 'pedidos', session.pedidoId))
          if (pedSnap.exists() && pedSnap.data().estado === 'finalizado') {
            clearClienteSession(mesaKey)
            marcarCobradoEnSession(mesaKey)
            setScreen('gracias')
            return
          }
          if (pedSnap.exists() && pedSnap.data().estado === 'activo') {
            setPedidoId(session.pedidoId)
            suscribirPedido(session.pedidoId)
            setScreen(session.screen || 'seguimiento')
            // Activar escucha en tiempo real del QR
            suscribirEstadoQR()
            return
          }
          clearClienteSession(mesaKey)
        }

        // Sin sesión válida — si la mesa fue cobrada y el QR sigue cerrado, bloquear
        // El mesero abre el QR antes de que llegue el siguiente cliente
        // qrMesasOff ya controla esto — si está en la lista, ya se bloqueó arriba
        // Si no está bloqueado el QR, dejar entrar (cliente nuevo con QR abierto)

        // Crear o unirse al pedido de la mesa (atómico)
        let resolvedPedidoId = null

        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(mesaDocRef)
          const data = snap.exists() ? snap.data() : {}

          if (data.pedidoActivoId && data.estado === 'ocupada') {
            const pedidoRef  = doc(db, 'restaurantes', restoId, 'pedidos', data.pedidoActivoId)
            const pedidoSnap = await transaction.get(pedidoRef)
            if (pedidoSnap.exists() && pedidoSnap.data().estado === 'activo') {
              resolvedPedidoId = data.pedidoActivoId
            } else {
              const newId = genPedidoId()
              transaction.set(doc(db, 'restaurantes', restoId, 'pedidos', newId), {
                restoId, mesa: mesaNum, estado: 'activo',
                items: [], creadoEn: new Date().toISOString(),
              })
              transaction.set(mesaDocRef, {
                estado: 'ocupada', pedidoActivoId: newId,
                desde: new Date().toISOString(),
              }, { merge: true })
              resolvedPedidoId = newId
            }
          } else {
            const newId = genPedidoId()
            transaction.set(doc(db, 'restaurantes', restoId, 'pedidos', newId), {
              restoId, mesa: mesaNum, estado: 'activo',
              items: [], creadoEn: new Date().toISOString(),
            })
            transaction.set(mesaDocRef, {
              estado: 'ocupada', pedidoActivoId: newId,
              desde: new Date().toISOString(),
            }, { merge: true })
            resolvedPedidoId = newId
          }
        })

        limpiarCobradoEnSession(mesaKey)
        saveClienteSession(mesaKey, {
          pedidoId: resolvedPedidoId,
          iniciadoEn: new Date().toISOString(),
          screen: 'carta',
        })
        setPedidoId(resolvedPedidoId)
        suscribirPedido(resolvedPedidoId)
        setScreen('carta')
        // Activar escucha en tiempo real del QR
        suscribirEstadoQR()

      } catch (e) {
        console.error('init error', e)
        setScreen('carta')
      }
    }

    // Escucha en tiempo real del estado QR del restaurante
    // Si el mesero cierra el QR mientras el cliente está en la mesa → bloqueado al instante
    function suscribirEstadoQR() {
      if (unsubRestoRef.current) unsubRestoRef.current()
      unsubRestoRef.current = onSnapshot(doc(db, 'restaurantes', restoId), snap => {
        if (!snap.exists()) return
        const rd = snap.data()
        const qrCerrado = rd.qrActivo === false || (Array.isArray(rd.qrMesasOff) && rd.qrMesasOff.includes(mesaNum))
        if (qrCerrado) {
          clearClienteSession(mesaKey)
          marcarCobradoEnSession(mesaKey)
          setScreen('qr_bloqueado')
        }
      })
    }

    init()
    return () => {
      if (unsubPedidoRef.current) unsubPedidoRef.current()
      if (unsubRestoRef.current) unsubRestoRef.current()
    }
  }, [restoId, mesaNum])

  // ── 3. Escuchar pedido en Firestore ─────────────────────────────
  function suscribirPedido(pid) {
    if (unsubPedidoRef.current) unsubPedidoRef.current()
    const unsub = onSnapshot(doc(db, 'restaurantes', restoId, 'pedidos', pid), snap => {
      if (!snap.exists()) return
      const data = snap.data()
      setPedidoData(data)
      if (data.estado === 'finalizado') {
        clearClienteSession(mesaKey)
        marcarCobradoEnSession(mesaKey)
        // Guardar items y pago en sessionStorage para mostrar boleta en pantalla gracias
        sessionStorage.setItem('gastro_boleta_' + mesaKey, JSON.stringify({
          items:          data.items          || [],
          pagoYape:       data.pagoYape        || 0,
          pagoEfectivo:   data.pagoEfectivo    || 0,
        }))
        setScreen('gracias')
      }
    })
    unsubPedidoRef.current = unsub
  }

  // ── 4. Escuchar pedidos activos RTDB (para estado en cocina) ────
  useEffect(() => {
    const unsub = onValue(rtRef(rtdb, `${restoId}/pedidos_activos`), snap => {
      setActiveOrders(snap.val() || {})
    })
    return () => unsub()
  }, [restoId])

  // ── Carrito helpers ─────────────────────────────────────────────
  // carrito: { 'itemId__varIdx': { qty, price, name, variantName, category } }
  const setQty = (itemId, varIdx, price, name, variantName, category, delta) => {
    const key = `${itemId}__${varIdx}`
    setCarrito(prev => {
      const cur  = prev[key]?.qty || 0
      const next = Math.max(0, cur + delta)
      const updated = { ...prev }
      if (next === 0) delete updated[key]
      else updated[key] = { qty:next, price, name, variantName, category, id:itemId }
      return updated
    })
  }
  const getQty = (itemId, varIdx) => carrito[`${itemId}__${varIdx}`]?.qty || 0

  const totalItems = Object.values(carrito).reduce((a, v) => a + v.qty, 0)
  const totalPrice = Object.values(carrito).reduce((a, v) => a + v.price * v.qty, 0)

  const esSoloBebidas = () => {
    if (!menu || totalItems === 0) return false
    return Object.values(carrito).every(v =>
      BEBIDAS_CAT.includes((v.category || '').toLowerCase().trim())
    )
  }

  // ── 5. Enviar pedido ─────────────────────────────────────────────
  const enviar = async () => {
    if (totalItems === 0 || sending) return
    setSending(true)
    try {
      const itemsArr = Object.entries(carrito).map(([, v]) => ({
        id:       v.id,
        name:     v.variantName ? `${v.name} (${v.variantName})` : v.name,
        price:    v.price,
        qty:      v.qty,
        category: v.category || '',
        nota:     v.nota?.trim() || '',
      }))
      const soloBebidas = esSoloBebidas()

      // Agregar sub-pedido al RTDB (flujo existente de cocina/mesero)
      await push(rtRef(rtdb, `${restoId}/pedidos_activos`), {
        mesa: mesaNum,
        pedidoFirestoreId: pedidoId,
        items: itemsArr,
        extras: notas.trim(),
        extrasPrice: 0,
        status: 'esperando_confirmacion',
        soloBebidas,
        timeISO: new Date().toISOString(),
      })

      // Actualizar items en Firestore
      const pedSnap = await getDoc(doc(db, 'restaurantes', restoId, 'pedidos', pedidoId))
      const prevItems = pedSnap.exists() ? (pedSnap.data().items || []) : []
      const mergedItems = [...prevItems]
      itemsArr.forEach(newItem => {
        // Usar name+price como key para no fusionar variantes con mismo id pero diferente precio
        const idx = mergedItems.findIndex(i =>
          i.name === newItem.name && Number(i.price) === Number(newItem.price)
        )
        if (idx >= 0) mergedItems[idx] = { ...mergedItems[idx], qty: mergedItems[idx].qty + newItem.qty }
        else mergedItems.push(newItem)
      })
      await setDoc(doc(db, 'restaurantes', restoId, 'pedidos', pedidoId),
        { items: mergedItems }, { merge: true })

      setCarrito({})
      setNotas('')
      // Persistir pantalla seguimiento en sesión
      const sesActual = getClienteSession(mesaKey)
      if (sesActual) saveClienteSession(mesaKey, { ...sesActual, screen: 'seguimiento' })
      setScreen('seguimiento')
      setTab('estado')
    } catch { alert('Error al enviar. Intenta de nuevo.') }
    setSending(false)
  }

  const getPosicionCocina = (key) => {
    const enCocina = Object.entries(activeOrders)
      .filter(([, o]) => o.status === 'pending')
      .sort((a, b) => new Date(a[1].timeISO) - new Date(b[1].timeISO))
    const idx = enCocina.findIndex(([k]) => k === key)
    return idx >= 0 ? idx + 1 : null
  }

  const misPedidosRTDB = Object.entries(activeOrders)
    .filter(([, o]) => o.mesa === mesaNum &&
      ['esperando_confirmacion','pending','listo'].includes(o.status))
    .map(([key, o]) => ({ key, ...o }))
    .sort((a, b) => new Date(a.timeISO) - new Date(b.timeISO))

  const totalGeneral = (pedidoData?.items || []).reduce((a, i) => a + i.price * i.qty, 0)

  // ── PANTALLA MESA LIBRE ───────────────────────────────────────────
  if (screen === 'mesa_libre') {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:'system-ui,sans-serif',
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', padding:30, textAlign:'center' }}>
        <div style={{ fontSize:80, marginBottom:20 }}>🪑</div>
        <div style={{ fontSize:22, fontWeight:900, marginBottom:12, color:'#f5a623' }}>
          Mesa no disponible
        </div>
        <div style={{ fontSize:14, color:'#8b949e', lineHeight:1.8, maxWidth:300 }}>
          Esta mesa no tiene una sesión activa en este momento.<br/>
          Por favor llama a tu mesero para que la abra.
        </div>
        <div style={{ marginTop:28, background:'#161b22', border:'1px solid #30363d',
          borderRadius:12, padding:'10px 20px', fontSize:12, color:'#8b949e' }}>
          Mesa <strong style={{ color:'#f5a623', fontSize:16 }}>{mesaNum}</strong>
        </div>
      </div>
    )
  }

  // ── PANTALLA QR BLOQUEADO ─────────────────────────────────────────
  if (screen === 'qr_bloqueado') {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:'system-ui,sans-serif',
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', padding:30, textAlign:'center' }}>
        <div style={{ fontSize:80, marginBottom:20 }}>🚫</div>
        <div style={{ fontSize:22, fontWeight:900, marginBottom:12, color:'#ff4d4d' }}>
          Pedidos por QR desactivados
        </div>
        <div style={{ fontSize:14, color:'#8b949e', lineHeight:1.8, maxWidth:300 }}>
          En este momento no se aceptan pedidos por código QR.<br/>
          Por favor llama a tu mesero.
        </div>
      </div>
    )
  }

  // ── PANTALLA LOADING ─────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', display:'flex',
        alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
        <div style={{ fontSize:40 }}>🍽</div>
        <div style={{ color:'#8b949e', fontSize:14, fontFamily:'system-ui' }}>Preparando tu mesa...</div>
      </div>
    )
  }

  // ── PANTALLA GRACIAS ──────────────────────────────────────────────
  if (screen === 'gracias') {
    // Leer datos de boleta desde sessionStorage (persiste aunque pedidoData sea null)
    let boletaData = null
    try {
      const raw = sessionStorage.getItem('gastro_boleta_' + mesaKey)
      if (raw) boletaData = JSON.parse(raw)
    } catch {}

    const itemsParaBoleta = boletaData?.items || pedidoData?.items || []
    const totalBoleta     = itemsParaBoleta.reduce((a, i) => a + i.price * i.qty, 0)
    const pagoYape        = boletaData?.pagoYape       ?? pedidoData?.pagoYape       ?? 0
    const pagoEfectivo    = boletaData?.pagoEfectivo   ?? pedidoData?.pagoEfectivo   ?? 0
    const pagoBoleta      = [
      pagoYape     > 0 ? `Yape S/${Number(pagoYape).toFixed(2)}`         : null,
      pagoEfectivo > 0 ? `Efectivo S/${Number(pagoEfectivo).toFixed(2)}` : null,
    ].filter(Boolean).join(' + ')

    const generarMensajeWsp = (tel) => {
      const lineas = itemsParaBoleta.map(i =>
        `• ${i.qty}x ${i.name.padEnd(18)} S/${(i.price * i.qty).toFixed(2)}`
      ).join('\n')
      const fecha = new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' })
      const msg = [
        `🧾 *Boleta de consumo*`,
        `Mesa ${mesaNum} — ${fecha}`,
        ``,
        lineas,
        ``,
        `─────────────────────`,
        `*TOTAL: S/${totalBoleta.toFixed(2)}*`,
        pagoBoleta ? `Pago: ${pagoBoleta}` : '',
        ``,
        `¡Gracias por su visita! 🙌`,
      ].filter(l => l !== undefined).join('\n')
      const num = tel.replace(/\D/g, '')
      return `https://wa.me/${num.startsWith('51') ? num : '51' + num}?text=${encodeURIComponent(msg)}`
    }

    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:'system-ui,sans-serif',
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', padding:30, textAlign:'center' }}>
        <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}`}</style>
        <div style={{ fontSize:90, marginBottom:24, animation:'bounce 1.5s ease-in-out infinite' }}>🧾</div>
        <div style={{ fontSize:26, fontWeight:900, marginBottom:12,
          background:'linear-gradient(135deg,#f5a623,#e8521a)',
          WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
          ¡Gracias por su visita!
        </div>
        <div style={{ fontSize:15, color:'#c9d1d9', lineHeight:1.8, maxWidth:300, marginBottom:24 }}>
          Sesión finalizada.<br/>La cuenta de esta mesa fue cerrada.
        </div>

        {/* Boleta por WhatsApp */}
        {itemsParaBoleta.length > 0 && (
          <BoletaWsp totalBoleta={totalBoleta} generarMensajeWsp={generarMensajeWsp} />
        )}

        <div style={{ background:'rgba(245,166,35,.08)', border:'2px solid rgba(245,166,35,.3)',
          borderRadius:20, padding:'20px 28px', maxWidth:280, marginBottom:20 }}>
          <div style={{ fontSize:36, marginBottom:10 }}>📷</div>
          <div style={{ fontWeight:800, fontSize:14, color:'#f5a623', letterSpacing:1, marginBottom:6 }}>
            ¿Deseas ordenar de nuevo?
          </div>
          <div style={{ fontSize:13, color:'#8b949e', lineHeight:1.6 }}>
            Escanea el código QR de la mesa nuevamente para iniciar una nueva sesión.
          </div>
        </div>
        <div style={{ background:'#161b22', border:'1px solid #30363d',
          borderRadius:12, padding:'10px 20px', fontSize:12, color:'#8b949e' }}>
          Mesa <strong style={{ color:'#f5a623', fontSize:16 }}>{mesaNum}</strong>
        </div>
      </div>
    )
  }

  // ── PANTALLA SEGUIMIENTO ─────────────────────────────────────────
  if (screen === 'seguimiento') {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:'system-ui,sans-serif', paddingBottom:100 }}>

        <div style={{ background:'#161b22', borderBottom:'1px solid #30363d',
          padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:11, color:'#8b949e', letterSpacing:3, textTransform:'uppercase' }}>Tu Pedido</div>
            <div style={{ fontWeight:900, fontSize:28, color:'#f5a623', lineHeight:1, marginTop:2 }}>
              Mesa {mesaNum}
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#8b949e' }}>Total estimado</div>
            <div style={{ fontWeight:800, fontSize:20, color:'#27c97a', fontFamily:'monospace' }}>
              S/{totalGeneral.toFixed(2)}
            </div>
          </div>
        </div>

        <div style={{ display:'flex', borderBottom:'2px solid #21262d' }}>
          {[['estado','🍳 Estado'],['resumen','🧾 Mi Cuenta']].map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex:1, padding:'13px 0', background:'none', border:'none',
                borderBottom: tab===t ? '3px solid #f5a623' : '3px solid transparent',
                color: tab===t ? '#f5a623' : '#8b949e',
                fontWeight:800, fontSize:13, letterSpacing:1,
                cursor:'pointer', fontFamily:'system-ui,sans-serif', marginBottom:-2 }}>{l}</button>
          ))}
        </div>

        {tab === 'estado' && (
          <div style={{ padding:16 }}>
            {misPedidosRTDB.length === 0 ? (
              <div style={{ textAlign:'center', padding:'50px 20px', color:'#8b949e' }}>
                <div style={{ fontSize:50 }}>🍽</div>
                <div style={{ marginTop:12, fontSize:15, fontWeight:700 }}>Sin pedidos activos</div>
              </div>
            ) : misPedidosRTDB.map((pedido, i) => {
              const posicion = pedido.status === 'pending' ? getPosicionCocina(pedido.key) : null
              const totalPedido = (pedido.items||[]).reduce((a,it) => a + it.price * it.qty, 0)
              const cfg = {
                esperando_confirmacion: { icon:'⏳', color:'#f5a623', bg:'rgba(245,166,35,.1)',
                  title:'Esperando confirmación del mesero', sub:'El mesero revisará tu pedido en un momento' },
                pending: pedido.soloBebidas
                  ? { icon:'🥤', color:'#27c97a', bg:'rgba(39,201,122,.1)',
                      title:'¡Ahora mismo te lo llevamos!', sub:'Tu bebida está lista para ser servida' }
                  : { icon:'🍳', color:'#4a9eff', bg:'rgba(74,158,255,.1)',
                      title:'En preparación en cocina',
                      sub: posicion ? `Posición #${posicion} en cocina` : 'Cocinando tu pedido...' },
                listo: { icon:'✅', color:'#27c97a', bg:'rgba(39,201,122,.1)',
                  title:'¡Listo para entregar!', sub:'El mesero llevará tu pedido en breve' },
                rechazado: { icon:'❌', color:'#ff4d4d', bg:'rgba(255,77,77,.1)',
                  title:'Pedido no confirmado', sub:'Habla con el mesero para más información' },
              }[pedido.status] || { icon:'⏳', color:'#f5a623', bg:'rgba(245,166,35,.1)', title:'En proceso', sub:'' }

              return (
                <div key={pedido.key} style={{ background:'#161b22',
                  border:`2px solid ${cfg.color}40`, borderRadius:18, marginBottom:14, overflow:'hidden' }}>
                  <div style={{ background: cfg.bg, padding:'14px 16px',
                    borderBottom:`1px solid ${cfg.color}25` }}>
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ fontSize:36, lineHeight:1 }}>{cfg.icon}</div>
                      <div>
                        <div style={{ fontWeight:800, fontSize:14, color: cfg.color }}>{cfg.title}</div>
                        <div style={{ fontSize:12, color:'#8b949e', marginTop:3 }}>{cfg.sub}</div>
                      </div>
                    </div>
                    {pedido.status === 'pending' && !pedido.soloBebidas && posicion && (
                      <div style={{ marginTop:12 }}>
                        <div style={{ display:'flex', justifyContent:'space-between',
                          fontSize:10, color:'#8b949e', marginBottom:6 }}>
                          <span>Posición en cola</span>
                          <span style={{ color:'#4a9eff', fontWeight:800 }}>#{posicion}</span>
                        </div>
                        <div style={{ display:'flex', gap:4 }}>
                          {[1,2,3,4,5].map(n => (
                            <div key={n} style={{ flex:1, height:6, borderRadius:3,
                              background: n <= Math.min(posicion,5) ? '#4a9eff' : '#21262d',
                              transition:'background .3s' }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding:'12px 16px' }}>
                    <div style={{ fontSize:10, color:'#8b949e', letterSpacing:2,
                      textTransform:'uppercase', marginBottom:8 }}>
                      Pedido {i+1} · {new Date(pedido.timeISO).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}
                    </div>
                    {(pedido.items||[]).map((item,j) => (
                      <div key={j} style={{ display:'flex', justifyContent:'space-between',
                        fontSize:13, padding:'4px 0', color:'#c9d1d9',
                        borderBottom: j < pedido.items.length-1 ? '1px solid #21262d':'none' }}>
                        <span>×{item.qty} {item.name}</span>
                        <span style={{ fontFamily:'monospace', color:'#f5a623' }}>S/{(item.price*item.qty).toFixed(2)}</span>
                      </div>
                    ))}
                    {pedido.extras && (
                      <div style={{ marginTop:8, fontSize:12, color:'#f0e68c',
                        background:'rgba(240,230,140,.08)', borderRadius:8, padding:'6px 10px' }}>
                        📝 {pedido.extras}
                      </div>
                    )}
                    <div style={{ display:'flex', justifyContent:'space-between',
                      fontWeight:800, fontSize:14, marginTop:10,
                      paddingTop:8, borderTop:'1px solid #30363d' }}>
                      <span style={{ color:'#8b949e' }}>Subtotal</span>
                      <span style={{ color:'#27c97a', fontFamily:'monospace' }}>S/{totalPedido.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'resumen' && (
          <div style={{ padding:16 }}>
            <div style={{ background:'#161b22', border:'1px solid #30363d', borderRadius:18, overflow:'hidden' }}>
              <div style={{ background:'rgba(245,166,35,.08)', borderBottom:'1px solid #30363d',
                padding:16, textAlign:'center' }}>
                <div style={{ fontSize:24, marginBottom:4 }}>🧾</div>
                <div style={{ fontWeight:900, fontSize:16, letterSpacing:3 }}>MI CUENTA</div>
                <div style={{ fontSize:12, color:'#8b949e', marginTop:4 }}>Mesa {mesaNum}</div>
              </div>
              <div style={{ padding:16 }}>
                {(pedidoData?.items||[]).length === 0 ? (
                  <div style={{ textAlign:'center', color:'#8b949e', padding:'20px 0' }}>Sin pedidos aún</div>
                ) : (pedidoData?.items||[]).map((item,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', padding:'8px 0',
                    borderBottom: i < pedidoData.items.length-1 ? '1px solid #21262d':'none' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:14, color:'#c9d1d9' }}>{item.name}</div>
                      <div style={{ fontSize:12, color:'#8b949e', marginTop:2 }}>×{item.qty} · S/{item.price.toFixed(2)} c/u</div>
                    </div>
                    <div style={{ fontFamily:'monospace', fontWeight:800, fontSize:15, color:'#f5a623' }}>
                      S/{(item.price*item.qty).toFixed(2)}
                    </div>
                  </div>
                ))}
                <div style={{ borderTop:'2px dashed #30363d', marginTop:14, paddingTop:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontWeight:900, fontSize:22 }}>
                    <span>TOTAL</span>
                    <span style={{ color:'#27c97a', fontFamily:'monospace' }}>S/{totalGeneral.toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize:11, color:'#8b949e', marginTop:6, textAlign:'center' }}>
                    * El monto final puede incluir descuentos al cobrar
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ position:'fixed', bottom:0, left:0, right:0,
          background:'#161b22', borderTop:'1px solid #30363d', padding:'12px 16px 20px' }}>
          <button onClick={() => {
            const ses = getClienteSession(mesaKey)
            if (ses) saveClienteSession(mesaKey, { ...ses, screen: 'carta' })
            setScreen('carta')
          }}
            style={{ width:'100%', background:'#f5a623', color:'#111', border:'none',
              borderRadius:14, padding:'16px 0', fontSize:15, fontWeight:800,
              cursor:'pointer', letterSpacing:2 }}>
            ➕ PEDIR MÁS
          </button>
        </div>
      </div>
    )
  }

  // ── PANTALLA CARTA ────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
      fontFamily:'system-ui,sans-serif', paddingBottom:130 }}>

      <div style={{ background:'#161b22', borderBottom:'1px solid #30363d',
        padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, color:'#8b949e', letterSpacing:3, textTransform:'uppercase' }}>Menú Digital</div>
          <div style={{ fontWeight:900, fontSize:26, color:'#f5a623', lineHeight:1.1, marginTop:2 }}>Mesa {mesaNum}</div>
        </div>
        {misPedidosRTDB.length > 0 && (
          <button onClick={() => setScreen('seguimiento')}
            style={{ background:'rgba(39,201,122,.15)', border:'1px solid #27c97a',
              color:'#27c97a', borderRadius:10, padding:'8px 14px',
              fontSize:12, fontWeight:800, cursor:'pointer' }}>
            📋 Mis pedidos ({misPedidosRTDB.length})
          </button>
        )}
      </div>

      {!menu ? (
        <div style={{ textAlign:'center', padding:60, color:'#8b949e' }}>Cargando menú...</div>
      ) : (() => {
        const q = buscar.toLowerCase().trim()
        const menuFiltrado = Object.entries(menu).reduce((acc, [cat, items]) => {
          const f = items.filter(i => !q || i.name.toLowerCase().includes(q))
          if (f.length > 0) acc[cat] = f
          return acc
        }, {})

        return (
          <>
            {/* Buscador */}
            <div style={{ padding:'10px 16px 4px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8,
                background:'#161b22', border:'1.5px solid #30363d',
                borderRadius:12, padding:'10px 14px' }}>
                <span style={{ fontSize:16, color:'#8b949e' }}>🔍</span>
                <input type="text" placeholder="Buscar plato..."
                  value={buscar} onChange={e => setBuscar(e.target.value)}
                  style={{ flex:1, background:'none', border:'none', color:'white',
                    fontSize:15, outline:'none', fontFamily:'system-ui,sans-serif' }} />
                {buscar && (
                  <button onClick={() => setBuscar('')}
                    style={{ background:'none', border:'none', color:'#8b949e',
                      fontSize:18, cursor:'pointer', padding:0, lineHeight:1 }}>✕</button>
                )}
              </div>
            </div>

            {q && Object.keys(menuFiltrado).length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'#8b949e' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>🔍</div>
                <div>Sin resultados para "<strong>{buscar}</strong>"</div>
              </div>
            ) : Object.entries(menuFiltrado).map(([cat, items]) => (
              <div key={cat} style={{ padding:'16px 16px 4px' }}>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:3,
                  color:'#f5a623', textTransform:'uppercase', marginBottom:10,
                  borderBottom:'1px solid #21262d', paddingBottom:6 }}>{cat}</div>
                {items.map(item => {
                  const disabled      = deshabilitados.has(item.id)
                  const tieneVariantes = item.variantes?.length > 0
                  const totalItemQty  = tieneVariantes
                    ? item.variantes.reduce((a, _, i) => a + getQty(item.id, i), 0)
                    : getQty(item.id, 0)

                  return (
                    <div key={item.id} style={{
                      background: disabled ? 'rgba(255,255,255,.02)' : totalItemQty > 0 ? 'rgba(245,166,35,.08)' : '#161b22',
                      border:`1.5px solid ${disabled ? '#21262d' : totalItemQty > 0 ? '#f5a623' : '#30363d'}`,
                      borderRadius:14, marginBottom:8, overflow:'hidden',
                      transition:'all .15s', opacity: disabled ? 0.55 : 1 }}>

                      {/* Cabecera */}
                      <div style={{ display:'flex', alignItems:'stretch' }}>
                        {item.fotoUrl ? (
                          <img src={item.fotoUrl} alt={item.name} loading="lazy"
                            style={{ width:80, objectFit:'cover', flexShrink:0,
                              filter: disabled ? 'grayscale(1)' : 'none' }} />
                        ) : (
                          <div style={{ width:80, minHeight:72, background:'#21262d',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:28, flexShrink:0, color:'#30363d' }}>🍽</div>
                        )}
                        <div style={{ flex:1, padding:'10px 12px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <div style={{ fontWeight:600, fontSize:15,
                              color: disabled ? '#8b949e' : '#c9d1d9',
                              textDecoration: disabled ? 'line-through' : 'none' }}>{item.name}</div>
                            {disabled && (
                              <span style={{ background:'rgba(255,77,77,.15)', color:'#ff4d4d',
                                fontSize:9, fontWeight:800, padding:'2px 7px',
                                borderRadius:20, letterSpacing:1 }}>AGOTADO</span>
                            )}
                          </div>
                          {/* Precio simple o badges de variantes */}
                          {tieneVariantes ? (
                            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:6 }}>
                              {item.variantes.map((v,vi) => (
                                <span key={vi} style={{
                                  background:'rgba(245,166,35,.1)',
                                  border:'1px solid rgba(245,166,35,.25)',
                                  borderRadius:20, padding:'3px 8px',
                                  fontSize:11, fontWeight:700, color:'#f5a623',
                                  fontFamily:'monospace', whiteSpace:'nowrap' }}>
                                  {v.nombre} · S/{Number(v.precio).toFixed(2)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: disabled ? '#8b949e' : '#f5a623',
                              fontWeight:800, fontSize:14, fontFamily:'monospace', marginTop:2 }}>
                              S/ {item.price}.00
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Variantes con botones */}
                      {!disabled && tieneVariantes && (
                        <div style={{ borderTop:'1px solid #21262d' }}>
                          {item.variantes.map((v, vi) => {
                            const key = `${item.id}__${vi}`
                            const qty = getQty(item.id, vi)
                            return (
                              <div key={vi}>
                                <div style={{
                                  display:'flex', alignItems:'center',
                                  justifyContent:'space-between', padding:'9px 12px',
                                  borderBottom: vi < item.variantes.length-1 && !qty ? '1px solid #21262d' : 'none',
                                  background: qty > 0 ? 'rgba(245,166,35,.04)' : 'none' }}>
                                  <div>
                                    <span style={{ fontWeight:700, fontSize:13,
                                      color: qty > 0 ? '#f5a623' : '#c9d1d9' }}>{v.nombre}</span>
                                    <span style={{ fontFamily:'monospace', fontSize:12,
                                      color:'#f5a623', marginLeft:8, fontWeight:700 }}>
                                      S/{Number(v.precio).toFixed(2)}
                                    </span>
                                  </div>
                                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                    <button onClick={() => setQty(item.id, vi, v.precio, item.name, v.nombre, item.category, -1)}
                                      style={{ width:32, height:32, borderRadius:'50%', background:'#21262d',
                                        border:'1.5px solid #30363d', color:'white', fontSize:18,
                                        cursor:'pointer', display:'flex', alignItems:'center',
                                        justifyContent:'center', fontWeight:700 }}>−</button>
                                    <span style={{ fontFamily:'monospace', fontWeight:800, fontSize:16,
                                      color: qty > 0 ? '#f5a623' : '#8b949e',
                                      minWidth:20, textAlign:'center' }}>{qty}</span>
                                    <button onClick={() => setQty(item.id, vi, v.precio, item.name, v.nombre, item.category, 1)}
                                      style={{ width:32, height:32, borderRadius:'50%',
                                        background: qty > 0 ? '#f5a623' : '#21262d',
                                        border:'1.5px solid #30363d',
                                        color: qty > 0 ? '#111' : 'white',
                                        fontSize:18, cursor:'pointer', display:'flex', alignItems:'center',
                                        justifyContent:'center', fontWeight:700 }}>+</button>
                                  </div>
                                </div>
                                {qty > 0 && (
                                  <div style={{ padding:'0 12px 8px',
                                    borderBottom: vi < item.variantes.length-1 ? '1px solid #21262d' : 'none' }}>
                                    <input type="text"
                                      placeholder="✏️ Ej: sin cebolla, extra picante..."
                                      value={carrito[key]?.nota || ''}
                                      onChange={e => setCarrito(prev => prev[key]
                                        ? { ...prev, [key]: { ...prev[key], nota: e.target.value } }
                                        : prev)}
                                      style={{ width:'100%', background:'#21262d', border:'1px solid #30363d',
                                        borderRadius:8, padding:'7px 10px', color:'white',
                                        fontSize:12, fontFamily:'system-ui,sans-serif', outline:'none',
                                        boxSizing:'border-box' }} />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Plato simple — botones + nota */}
                      {!disabled && !tieneVariantes && (
                        <>
                          <div style={{ display:'flex', alignItems:'center', gap:8,
                            justifyContent:'flex-end', padding:'0 12px 10px' }}>
                            <button onClick={() => setQty(item.id, 0, item.price, item.name, '', item.category, -1)}
                              style={{ width:34, height:34, borderRadius:'50%', background:'#21262d',
                                border:'1.5px solid #30363d', color:'white', fontSize:20,
                                cursor:'pointer', display:'flex', alignItems:'center',
                                justifyContent:'center', fontWeight:700 }}>−</button>
                            <span style={{ fontFamily:'monospace', fontWeight:800, fontSize:17,
                              color: getQty(item.id,0) > 0 ? '#f5a623' : '#8b949e',
                              minWidth:22, textAlign:'center' }}>{getQty(item.id,0)}</span>
                            <button onClick={() => setQty(item.id, 0, item.price, item.name, '', item.category, 1)}
                              style={{ width:34, height:34, borderRadius:'50%',
                                background: getQty(item.id,0) > 0 ? '#f5a623' : '#21262d',
                                border:'1.5px solid #30363d',
                                color: getQty(item.id,0) > 0 ? '#111' : 'white',
                                fontSize:20, cursor:'pointer', display:'flex', alignItems:'center',
                                justifyContent:'center', fontWeight:700 }}>+</button>
                          </div>
                          {getQty(item.id, 0) > 0 && (
                            <div style={{ padding:'0 12px 10px', borderTop:'1px solid #21262d' }}>
                              <input type="text"
                                placeholder="✏️ Ej: sin cebolla, extra picante..."
                                value={carrito[`${item.id}__0`]?.nota || ''}
                                onChange={e => setCarrito(prev => {
                                  const key = `${item.id}__0`
                                  return prev[key] ? { ...prev, [key]: { ...prev[key], nota: e.target.value } } : prev
                                })}
                                style={{ width:'100%', background:'#21262d', border:'1px solid #30363d',
                                  borderRadius:8, padding:'7px 10px', color:'white',
                                  fontSize:12, fontFamily:'system-ui,sans-serif', outline:'none',
                                  boxSizing:'border-box' }} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </>
        )
      })()}

      <div style={{ padding:'8px 16px 0' }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:3, color:'#8b949e',
          textTransform:'uppercase', marginBottom:8 }}>📝 Notas (opcional)</div>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          placeholder="Ej: sin cebolla, extra limón..."
          style={{ width:'100%', background:'#161b22', border:'1.5px solid #30363d',
            borderRadius:12, padding:'12px 14px', color:'white', fontSize:14,
            fontFamily:'system-ui,sans-serif', resize:'vertical',
            minHeight:70, boxSizing:'border-box' }} />
      </div>

      <div style={{ position:'fixed', bottom:0, left:0, right:0,
        background:'#161b22', borderTop:'1px solid #30363d', padding:'12px 16px 20px' }}>
        {totalItems > 0 && (
          <div style={{ display:'flex', justifyContent:'space-between',
            fontSize:13, marginBottom:10, color:'#8b949e' }}>
            <span><span style={{ color:'#f5a623', fontWeight:800 }}>{totalItems} ítem(s)</span></span>
            <span style={{ color:'#f5a623', fontFamily:'monospace', fontWeight:800 }}>S/ {totalPrice.toFixed(2)}</span>
          </div>
        )}
        <button onClick={enviar} disabled={totalItems === 0 || sending}
          style={{ width:'100%',
            background: totalItems === 0 ? '#21262d' : '#f5a623',
            color: totalItems === 0 ? '#8b949e' : '#111',
            border:'none', borderRadius:14, padding:'16px 0',
            fontSize:15, fontWeight:800,
            cursor: totalItems === 0 ? 'not-allowed' : 'pointer',
            letterSpacing:2, transition:'all .2s' }}>
          {sending ? 'ENVIANDO...' : totalItems === 0 ? 'SELECCIONA ALGO' : '📨 ENVIAR PEDIDO'}
        </button>
      </div>
    </div>
  )
}
