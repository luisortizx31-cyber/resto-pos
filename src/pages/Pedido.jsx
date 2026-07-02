import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, rtdb } from '../lib/firebase'
import { collection, getDocs, doc, getDoc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore'
import { ref, push } from 'firebase/database'
import { useToast, useSession } from '../components/Layout'
import { esSoloBebidas } from '../lib/utils'

const DEFAULT_MENU = {}

// carrito: { 'itemId__varIdx': { qty, price, name, variantName, category, id } }
// Para platos sin variantes: key = 'itemId__0', variantName = ''

export default function Pedido() {
  const session  = useSession()
  const restoId  = session?.restoId
  const { mesa } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [menu, setMenu]               = useState(null)
  const [carrito, setCarrito]         = useState({})
  const [extras, setExtras]           = useState('')
  const [extrasPrice, setExtrasPrice] = useState('')
  const [sending, setSending]         = useState(false)
  const [buscar, setBuscar]           = useState('')
  const [deshabilitados, setDeshabilitados] = useState(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [catsAbiertas, setCatsAbiertas] = useState({})
  const [itemsAbiertos, setItemsAbiertos] = useState({})

  const setNota = (key, val) => {
    setCarrito(prev => prev[key] ? { ...prev, [key]: { ...prev[key], nota: val } } : prev)
  }

  useEffect(() => {
    async function loadMenu() {
      try {
        const snap = await getDocs(collection(db, 'restaurantes', restoId, 'menu'))
        if (snap.empty) { setMenu(DEFAULT_MENU); return }
        const byCategory = {}
        snap.forEach(d => {
          const data = d.data()
          if (!byCategory[data.category]) byCategory[data.category] = []
          byCategory[data.category].push({ id:d.id, ...data })
        })
        // Respetar orden de categorías guardado en config
        try {
          const catSnap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'))
          if (catSnap.exists() && catSnap.data().lista?.length) {
            const orden = catSnap.data().lista
            const sorted = {}
            orden.forEach(cat => { if (byCategory[cat]) sorted[cat] = byCategory[cat] })
            Object.keys(byCategory).forEach(cat => { if (!sorted[cat]) sorted[cat] = byCategory[cat] })
            setMenu(Object.keys(sorted).length ? sorted : DEFAULT_MENU)
            return
          }
        } catch {}
        setMenu(Object.keys(byCategory).length ? byCategory : DEFAULT_MENU)
      } catch { setMenu(DEFAULT_MENU) }
    }
    loadMenu()
  }, [])

  useEffect(() => {
    if (!restoId) return
    const unsub = onSnapshot(doc(db, 'restaurantes', restoId, 'config', 'menu'), snap => {
      if (snap.exists()) setDeshabilitados(new Set(snap.data().deshabilitados || []))
    })
    return () => unsub()
  }, [restoId])

  // Helpers carrito
  const carritoKey = (itemId, varIdx) => `${itemId}__${varIdx}`

  const setQty = (itemId, varIdx, price, name, variantName, category, delta) => {
    const key = carritoKey(itemId, varIdx)
    setCarrito(prev => {
      const cur = prev[key]?.qty || 0
      const next = Math.max(0, cur + delta)
      const updated = { ...prev }
      if (next === 0) delete updated[key]
      else updated[key] = { qty:next, price, name, variantName, category, id:itemId }
      return updated
    })
  }

  const getQty = (itemId, varIdx) => carrito[carritoKey(itemId, varIdx)]?.qty || 0

  const totalItems = Object.values(carrito).reduce((a, v) => a + v.qty, 0)
  const totalCarrito = Object.values(carrito).reduce((a, v) => a + v.price * v.qty, 0)
  const totalPrice = totalCarrito + (parseFloat(extrasPrice) || 0)
  const canSend = totalItems > 0 || extras.trim()

  const enviar = async () => {
    if (!canSend || sending) return
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
      const soloBebidas = esSoloBebidas(itemsArr)
      const rtdbKey = await push(ref(rtdb, `${restoId}/pedidos_activos`), {
        mesa:        parseInt(mesa),
        items:       itemsArr,
        extras:      extras.trim(),
        extrasPrice: parseFloat(extrasPrice) || 0,
        status:      soloBebidas ? 'listo' : 'pending',
        soloBebidas,
        timeISO:     new Date().toISOString(),
      })

      // Sincronizar con Firestore para que el cliente vea el total en tiempo real
      try {
        const mesaDocRef = doc(db, 'restaurantes', restoId, 'mesas', String(mesa))
        const mesaSnap   = await getDoc(mesaDocRef)
        const mesaData   = mesaSnap.exists() ? mesaSnap.data() : {}

        let pedidoId = mesaData.pedidoActivoId || null

        if (!pedidoId) {
          // El cliente aún no escaneó: crear el doc de pedido y enlazarlo a la mesa
          pedidoId = `mesa${mesa}_${Date.now()}`
          const pedRef = doc(db, 'restaurantes', restoId, 'pedidos', pedidoId)
          await setDoc(pedRef, {
            restoId,
            mesa: parseInt(mesa),
            estado: 'activo',
            items: [...itemsArr],
            creadoEn: new Date().toISOString(),
          })
          await setDoc(mesaDocRef, {
            estado: 'ocupada',
            pedidoActivoId: pedidoId,
            desde: mesaData.desde || new Date().toISOString(),
          }, { merge: true })
        } else {
          // Ya existe el pedido: fusionar items
          const pedRef   = doc(db, 'restaurantes', restoId, 'pedidos', pedidoId)
          const pedSnap  = await getDoc(pedRef)
          const prevItems = pedSnap.exists() ? (pedSnap.data().items || []) : []
          const merged = [...prevItems]
          itemsArr.forEach(newItem => {
            const idx = merged.findIndex(i =>
              i.name === newItem.name && Number(i.price) === Number(newItem.price)
            )
            if (idx >= 0) merged[idx] = { ...merged[idx], qty: merged[idx].qty + newItem.qty }
            else merged.push(newItem)
          })
          await updateDoc(pedRef, { items: merged })
        }
      } catch (e) { console.error('Firestore sync error', e) }
      showToast(`✅ Pedido enviado — Mesa ${mesa}`)
      navigate('/mesas')
    } catch { showToast('Error al enviar', 'error') }
    setSending(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', paddingBottom:130,
      maxWidth:640, margin:'0 auto' }}>
      <div className="page-header">
        <button onClick={() => navigate('/mesas')}
          style={{ background:'none', border:'none', color:'var(--accent)',
            fontSize:26, cursor:'pointer', marginRight:12, lineHeight:1 }}>←</button>
        <span className="page-title">MESA {mesa}</span>
        <span style={{ fontFamily:'var(--mono)', fontSize:14, color:'var(--accent)', fontWeight:700 }}>
          S/ {totalPrice.toFixed(2)}
        </span>
      </div>

      {/* Buscador */}
      <div style={{ padding:'10px 16px 4px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8,
          background:'var(--card)', border:'1.5px solid var(--border)',
          borderRadius:12, padding:'10px 14px' }}>
          <span style={{ fontSize:16, color:'var(--muted)' }}>🔍</span>
          <input type="text" placeholder="Buscar plato..."
            value={buscar} onChange={e => setBuscar(e.target.value)}
            style={{ flex:1, background:'none', border:'none', color:'var(--text)',
              fontSize:15, outline:'none', fontFamily:'var(--font)' }} />
          {buscar && (
            <button onClick={() => setBuscar('')}
              style={{ background:'none', border:'none', color:'var(--muted)',
                fontSize:18, cursor:'pointer', padding:0, lineHeight:1 }}>✕</button>
          )}
        </div>
      </div>

      {!menu ? (
        <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>Cargando menú...</div>
      ) : (() => {
        const q = buscar.toLowerCase().trim()
        const menuFiltrado = Object.entries(menu).reduce((acc, [cat, items]) => {
          const catMatch = cat.toLowerCase().includes(q)
          const f = items.filter(i => !q || catMatch || i.name.toLowerCase().includes(q))
          if (f.length) acc[cat] = f
          return acc
        }, {})

        if (q && !Object.keys(menuFiltrado).length) return (
          <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
            Sin resultados para "<strong>{buscar}</strong>"
          </div>
        )

        return Object.entries(menuFiltrado).map(([cat, items]) => {
          // Si hay búsqueda activa, abrir todas. Si no, respetar estado manual
          const abierta = q ? true : (catsAbiertas[cat] !== false && catsAbiertas[cat] !== undefined
            ? catsAbiertas[cat]
            : false) // por defecto cerradas
          const totalEnCarrito = items.reduce((a, item) => {
            const tieneVariantes = item.variantes?.length > 0
            return a + (tieneVariantes
              ? item.variantes.reduce((b, _, vi) => b + getQty(item.id, vi), 0)
              : getQty(item.id, 0))
          }, 0)

          return (
          <div key={cat} style={{ marginBottom:6 }}>
            {/* Header acordeón */}
            <div onClick={() => setCatsAbiertas(prev => ({ ...prev, [cat]: !abierta }))}
              style={{
                margin:'6px 12px 0',
                background: abierta
                  ? 'linear-gradient(135deg, rgba(245,166,35,.18), rgba(245,166,35,.08))'
                  : 'linear-gradient(135deg, rgba(245,166,35,.08), rgba(245,166,35,.03))',
                border:`1.5px solid ${abierta ? 'rgba(245,166,35,.5)' : 'rgba(245,166,35,.2)'}`,
                borderRadius: abierta ? '14px 14px 0 0' : 14,
                padding:'13px 16px', cursor:'pointer',
                display:'flex', alignItems:'center', gap:10,
                transition:'all .2s', userSelect:'none' }}>
              <div style={{ width:4, height:28, background:'var(--accent)',
                borderRadius:4, flexShrink:0 }} />
              <div style={{ fontWeight:900, fontSize:18, color:'var(--accent)',
                letterSpacing:1, textTransform:'uppercase', flex:1 }}>{cat}</div>
              {totalEnCarrito > 0 && (
                <div style={{ background:'var(--accent)', color:'#111',
                  borderRadius:20, padding:'3px 10px',
                  fontSize:11, fontWeight:900 }}>
                  {totalEnCarrito} sel.
                </div>
              )}
              <div style={{ fontSize:13, color:'var(--accent)', fontWeight:800,
                transition:'transform .2s',
                transform: abierta ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</div>
            </div>

            {/* Items — solo si abierta */}
            {abierta && (
              <div style={{ margin:'0 12px', padding:'8px 8px 4px',
                background:'rgba(245,166,35,.04)',
                border:'1.5px solid rgba(245,166,35,.2)',
                borderTop:'none', borderRadius:'0 0 14px 14px' }}>
              {items.map(item => {
              const disabled     = deshabilitados.has(item.id)
              const tieneVariantes = item.variantes?.length > 0
              const totalItemQty = tieneVariantes
                ? item.variantes.reduce((a, _, i) => a + getQty(item.id, i), 0)
                : getQty(item.id, 0)
              const itemAbierto = itemsAbiertos[item.id] || false

              return (
                <div key={item.id} style={{
                  background: disabled ? 'rgba(255,255,255,.02)' : totalItemQty > 0 ? 'rgba(245,166,35,.06)' : 'var(--card)',
                  border:`1.5px solid ${disabled ? 'var(--border)' : totalItemQty > 0 ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius:14, marginBottom:8, overflow:'hidden',
                  opacity: disabled ? 0.5 : 1, transition:'all .15s' }}>

                  {/* Cabecera del item */}
                  <div onClick={() => tieneVariantes && !disabled &&
                      setItemsAbiertos(prev => ({ ...prev, [item.id]: !itemAbierto }))}
                    style={{ display:'flex', alignItems:'stretch',
                      cursor: tieneVariantes && !disabled ? 'pointer' : 'default' }}>
                    {item.fotoUrl ? (
                      <img src={item.fotoUrl} alt={item.name} loading="lazy"
                        style={{ width:72, objectFit:'cover', flexShrink:0,
                          filter: disabled ? 'grayscale(1)' : 'none' }} />
                    ) : (
                      <div style={{ width:72, minHeight:72, background:'var(--surface)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:26, flexShrink:0, color:'var(--border)' }}>🍽</div>
                    )}
                    <div style={{ flex:1, padding:'10px 12px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        <div style={{ fontWeight:700, fontSize:15,
                          textDecoration: disabled ? 'line-through' : 'none',
                          color: disabled ? 'var(--muted)' : 'var(--accent)' }}>{item.name}</div>
                        {disabled && (
                          <span style={{ background:'rgba(255,77,77,.15)', color:'#ff4d4d',
                            fontSize:9, fontWeight:800, padding:'2px 7px',
                            borderRadius:20, letterSpacing:1 }}>AGOTADO</span>
                        )}
                        {totalItemQty > 0 && (
                          <span style={{ background:'var(--accent)', color:'#111',
                            fontSize:10, fontWeight:800, padding:'2px 8px',
                            borderRadius:20 }}>{totalItemQty} en carrito</span>
                        )}
                        {tieneVariantes && !disabled && (
                          <span style={{ fontSize:11, color:'var(--muted)', marginLeft:'auto',
                            transition:'transform .2s',
                            transform: itemAbierto ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                        )}
                      </div>

                      {/* Precio simple */}
                      {!tieneVariantes && (
                        <div style={{ color: disabled ? 'var(--muted)' : 'var(--accent)',
                          fontWeight:800, fontSize:13, fontFamily:'var(--mono)', marginTop:2 }}>
                          S/ {Number(item.price).toFixed(2)}
                        </div>
                      )}
                      {tieneVariantes && !itemAbierto && (
                        <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                          {item.variantes.length} presentaciones · toca para ver
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Variantes o botones simples */}
                  {!disabled && (!tieneVariantes || itemAbierto) && (
                    <div style={{ borderTop: tieneVariantes ? '1px solid var(--border)' : 'none' }}>
                      {tieneVariantes ? (
                        item.variantes.map((v, vi) => {
                          const key = carritoKey(item.id, vi)
                          const varDisabled = deshabilitados.has(key)
                          const qty = getQty(item.id, vi)
                          return (
                            <div key={vi}>
                              <div style={{
                                display:'flex', alignItems:'center', justifyContent:'space-between',
                                padding:'8px 12px',
                                borderBottom: (vi < item.variantes.length-1 && !qty) ? '1px solid var(--border)' : 'none',
                                background: varDisabled ? 'rgba(255,255,255,.02)' : qty > 0 ? 'rgba(245,166,35,.04)' : 'none',
                                opacity: varDisabled ? 0.55 : 1 }}>
                                <div>
                                  <span style={{ fontWeight:700, fontSize:13,
                                    textDecoration: varDisabled ? 'line-through' : 'none',
                                    color: varDisabled ? 'var(--muted)' : 'var(--accent)' }}>{v.nombre}</span>
                                  <span style={{ fontFamily:'var(--mono)', fontSize:12,
                                    color: varDisabled ? 'var(--muted)' : 'var(--accent)', marginLeft:8, fontWeight:700 }}>
                                    S/{Number(v.precio).toFixed(2)}
                                  </span>
                                  {varDisabled && (
                                    <span style={{ background:'rgba(255,77,77,.15)', color:'#ff4d4d',
                                      fontSize:9, fontWeight:800, padding:'2px 7px',
                                      borderRadius:20, letterSpacing:1, marginLeft:8 }}>AGOTADO</span>
                                  )}
                                </div>
                                {!varDisabled && (
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                  <button onClick={() => setQty(item.id, vi, v.precio, item.name, v.nombre, item.category, -1)}
                                    style={{ width:30, height:30, borderRadius:'50%',
                                      background:'var(--surface)', border:'1.5px solid var(--border)',
                                      color:'var(--text)', fontSize:18, cursor:'pointer',
                                      display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>−</button>
                                  <span style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:15,
                                    color: qty > 0 ? 'var(--accent)' : 'var(--muted)',
                                    minWidth:18, textAlign:'center' }}>{qty}</span>
                                  <button onClick={() => setQty(item.id, vi, v.precio, item.name, v.nombre, item.category, 1)}
                                    style={{ width:30, height:30, borderRadius:'50%',
                                      background: qty > 0 ? 'var(--accent)' : 'var(--surface)',
                                      border:'1.5px solid var(--border)',
                                      color: qty > 0 ? '#111' : 'var(--text)',
                                      fontSize:18, cursor:'pointer',
                                      display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>+</button>
                                </div>
                                )}
                              </div>
                              {!varDisabled && qty > 0 && (
                                <div style={{ padding:'0 12px 8px',
                                  borderBottom: vi < item.variantes.length-1 ? '1px solid var(--border)' : 'none' }}>
                                  <input type="text"
                                    placeholder="✏️ Ej: sin cebolla, extra picante..."
                                    value={carrito[key]?.nota || ''}
                                    onChange={e => setNota(key, e.target.value)}
                                    style={{ width:'100%', background:'var(--surface)',
                                      border:'1px solid var(--border)', borderRadius:8,
                                      padding:'7px 10px', color:'var(--text)', fontSize:12,
                                      fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                                </div>
                              )}
                            </div>
                          )
                        })
                      ) : (
                        <div style={{ position:'absolute', top:0, right:0, bottom:0,
                          display:'flex', alignItems:'center', paddingRight:12 }}>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Botones plato simple + nota */}
                  {!disabled && !tieneVariantes && (
                    <>
                      <div style={{ display:'flex', alignItems:'center', gap:8,
                        justifyContent:'flex-end', padding:'0 12px 10px' }}>
                        <button onClick={() => setQty(item.id, 0, item.price, item.name, '', item.category, -1)}
                          style={{ width:32, height:32, borderRadius:'50%',
                            background:'var(--surface)', border:'1.5px solid var(--border)',
                            color:'var(--text)', fontSize:20, cursor:'pointer',
                            display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>−</button>
                        <span style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:16,
                          color: getQty(item.id,0) > 0 ? 'var(--accent)' : 'var(--muted)',
                          minWidth:20, textAlign:'center' }}>{getQty(item.id,0)}</span>
                        <button onClick={() => setQty(item.id, 0, item.price, item.name, '', item.category, 1)}
                          style={{ width:32, height:32, borderRadius:'50%',
                            background: getQty(item.id,0) > 0 ? 'var(--accent)' : 'var(--surface)',
                            border:'1.5px solid var(--border)',
                            color: getQty(item.id,0) > 0 ? '#111' : 'var(--text)',
                            fontSize:20, cursor:'pointer',
                            display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>+</button>
                      </div>
                      {getQty(item.id, 0) > 0 && (
                        <div style={{ padding:'0 12px 10px', borderTop:'1px solid var(--border)' }}>
                          <input type="text"
                            placeholder="✏️ Ej: sin cebolla, extra picante..."
                            value={carrito[carritoKey(item.id, 0)]?.nota || ''}
                            onChange={e => setNota(carritoKey(item.id, 0), e.target.value)}
                            style={{ width:'100%', background:'var(--surface)',
                              border:'1px solid var(--border)', borderRadius:8,
                              padding:'7px 10px', color:'var(--text)', fontSize:12,
                              fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            </div>
            )}
          </div>
          )
        })
      })()}

      {/* Adicionales */}
      <div style={{ padding:'12px 16px' }}>
        <div className="section-label">⭐ Adicionales / Notas especiales</div>
        <textarea className="input" value={extras}
          onChange={e => setExtras(e.target.value)}
          placeholder="Ej: sin cebolla, extra limón..."
          style={{ marginBottom: extras.trim() ? 10 : 0 }} />
        {extras.trim() && (
          <>
            <div className="section-label" style={{ marginTop:8 }}>
              💰 Precio adicional <span style={{ color:'var(--muted)', fontWeight:400, fontSize:10 }}>(opcional)</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:'12px 0 0 12px', padding:'12px 14px',
                color:'var(--accent)', fontWeight:800, fontFamily:'var(--mono)',
                fontSize:15, borderRight:'none' }}>S/</div>
              <input className="input" type="number" min="0" step="0.5"
                value={extrasPrice} onChange={e => setExtrasPrice(e.target.value)}
                placeholder="0.00 (dejar vacío si no aplica)"
                style={{ borderRadius:'0 12px 12px 0', flex:1 }} />
            </div>
            {extrasPrice && parseFloat(extrasPrice) > 0 && (
              <div style={{ fontSize:12, color:'var(--green)', marginTop:6, fontWeight:700 }}>
                ✅ Se sumará S/{parseFloat(extrasPrice).toFixed(2)} al total
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)',
        width:'100%', maxWidth:640,
        background:'var(--surface)', borderTop:'1px solid var(--border)',
        padding:'12px 16px 20px' }}>
        {canSend && (
          <div style={{ textAlign:'center', fontSize:12, color:'var(--muted)', marginBottom:8, letterSpacing:1 }}>
            {totalItems > 0 && <span style={{ color:'var(--accent)', fontWeight:800 }}>{totalItems} item(s)</span>}
            <span style={{ color:'var(--accent)', fontFamily:'var(--mono)' }}> · S/ {totalPrice.toFixed(2)}</span>
            {extras && <span> · con adicionales</span>}
          </div>
        )}
        <button className="btn btn-primary"
          style={{ width:'100%', fontSize:16, letterSpacing:2, padding:16 }}
          disabled={!canSend || sending} onClick={() => setShowConfirm(true)}>
          📋 VER RESUMEN Y CONFIRMAR
        </button>
      </div>

      {/* Modal confirmación */}
      {showConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)',
          zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={() => setShowConfirm(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'var(--surface)', borderRadius:'20px 20px 0 0',
              width:'100%', maxWidth:480, maxHeight:'85vh',
              display:'flex', flexDirection:'column',
              borderTop:'2px solid var(--border)' }}>

            {/* Header fijo */}
            <div style={{ textAlign:'center', padding:'20px 20px 12px', flexShrink:0 }}>
              <div style={{ fontSize:30, marginBottom:6 }}>📋</div>
              <div style={{ fontWeight:900, fontSize:18, letterSpacing:2,
                color:'var(--accent)', textTransform:'uppercase' }}>Confirmar Pedido</div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>Mesa {mesa}</div>
            </div>

            {/* Items — scrolleable */}
            <div style={{ overflowY:'auto', flex:1, padding:'0 20px' }}>
              {Object.values(carrito).map((v, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'flex-start', padding:'10px 0',
                  borderBottom:'1px solid var(--border)' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <span style={{ background:'var(--accent)', color:'#111',
                        fontWeight:900, fontSize:11, width:24, height:24, borderRadius:'50%',
                        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        ×{v.qty}
                      </span>
                      <span style={{ fontWeight:700, fontSize:14 }}>
                        {v.variantName ? `${v.name} (${v.variantName})` : v.name}
                      </span>
                    </div>
                    {v.nota && (
                      <div style={{ fontSize:11, color:'var(--yellow)', marginTop:4, marginLeft:32,
                        background:'rgba(245,200,66,.08)', borderRadius:6,
                        padding:'2px 8px', display:'inline-block' }}>
                        ✏️ {v.nota}
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily:'var(--mono)', fontWeight:800,
                    color:'var(--accent)', fontSize:14, marginLeft:12, flexShrink:0 }}>
                    S/{(v.price * v.qty).toFixed(2)}
                  </div>
                </div>
              ))}
              {extras.trim() && (
                <div style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', padding:'10px 0',
                  borderBottom:'1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:'var(--yellow)' }}>⭐ {extras}</div>
                    {parseFloat(extrasPrice) > 0 && (
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>Precio adicional</div>
                    )}
                  </div>
                  {parseFloat(extrasPrice) > 0 && (
                    <div style={{ fontFamily:'var(--mono)', fontWeight:800,
                      color:'var(--accent)', fontSize:14 }}>
                      S/{parseFloat(extrasPrice).toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Total + botones — fijos abajo */}
            <div style={{ padding:'16px 20px 28px', flexShrink:0,
              borderTop:'1px solid var(--border)', background:'var(--surface)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'12px 16px', background:'rgba(245,166,35,.08)', borderRadius:14,
                border:'1.5px solid rgba(245,166,35,.3)', marginBottom:14 }}>
                <span style={{ fontWeight:900, fontSize:16, letterSpacing:1 }}>TOTAL</span>
                <span style={{ fontFamily:'var(--mono)', fontWeight:900,
                  fontSize:22, color:'var(--accent)' }}>S/{totalPrice.toFixed(2)}</span>
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => setShowConfirm(false)}
                  style={{ flex:1, padding:14, borderRadius:14, border:'1.5px solid var(--border)',
                    background:'var(--card)', color:'var(--muted)', fontWeight:800,
                    fontSize:14, cursor:'pointer', fontFamily:'var(--font)' }}>
                  ✏️ Editar
                </button>
                <button onClick={() => { setShowConfirm(false); enviar() }}
                  disabled={sending}
                  style={{ flex:2, padding:14, borderRadius:14, border:'none',
                    background:'var(--accent)', color:'#111', fontWeight:900,
                    fontSize:15, cursor:'pointer', letterSpacing:1, fontFamily:'var(--font)' }}>
                  {sending ? 'ENVIANDO...' : '🍳 CONFIRMAR Y ENVIAR'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
