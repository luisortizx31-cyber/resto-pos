import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, rtdb } from '../lib/firebase'
import { collection, getDocs, doc, onSnapshot } from 'firebase/firestore'
import { ref, push } from 'firebase/database'
import { useToast, useSession } from '../components/Layout'
import { esSoloBebidas } from '../lib/utils'

const DEFAULT_MENU = {}

export default function Pedido() {
  const session = useSession()
  const restoId = session?.restoId
  const { mesa } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [menu, setMenu]               = useState(null)
  const [carrito, setCarrito]         = useState({})
  const [extras, setExtras]           = useState('')
  const [extrasPrice, setExtrasPrice] = useState('')
  const [sending, setSending]         = useState(false)
  const [buscar, setBuscar]           = useState('')         // ← BUSCADOR
  const [deshabilitados, setDeshabilitados] = useState(new Set()) // ← PLATOS DESHABILITADOS

  useEffect(() => {
    async function loadMenu() {
      try {
        const snap = await getDocs(collection(db, 'restaurantes', restoId, 'menu'))
        if (snap.empty) { setMenu(DEFAULT_MENU); return }
        const byCategory = {}
        snap.forEach(doc => {
          const d = doc.data()
          if (!byCategory[d.category]) byCategory[d.category] = []
          byCategory[d.category].push({ id:doc.id, name:d.name, price:d.price, category:d.category })
        })
        setMenu(Object.keys(byCategory).length ? byCategory : DEFAULT_MENU)
      } catch { setMenu(DEFAULT_MENU) }
    }
    loadMenu()
  }, [])

  // Escuchar platos deshabilitados en tiempo real
  useEffect(() => {
    if (!restoId) return
    const unsub = onSnapshot(doc(db, 'restaurantes', restoId, 'config', 'menu'), snap => {
      if (snap.exists()) {
        setDeshabilitados(new Set(snap.data().deshabilitados || []))
      }
    })
    return () => unsub()
  }, [restoId])

  const setQty = (id, delta) => {
    setCarrito(prev => {
      const next = Math.max(0, (prev[id] || 0) + delta)
      const updated = { ...prev }
      if (next === 0) delete updated[id]
      else updated[id] = next
      return updated
    })
  }

  const totalItems = Object.values(carrito).reduce((a,b) => a+b, 0)

  const totalPrice = (() => {
    let t = 0
    if (menu) {
      Object.entries(carrito).forEach(([id, qty]) => {
        for (const items of Object.values(menu)) {
          const item = items.find(i => i.id === id)
          if (item) { t += item.price * qty; break }
        }
      })
    }
    if (extrasPrice) t += parseFloat(extrasPrice) || 0
    return t
  })()

  const canSend = totalItems > 0 || extras.trim()

  const enviar = async () => {
    if (!canSend || sending) return
    setSending(true)
    try {
      // Build items array preserving correct qty
      const itemsArr = []
      if (menu) {
        Object.entries(carrito).forEach(([id, qty]) => {
          for (const items of Object.values(menu)) {
            const item = items.find(i => i.id === id)
            if (item) {
              itemsArr.push({ id: item.id, name: item.name, price: item.price, qty, category: item.category || '' })
              break
            }
          }
        })
      }
      const BEBIDAS = ['bebidas', 'bebida', 'drinks', 'drink']
      const soloBebidas = esSoloBebidas(itemsArr)
      await push(ref(rtdb, `${restoId}/pedidos_activos`), {
        mesa: parseInt(mesa),
        items: itemsArr,
        extras: extras.trim(),
        extrasPrice: parseFloat(extrasPrice) || 0,
        status: soloBebidas ? 'listo' : 'pending',
        soloBebidas,
        timeISO: new Date().toISOString(),
      })
      showToast(`✅ Pedido enviado — Mesa ${mesa}`)
      navigate('/mesas')
    } catch {
      showToast('Error al enviar', 'error')
    }
    setSending(false)
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', paddingBottom:130 }}>
      <div className="page-header">
        <button onClick={() => navigate('/mesas')}
          style={{ background:'none', border:'none', color:'var(--accent)',
            fontSize:26, cursor:'pointer', marginRight:12, lineHeight:1 }}>←</button>
        <span className="page-title">MESA {mesa}</span>
        <span style={{ fontFamily:'var(--mono)', fontSize:14, color:'var(--accent)', fontWeight:700 }}>
          S/ {totalPrice.toFixed(2)}
        </span>
      </div>

      {/* BUSCADOR */}
      <div style={{ padding:'10px 16px 4px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8,
          background:'var(--card)', border:'1.5px solid var(--border)',
          borderRadius:12, padding:'10px 14px' }}>
          <span style={{ fontSize:16, color:'var(--muted)' }}>🔍</span>
          <input
            type="text" placeholder="Buscar plato..."
            value={buscar} onChange={e => setBuscar(e.target.value)}
            style={{ flex:1, background:'none', border:'none', color:'var(--text)',
              fontSize:15, outline:'none', fontFamily:'var(--font)' }}
          />
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
        // Filtrar por búsqueda
        const query = buscar.toLowerCase().trim()
        const menuFiltrado = Object.entries(menu).reduce((acc, [cat, items]) => {
          const filtrados = items.filter(i =>
            !query || i.name.toLowerCase().includes(query)
          )
          if (filtrados.length > 0) acc[cat] = filtrados
          return acc
        }, {})

        if (query && Object.keys(menuFiltrado).length === 0) {
          return (
            <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
              <div>Sin resultados para "<strong>{buscar}</strong>"</div>
            </div>
          )
        }

        return Object.entries(menuFiltrado).map(([cat, items]) => (
          <div key={cat} style={{ padding:'16px 16px 4px' }}>
            <div className="section-label">{cat}</div>
            {items.map(item => {
              const qty = carrito[item.id] || 0
              const disabled = deshabilitados.has(item.id)
              return (
                <div key={item.id} style={{
                  background: disabled ? 'rgba(255,255,255,.03)' : qty>0 ? 'rgba(245,166,35,.08)' : 'var(--card)',
                  border: `1.5px solid ${disabled ? 'var(--border)' : qty>0 ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius:14, padding:'12px 14px', marginBottom:8,
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  opacity: disabled ? 0.5 : 1,
                  transition:'all .15s' }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ fontWeight:700, fontSize:15,
                        textDecoration: disabled ? 'line-through' : 'none',
                        color: disabled ? 'var(--muted)' : 'var(--text)' }}>{item.name}</div>
                      {disabled && (
                        <span style={{ background:'rgba(255,77,77,.15)', color:'var(--red)',
                          fontSize:9, fontWeight:800, padding:'2px 7px',
                          borderRadius:20, letterSpacing:1 }}>AGOTADO</span>
                      )}
                    </div>
                    <div style={{ color: disabled ? 'var(--muted)' : 'var(--accent)',
                      fontWeight:800, fontSize:13, fontFamily:'var(--mono)', marginTop:2 }}>
                      S/ {item.price.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <button onClick={() => !disabled && setQty(item.id,-1)}
                      disabled={disabled}
                      style={{ width:32, height:32, borderRadius:'50%',
                        background:'var(--surface)', border:'1.5px solid var(--border)',
                        color:'var(--text)', fontSize:20, cursor: disabled ? 'not-allowed' : 'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>−</button>
                    <span style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:16,
                      color: qty>0 ? 'var(--accent)' : 'var(--muted)',
                      minWidth:20, textAlign:'center' }}>{qty}</span>
                    <button onClick={() => !disabled && setQty(item.id,1)}
                      disabled={disabled}
                      style={{ width:32, height:32, borderRadius:'50%',
                        background: disabled ? 'var(--border)' : qty>0 ? 'var(--accent)' : 'var(--surface)',
                        border:'1.5px solid var(--border)',
                        color: disabled ? 'var(--muted)' : qty>0 ? '#111' : 'var(--text)',
                        fontSize:20, cursor: disabled ? 'not-allowed' : 'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>+</button>
                  </div>
                </div>
              )
            })}
          </div>
        ))
      })()}

      {/* Adicionales */}
      <div style={{ padding:'12px 16px' }}>
        <div className="section-label">⭐ Adicionales / Notas especiales</div>
        <textarea className="input" value={extras}
          onChange={e => setExtras(e.target.value)}
          placeholder="Ej: sin cebolla, extra limón, mesa especial..."
          style={{ marginBottom: extras.trim() ? 10 : 0 }} />

        {/* Precio del adicional — solo si escribió algo */}
        {extras.trim() && (
          <>
            <div className="section-label" style={{ marginTop:8 }}>
              💰 Precio adicional <span style={{ color:'var(--muted)', fontWeight:400,
                fontSize:10, letterSpacing:0 }}>(opcional)</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:'12px 0 0 12px', padding:'12px 14px',
                color:'var(--accent)', fontWeight:800, fontFamily:'var(--mono)',
                fontSize:15, borderRight:'none' }}>S/</div>
              <input className="input" type="number" min="0" step="0.5"
                value={extrasPrice}
                onChange={e => setExtrasPrice(e.target.value)}
                placeholder="0.00 (dejar vacío si no aplica)"
                style={{ borderRadius:'0 12px 12px 0', flex:1 }} />
            </div>
            {extrasPrice && parseFloat(extrasPrice) > 0 && (
              <div style={{ fontSize:12, color:'var(--green)', marginTop:6, fontWeight:700 }}>
                ✅ Se sumará S/{parseFloat(extrasPrice).toFixed(2)} al total del pedido
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0,
        background:'var(--surface)', borderTop:'1px solid var(--border)',
        padding:'12px 16px 20px' }}>
        {canSend && (
          <div style={{ textAlign:'center', fontSize:12, color:'var(--muted)',
            marginBottom:8, letterSpacing:1 }}>
            {totalItems > 0 && <span style={{ color:'var(--accent)', fontWeight:800 }}>{totalItems} plato(s)</span>}
            <span style={{ color:'var(--accent)', fontFamily:'var(--mono)' }}> · S/ {totalPrice.toFixed(2)}</span>
            {extras && <span> · con adicionales</span>}
          </div>
        )}
        <button className="btn btn-primary"
          style={{ width:'100%', fontSize:16, letterSpacing:2, padding:16 }}
          disabled={!canSend || sending} onClick={enviar}>
          {sending ? 'ENVIANDO...' : '🍳 ENVIAR A COCINA'}
        </button>
      </div>
    </div>
  )
}
