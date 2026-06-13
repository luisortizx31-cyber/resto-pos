import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db, rtdb } from '../lib/firebase'
import { collection, getDocs, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { ref, push, onValue } from 'firebase/database'
import { esSoloBebidas } from '../lib/utils'

const STATUS_INFO = {
  esperando_confirmacion: { icon:'⏳', label:'Esperando confirmación', color:'#f5a623', bg:'rgba(245,166,35,.12)' },
  pending:   { icon:'🍳', label:'En preparación', color:'#4a9eff',  bg:'rgba(74,158,255,.12)' },
  listo:     { icon:'✅', label:'¡Listo! Asignando repartidor...', color:'#27c97a', bg:'rgba(39,201,122,.12)' },
  en_camino: { icon:'🛵', label:'¡Tu repartidor va en camino!', color:'#27c97a', bg:'rgba(39,201,122,.12)' },
  rechazado: { icon:'❌', label:'Pedido no aceptado', color:'#ff4d4d', bg:'rgba(255,77,77,.12)' },
}

function getClienteId() {
  let id = sessionStorage.getItem('delivery_cliente_id')
  if (!id) {
    id = 'del_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    sessionStorage.setItem('delivery_cliente_id', id)
  }
  return id
}

function mergeItemsFlat(pedidos) {
  const map = {}
  pedidos.forEach(p => {
    ;(p.items || []).forEach(item => {
      const k = item.id || item.name
      if (map[k]) map[k] = { ...map[k], qty: map[k].qty + item.qty }
      else map[k] = { ...item }
    })
  })
  return Object.values(map)
}

export default function Delivery() {
  const { restoId } = useParams()
  const clienteId   = getClienteId()

  const [screen, setScreen]       = useState('carta') // 'carta' | 'form' | 'seguimiento'
  const [menu, setMenu]           = useState(null)
  const [restoInfo, setRestoInfo] = useState(null)
  const [carrito, setCarrito]     = useState({}) // { 'itemId__varIdx': { qty, price, name, variantName, category, id } }
  const [notas, setNotas]         = useState('')
  const [formData, setFormData]   = useState({ nombre:'', telefono:'', direccion:'', referencia:'', pago:'efectivo' })
  const [sending, setSending]     = useState(false)
  const [misPedidos, setMisPedidos] = useState([])
  const [deshabilitados, setDeshabilitados] = useState(new Set())
  const [buscar, setBuscar]       = useState('')

  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId)).then(snap => {
      if (snap.exists()) setRestoInfo(snap.data())
    })
    getDocs(collection(db, 'restaurantes', restoId, 'menu')).then(async snap => {
      if (snap.empty) { setMenu({}); return }
      const byCategory = {}
      snap.forEach(d => {
        const data = d.data()
        if (!byCategory[data.category]) byCategory[data.category] = []
        byCategory[data.category].push({ id: d.id, ...data })
      })
      // Respetar orden de categorías guardado en config
      try {
        const catSnap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'))
        if (catSnap.exists() && catSnap.data().lista?.length) {
          const orden = catSnap.data().lista
          const sorted = {}
          orden.forEach(cat => { if (byCategory[cat]) sorted[cat] = byCategory[cat] })
          Object.keys(byCategory).forEach(cat => { if (!sorted[cat]) sorted[cat] = byCategory[cat] })
          setMenu(sorted)
          return
        }
      } catch {}
      setMenu(byCategory)
    }).catch(() => setMenu({}))
    // Platos deshabilitados
    onSnapshot(doc(db, 'restaurantes', restoId, 'config', 'menu'), snap => {
      if (snap.exists()) setDeshabilitados(new Set(snap.data().deshabilitados || []))
    })
    const unsub = onValue(ref(rtdb, `${restoId}/delivery_pedidos`), snap => {
      const data = snap.val() || {}
      const mios = Object.entries(data)
        .filter(([, o]) => o.clienteId === clienteId)
        .map(([key, o]) => ({ key, ...o }))
        .sort((a, b) => new Date(a.timeISO) - new Date(b.timeISO))
      setMisPedidos(mios)
      if (mios.length > 0)
        setScreen(prev => prev === 'carta' || prev === 'form' ? 'seguimiento' : prev)
    })
    return () => unsub()
  }, [restoId])

  const carritoKey = (itemId, varIdx) => `${itemId}__${varIdx}`

  const setQty = (itemId, varIdx, price, name, variantName, category, delta) => {
    const key = carritoKey(itemId, varIdx)
    setCarrito(prev => {
      const cur  = prev[key]?.qty || 0
      const next = Math.max(0, cur + delta)
      const updated = { ...prev }
      if (next === 0) delete updated[key]
      else updated[key] = { qty:next, price, name, variantName, category, id:itemId }
      return updated
    })
  }

  const getQty = (itemId, varIdx) => carrito[carritoKey(itemId, varIdx)]?.qty || 0

  const totalItems = Object.values(carrito).reduce((a, v) => a + v.qty, 0)
  const totalPrice = Object.values(carrito).reduce((a, v) => a + v.price * v.qty, 0)

  const enviar = async () => {
    if (!formData.nombre.trim() || !formData.direccion.trim() || !formData.telefono.trim()) {
      alert('Completa tu nombre, teléfono y dirección'); return
    }
    setSending(true)
    try {
      const itemsArr = Object.values(carrito).map(v => ({
        id:       v.id,
        name:     v.variantName ? `${v.name} (${v.variantName})` : v.name,
        price:    v.price,
        qty:      v.qty,
        category: v.category || '',
      }))
      const soloBebidas = esSoloBebidas(itemsArr)
      await push(ref(rtdb, `${restoId}/delivery_pedidos`), {
        items: itemsArr,
        notas: notas.trim(),
        cliente: formData,
        clienteId,
        telefonoCliente: formData.telefono.trim(),
        status: 'esperando_confirmacion',
        soloBebidas,
        timeISO: new Date().toISOString(),
        total: totalPrice,
      })
      // Abrir WhatsApp del dueño con resumen del pedido
      if (restoInfo?.whatsapp) {
        const lineas = itemsArr.map(i => `• ${i.qty}x ${i.name} - S/${(i.price * i.qty).toFixed(2)}`).join('\n')
        const msg = `🛵 *NUEVO PEDIDO DELIVERY*\n\n👤 *Cliente:* ${formData.nombre}\n📍 *Dirección:* ${formData.direccion}\n📌 *Referencia:* ${formData.referencia || '—'}\n💳 *Pago:* ${formData.pago === 'yape' ? '📲 Yape' : '💵 Efectivo'}\n\n*Pedido:*\n${lineas}\n\n💰 *Total: S/${totalPrice.toFixed(2)}*\n${notas.trim() ? `📝 Nota: ${notas.trim()}` : ''}`
        window.open(`https://wa.me/${restoInfo.whatsapp}?text=${encodeURIComponent(msg)}`, '_blank')
      }
      setCarrito({}); setNotas(''); setScreen('seguimiento')
    } catch { alert('Error al enviar. Intenta de nuevo.') }
    setSending(false)
  }

  // ── SEGUIMIENTO ─────────────────────────────────────────────────
  if (screen === 'seguimiento') {
    const merged = mergeItemsFlat(misPedidos)
    const totalGeneral = merged.reduce((a, i) => a + i.price * i.qty, 0)

    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:100 }}>
        <div style={{ background:'#161b22', borderBottom:'1px solid #30363d',
          padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:11, color:'#8b949e', letterSpacing:3, textTransform:'uppercase' }}>Delivery</div>
            <div style={{ fontWeight:900, fontSize:22, color:'#f5a623' }}>{restoInfo?.nombre || 'Restaurante'}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#8b949e' }}>Total</div>
            <div style={{ fontWeight:800, fontSize:18, color:'#27c97a', fontFamily:'monospace' }}>
              S/{totalGeneral.toFixed(2)}
            </div>
          </div>
        </div>

        <div style={{ padding:16 }}>
          {misPedidos.map(pedido => {
            const info = STATUS_INFO[pedido.status] || STATUS_INFO['pending']
            const total = (pedido.items || []).reduce((a, it) => a + it.price * it.qty, 0)
            const enCamino = pedido.status === 'en_camino'
            const tieneRepartidor = enCamino && pedido.repartidorNombre
            const esOtro = pedido.repartidorId === 'otro'
            // Número de WhatsApp a quien contactar
            const waTarget = esOtro
              ? (restoInfo?.whatsapp || '')
              : (pedido.repartidorCelular || '')
            const waNombre = esOtro ? 'la central' : pedido.repartidorNombre
            const waMsg = esOtro
              ? `¡Hola! Soy el cliente del pedido actual. Aquí te comparto mi ubicación para la entrega: `
              : `¡Hola ${pedido.repartidorNombre}! Soy el cliente del pedido actual. Aquí te comparto mi ubicación para la entrega: `

            return (
              <div key={pedido.key} style={{ background:'#161b22',
                border:`2px solid ${info.color}40`, borderRadius:18, marginBottom:14, overflow:'hidden' }}>
                {/* Estado */}
                <div style={{ background: info.bg, padding:'14px 16px',
                  borderBottom:`1px solid ${info.color}25`,
                  display:'flex', alignItems:'center', gap:12 }}>
                  <span style={{ fontSize:32 }}>{info.icon}</span>
                  <div>
                    <div style={{ fontWeight:800, fontSize:14, color: info.color }}>{info.label}</div>
                    <div style={{ fontSize:11, color:'#8b949e', marginTop:2 }}>
                      {new Date(pedido.timeISO).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}
                    </div>
                  </div>
                </div>

                {/* Datos del repartidor cuando está en camino */}
                {tieneRepartidor && (
                  <div style={{ padding:'12px 16px', background:'rgba(39,201,122,.06)',
                    borderBottom:'1px solid rgba(39,201,122,.15)' }}>
                    <div style={{ fontSize:11, color:'#27c97a', fontWeight:800,
                      letterSpacing:2, textTransform:'uppercase', marginBottom:8 }}>
                      Tu repartidor
                    </div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                      <div>
                        <div style={{ fontWeight:800, fontSize:16, color:'white' }}>
                          🛵 {pedido.repartidorNombre}
                        </div>
                        {!esOtro && pedido.repartidorCelular && (
                          <div style={{ fontSize:13, color:'#8b949e', marginTop:3 }}>
                            📱 {pedido.repartidorCelular}
                          </div>
                        )}
                        {esOtro && (
                          <div style={{ fontSize:12, color:'#8b949e', marginTop:3 }}>
                            Contacta al restaurante para compartir tu ubicación
                          </div>
                        )}
                      </div>
                      {waTarget && (
                        <a href={`https://wa.me/${waTarget}?text=${encodeURIComponent(waMsg)}`}
                          target="_blank" rel="noreferrer"
                          style={{ background:'#25d366', color:'white', border:'none',
                            borderRadius:14, padding:'12px 16px', fontSize:13, fontWeight:800,
                            textDecoration:'none', display:'flex', alignItems:'center',
                            gap:6, whiteSpace:'nowrap', flexShrink:0 }}>
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Detalle del pedido */}
                <div style={{ padding:'12px 16px' }}>
                  <div style={{ fontSize:12, color:'#8b949e', marginBottom:8 }}>
                    📍 {pedido.cliente?.direccion}
                    {pedido.cliente?.referencia && ` · ${pedido.cliente.referencia}`}
                  </div>
                  {(pedido.items || []).map((item, j) => (
                    <div key={j} style={{ display:'flex', justifyContent:'space-between',
                      fontSize:13, padding:'4px 0', color:'#c9d1d9',
                      borderBottom: j < pedido.items.length - 1 ? '1px solid #21262d' : 'none' }}>
                      <span>×{item.qty} {item.name}</span>
                      <span style={{ fontFamily:'monospace', color:'#f5a623' }}>S/{(item.price * item.qty).toFixed(2)}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between',
                    fontWeight:800, fontSize:15, marginTop:10, paddingTop:8, borderTop:'1px solid #30363d' }}>
                    <span style={{ color:'#8b949e' }}>
                      {pedido.cliente?.pago === 'yape' ? '📲 Yape' : '💵 Efectivo'}
                    </span>
                    <span style={{ color:'#27c97a', fontFamily:'monospace' }}>S/{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ position:'fixed', bottom:0, left:0, right:0,
          background:'#161b22', borderTop:'1px solid #30363d', padding:'12px 16px 20px' }}>
          <button onClick={() => setScreen('carta')}
            style={{ width:'100%', background:'#f5a623', color:'#111', border:'none',
              borderRadius:14, padding:'16px 0', fontSize:15, fontWeight:800,
              cursor:'pointer', letterSpacing:2 }}>➕ AGREGAR MÁS</button>
        </div>
      </div>
    )
  }

  // ── FORMULARIO ──────────────────────────────────────────────────
  if (screen === 'form') {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:120 }}>
        <div style={{ background:'#161b22', borderBottom:'1px solid #30363d', padding:'16px 20px',
          display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={() => setScreen('carta')}
            style={{ background:'none', border:'none', color:'#8b949e', fontSize:18, cursor:'pointer' }}>←</button>
          <div>
            <div style={{ fontSize:11, color:'#8b949e', letterSpacing:3, textTransform:'uppercase' }}>Delivery</div>
            <div style={{ fontWeight:800, fontSize:18, color:'#f5a623' }}>Tus datos</div>
          </div>
        </div>
        <div style={{ padding:20 }}>
          {/* Resumen pedido */}
          <div style={{ background:'#161b22', border:'1px solid #30363d', borderRadius:14,
            padding:14, marginBottom:20 }}>
            <div style={{ fontSize:11, color:'#f5a623', fontWeight:800, letterSpacing:2,
              textTransform:'uppercase', marginBottom:8 }}>Tu pedido</div>
            {Object.entries(carrito).map(([id, qty]) => {
              let itemData = null
              if (menu) for (const items of Object.values(menu)) {
                const f = items.find(i => i.id === id); if (f) { itemData = f; break }
              }
              if (!itemData) return null
              return (
                <div key={id} style={{ display:'flex', justifyContent:'space-between',
                  fontSize:13, color:'#c9d1d9', padding:'3px 0' }}>
                  <span>×{qty} {itemData.name}</span>
                  <span style={{ fontFamily:'monospace', color:'#f5a623' }}>S/{(itemData.price * qty).toFixed(2)}</span>
                </div>
              )
            })}
            <div style={{ display:'flex', justifyContent:'space-between',
              fontWeight:800, fontSize:16, marginTop:10, paddingTop:8, borderTop:'1px solid #30363d' }}>
              <span>Total</span>
              <span style={{ color:'#27c97a', fontFamily:'monospace' }}>S/{totalPrice.toFixed(2)}</span>
            </div>
          </div>

          {[['nombre','👤 Nombre completo','Tu nombre completo'],
            ['telefono','📱 Teléfono / WhatsApp *','Ej: 51987654321'],
            ['direccion','📍 Dirección','Calle, número, distrito'],
            ['referencia','📌 Referencia (opcional)','Ej: frente al parque, casa azul']
          ].map(([k, l, p]) => (
            <div key={k} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:'#8b949e', letterSpacing:2,
                textTransform:'uppercase', marginBottom:6 }}>{l}</div>
              <input value={formData[k]} onChange={e => setFormData(f => ({ ...f, [k]: e.target.value }))}
                placeholder={p}
                type={k === 'telefono' ? 'tel' : 'text'}
                style={{ width:'100%', background:'#161b22', border:'1.5px solid #30363d',
                  borderRadius:12, padding:'12px 14px', color:'white', fontSize:14,
                  fontFamily:"'Inter',system-ui,sans-serif", boxSizing:'border-box' }} />
            </div>
          ))}

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:'#8b949e', letterSpacing:2,
              textTransform:'uppercase', marginBottom:10 }}>💳 Método de pago</div>
            <div style={{ display:'flex', gap:10 }}>
              {[['efectivo','💵 Efectivo'],['yape','📲 Yape']].map(([val, label]) => (
                <button key={val} onClick={() => setFormData(f => ({ ...f, pago: val }))}
                  style={{ flex:1, background: formData.pago===val?'rgba(245,166,35,.15)':'#161b22',
                    border:`2px solid ${formData.pago===val?'#f5a623':'#30363d'}`,
                    color: formData.pago===val?'#f5a623':'#8b949e',
                    borderRadius:14, padding:'14px 0', fontSize:14, fontWeight:800,
                    cursor:'pointer', fontFamily:"'Inter',system-ui,sans-serif" }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, color:'#8b949e', letterSpacing:2,
              textTransform:'uppercase', marginBottom:6 }}>📝 Notas (opcional)</div>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Ej: sin cebolla, extra picante..."
              style={{ width:'100%', background:'#161b22', border:'1.5px solid #30363d',
                borderRadius:12, padding:'12px 14px', color:'white', fontSize:14,
                fontFamily:"'Inter',system-ui,sans-serif", resize:'vertical',
                minHeight:70, boxSizing:'border-box' }} />
          </div>
        </div>

        <div style={{ position:'fixed', bottom:0, left:0, right:0,
          background:'#161b22', borderTop:'1px solid #30363d', padding:'12px 16px 20px' }}>
          {/* Aviso WhatsApp */}
          {restoInfo?.whatsapp && (
            <div style={{ fontSize:11, color:'#8b949e', textAlign:'center', marginBottom:10 }}>
              📲 Al confirmar, se abrirá WhatsApp para notificar al restaurante
            </div>
          )}
          <button onClick={enviar} disabled={sending}
            style={{ width:'100%', background:'#f5a623', color:'#111', border:'none',
              borderRadius:14, padding:'16px 0', fontSize:15, fontWeight:800,
              cursor:'pointer', letterSpacing:2 }}>
            {sending ? 'ENVIANDO...' : '📨 CONFIRMAR Y NOTIFICAR'}
          </button>
        </div>
      </div>
    )
  }

  // ── SIN DELIVERY ────────────────────────────────────────────────
  if (restoInfo && restoInfo.tieneDelivery === false) {
    return (
      <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
        fontFamily:"'Inter',system-ui,sans-serif",
        display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', padding:30, textAlign:'center' }}>
        <div style={{ fontSize:80, marginBottom:20 }}>🛵</div>
        <div style={{ fontSize:22, fontWeight:800, marginBottom:10 }}>{restoInfo?.nombre || 'Restaurante'}</div>
        <div style={{ fontSize:15, color:'#8b949e', lineHeight:1.7, maxWidth:280 }}>
          El servicio de delivery no está disponible en este momento.
        </div>
      </div>
    )
  }

  // ── CARTA ───────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
      fontFamily:"'Inter',system-ui,sans-serif", paddingBottom:130 }}>
      <div style={{ background:'#161b22', borderBottom:'1px solid #30363d',
        padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:11, color:'#8b949e', letterSpacing:3, textTransform:'uppercase' }}>Delivery</div>
          <div style={{ fontWeight:900, fontSize:30, color:'#f5a623', lineHeight:1.1 }}>{restoInfo?.nombre || 'Restaurante'}</div>
        </div>
        {misPedidos.length > 0 && (
          <button onClick={() => setScreen('seguimiento')}
            style={{ background:'rgba(39,201,122,.15)', border:'1px solid #27c97a',
              color:'#27c97a', borderRadius:10, padding:'8px 14px',
              fontSize:12, fontWeight:800, cursor:'pointer' }}>
            📋 Mis pedidos ({misPedidos.length})
          </button>
        )}
      </div>

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

      {!menu ? (
        <div style={{ textAlign:'center', padding:60, color:'#8b949e' }}>Cargando menú...</div>
      ) : Object.keys(menu).length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'#8b949e' }}>
          <div style={{ fontSize:48, opacity:.3 }}>🍽</div>
          <div style={{ marginTop:12 }}>Menú no disponible</div>
        </div>
      ) : (() => {
        const q = buscar.toLowerCase().trim()
        const menuFiltrado = Object.entries(menu).reduce((acc, [cat, items]) => {
          const catMatch = cat.toLowerCase().includes(q)
          const f = items.filter(i => !q || catMatch || i.name.toLowerCase().includes(q))
          if (f.length) acc[cat] = f
          return acc
        }, {})
        if (q && !Object.keys(menuFiltrado).length) return (
          <div style={{ textAlign:'center', padding:40, color:'#8b949e' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🔍</div>
            Sin resultados para "<strong>{buscar}</strong>"
          </div>
        )
        return Object.entries(menuFiltrado).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom:8 }}>
            {/* Header categoría grande */}
            <div style={{
              margin:'12px 12px 8px',
              background:'linear-gradient(135deg, rgba(245,166,35,.12), rgba(245,166,35,.04))',
              border:'1.5px solid rgba(245,166,35,.35)',
              borderRadius:14, padding:'12px 16px',
              display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:4, height:32, background:'#f5a623', borderRadius:4, flexShrink:0 }} />
              <div style={{ fontWeight:900, fontSize:20, color:'#f5a623',
                letterSpacing:1, textTransform:'uppercase' }}>{cat}</div>
            </div>
            <div style={{ padding:'0 12px 4px' }}>
            {items.map(item => {
              const disabled       = deshabilitados.has(item.id)
              const tieneVariantes = item.variantes?.length > 0
              const totalItemQty   = tieneVariantes
                ? item.variantes.reduce((a, _, i) => a + getQty(item.id, i), 0)
                : getQty(item.id, 0)
              return (
                <div key={item.id} style={{
                  background: disabled ? 'rgba(255,255,255,.02)' : totalItemQty > 0 ? 'rgba(245,166,35,.08)' : '#161b22',
                  border:`1.5px solid ${disabled ? '#21262d' : totalItemQty > 0 ? '#f5a623' : '#30363d'}`,
                  borderRadius:14, marginBottom:8, overflow:'hidden',
                  transition:'all .15s', opacity: disabled ? 0.55 : 1 }}>

                  {/* Cabecera item */}
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
                      {!tieneVariantes && (
                        <div style={{ color: disabled ? '#8b949e' : '#f5a623',
                          fontWeight:800, fontSize:14, fontFamily:'monospace', marginTop:2 }}>
                          S/ {Number(item.price).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Variantes */}
                  {!disabled && tieneVariantes && (
                    <div style={{ borderTop:'1px solid #21262d' }}>
                      {item.variantes.map((v, vi) => {
                        const qty = getQty(item.id, vi)
                        return (
                          <div key={vi} style={{
                            display:'flex', alignItems:'center', justifyContent:'space-between',
                            padding:'9px 12px',
                            borderBottom: vi < item.variantes.length-1 ? '1px solid #21262d' : 'none',
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
                        )
                      })}
                    </div>
                  )}

                  {/* Plato simple — botones */}
                  {!disabled && !tieneVariantes && (
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
                  )}
                </div>
              )
            })}
            </div>
          </div>
        ))
      })()}

      <div style={{ position:'fixed', bottom:0, left:0, right:0,
        background:'#161b22', borderTop:'1px solid #30363d', padding:'12px 16px 20px' }}>
        {totalItems > 0 && (
          <div style={{ display:'flex', justifyContent:'space-between',
            fontSize:13, marginBottom:10, color:'#8b949e' }}>
            <span><span style={{ color:'#f5a623', fontWeight:800 }}>{totalItems} ítem(s)</span></span>
            <span style={{ color:'#f5a623', fontFamily:'monospace', fontWeight:800 }}>S/ {totalPrice.toFixed(2)}</span>
          </div>
        )}
        <button onClick={() => totalItems > 0 && setScreen('form')} disabled={totalItems === 0}
          style={{ width:'100%', background: totalItems === 0 ? '#21262d' : '#f5a623',
            color: totalItems === 0 ? '#8b949e' : '#111', border:'none', borderRadius:14,
            padding:'16px 0', fontSize:15, fontWeight:800,
            cursor: totalItems === 0 ? 'not-allowed' : 'pointer', letterSpacing:2 }}>
          {totalItems === 0 ? 'SELECCIONA ALGO' : 'CONTINUAR →'}
        </button>
      </div>
    </div>
  )
}
