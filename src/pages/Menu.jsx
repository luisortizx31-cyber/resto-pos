import { useEffect, useState, useRef } from 'react'
import { db } from '../lib/firebase'
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore'
import { useToast, useSession } from '../components/Layout'
import { subirFotoMenu } from '../lib/imagen'

const DEFAULT_CATEGORIES = ['Ceviches', 'Combinados', 'Bebidas', 'Guarniciones', 'Entradas', 'Postres', 'Otros']
const EMPTY_FORM = { name:'', category:'', fotoUrl:'', tieneVariantes: false, price:'', variantes:[{nombre:'',precio:''}] }

export default function Menu() {
  const session  = useSession()
  const restoId  = session?.restoId
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [editId, setEditId]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [activeTab, setActiveTab] = useState('lista')
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [nuevaCat, setNuevaCat] = useState('')
  const [catsAbiertas, setCatsAbiertas] = useState({})
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const fileInputRef = useRef(null)

  const handleFotoFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permitir volver a elegir el mismo archivo después
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Elige un archivo de imagen', 'error'); return }
    setSubiendoFoto(true)
    try {
      const url = await subirFotoMenu(restoId, editId, file)
      setForm(f => ({ ...f, fotoUrl: url }))
      showToast('✅ Foto subida')
    } catch (e) {
      console.error(e)
      showToast('Error al subir la foto', 'error')
    }
    setSubiendoFoto(false)
  }
  const [tabMenu, setTabMenu]   = useState('platos')
  const [deshabilitados, setDeshabilitados] = useState(new Set())
  const showToast = useToast()

  // ── Categorías ──────────────────────────────────────────────────
  const loadCategories = async () => {
    try {
      const snap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'))
      if (snap.exists() && snap.data().lista?.length) return snap.data().lista
    } catch {}
    return DEFAULT_CATEGORIES
  }
  const saveCategories = async (lista) => {
    await setDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'), { lista })
  }
  const moverCategoria = async (idx, dir) => {
    const nueva = [...categories]
    const destino = idx + dir
    if (destino < 0 || destino >= nueva.length) return
    ;[nueva[idx], nueva[destino]] = [nueva[destino], nueva[idx]]
    setCategories(nueva)
    await saveCategories(nueva)
  }
  const agregarCategoria = async () => {
    const nombre = nuevaCat.trim()
    if (!nombre) { showToast('Escribe un nombre', 'error'); return }
    if (categories.includes(nombre)) { showToast('Ya existe esa categoría', 'error'); return }
    const nueva = [...categories, nombre]
    setCategories(nueva)
    await saveCategories(nueva)
    setNuevaCat('')
    showToast(`✅ Categoría "${nombre}" agregada`)
  }
  const eliminarCategoria = async (cat) => {
    const enUso = items.some(i => i.category === cat)
    if (enUso) {
      if (!confirm(`La categoría "${cat}" tiene platos. ¿Eliminar igual?`)) return
    } else {
      if (!confirm(`¿Eliminar la categoría "${cat}"?`)) return
    }
    const nueva = categories.filter(c => c !== cat)
    setCategories(nueva)
    await saveCategories(nueva)
  }

  // ── Platos ──────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'restaurantes', restoId, 'menu'))
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch { showToast('Error cargando menú', 'error') }
    setLoading(false)
  }

  useEffect(() => {
    loadCategories().then(cats => {
      setCategories(cats)
      setForm(f => ({ ...f, category: cats[0] || '' }))
    })
    load()
    // Platos deshabilitados
    getDoc(doc(db, 'restaurantes', restoId, 'config', 'menu')).then(snap => {
      if (snap.exists()) setDeshabilitados(new Set(snap.data().deshabilitados || []))
    })
  }, [])

  const toggleDeshabilitar = async (itemId) => {
    const nuevo = new Set(deshabilitados)
    if (nuevo.has(itemId)) nuevo.delete(itemId)
    else nuevo.add(itemId)
    setDeshabilitados(nuevo)
    await setDoc(doc(db, 'restaurantes', restoId, 'config', 'menu'),
      { deshabilitados: [...nuevo] }, { merge: true })
    showToast(nuevo.has(itemId) ? '🚫 Plato deshabilitado' : '✅ Plato habilitado')
  }

  // ── Guardar plato ────────────────────────────────────────────────
  const save = async () => {
    if (!form.name.trim()) { showToast('Escribe el nombre', 'error'); return }
    if (form.tieneVariantes) {
      const validas = form.variantes.filter(v => v.nombre.trim() && v.precio)
      if (validas.length < 1) { showToast('Agrega al menos una presentación', 'error'); return }
    } else {
      if (!form.price) { showToast('Escribe el precio', 'error'); return }
    }
    setSaving(true)
    try {
      const data = {
        name:     form.name.trim(),
        category: form.category,
        fotoUrl:  form.fotoUrl.trim() || null,
      }
      if (form.tieneVariantes) {
        data.variantes = form.variantes
          .filter(v => v.nombre.trim() && v.precio)
          .map(v => ({ nombre: v.nombre.trim(), precio: parseFloat(v.precio) }))
        data.price = data.variantes[0].precio  // precio base = primera variante
      } else {
        data.price    = parseFloat(form.price)
        data.variantes = null
      }

      if (editId) {
        await updateDoc(doc(db, 'restaurantes', restoId, 'menu', editId), data)
        showToast('✅ Plato actualizado')
      } else {
        await addDoc(collection(db, 'restaurantes', restoId, 'menu'), data)
        showToast('✅ Plato agregado')
      }
      setForm({ ...EMPTY_FORM, category: categories[0] || '' })
      setEditId(null)
      setActiveTab('lista')
      load()
    } catch (e) {
      console.error(e)
      showToast('Error al guardar', 'error')
    }
    setSaving(false)
  }

  const del = async (id, name) => {
    if (!confirm(`¿Eliminar "${name}"?`)) return
    try {
      await deleteDoc(doc(db, 'restaurantes', restoId, 'menu', id))
      showToast('🗑 Eliminado')
      load()
    } catch { showToast('Error al eliminar', 'error') }
  }

  const startEdit = (item) => {
    setForm({
      name:          item.name,
      category:      item.category,
      fotoUrl:       item.fotoUrl || '',
      tieneVariantes: !!(item.variantes?.length),
      price:         item.variantes?.length ? '' : String(item.price),
      variantes:     item.variantes?.length
        ? item.variantes.map(v => ({ nombre: v.nombre, precio: String(v.precio) }))
        : [{ nombre:'', precio:'' }],
    })
    setEditId(item.id)
    setActiveTab('form')
    setTabMenu('platos')
  }

  const addVariante    = () => setForm(f => ({ ...f, variantes: [...f.variantes, { nombre:'', precio:'' }] }))
  const removeVariante = (i) => setForm(f => ({ ...f, variantes: f.variantes.filter((_,j) => j!==i) }))
  const setVariante    = (i, field, val) => setForm(f => {
    const v = f.variantes.map((x,j) => j===i ? { ...x, [field]: val } : x)
    return { ...f, variantes: v }
  })

  const byCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  // Iterar en el orden guardado en Firestore, con categorías sin orden al final
  const categoriesOrdenadas = [
    ...categories.filter(c => byCategory[c]),
    ...Object.keys(byCategory).filter(c => !categories.includes(c)),
  ]

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">MENÚ</span>
        <button className="btn btn-ghost" style={{ padding:'8px 14px', fontSize:13 }}
          onClick={() => {
            setEditId(null)
            setForm({ ...EMPTY_FORM, category: categories[0]||'' })
            setActiveTab('form'); setTabMenu('platos')
          }}>+ Agregar</button>
      </div>

      <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
        {[['platos','🍽 Platos'],['categorias','🏷 Categorías']].map(([t,l]) => (
          <button key={t} onClick={() => setTabMenu(t)} style={{
            flex:1, padding:'13px 0', background:'none', border:'none',
            borderBottom: tabMenu===t ? '2px solid var(--accent)' : '2px solid transparent',
            color: tabMenu===t ? 'var(--accent)' : 'var(--muted)',
            fontFamily:'var(--font)', fontWeight:700, fontSize:14,
            cursor:'pointer', letterSpacing:1 }}>{l}</button>
        ))}
      </div>

      {/* ── PLATOS ── */}
      {tabMenu === 'platos' && (<>
        <div style={{ display:'flex', gap:8, padding:'10px 16px',
          background:'var(--surface)', borderBottom:'1px solid var(--border)' }}>
          {[['lista','Lista'],['form', editId ? 'Editar' : 'Nuevo']].map(([t,l]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              flex:1, padding:'8px 0', borderRadius:20,
              background: activeTab===t ? 'var(--accent)' : 'var(--card)',
              border:`1px solid ${activeTab===t ? 'var(--accent)' : 'var(--border)'}`,
              color: activeTab===t ? '#111' : 'var(--muted)',
              fontFamily:'var(--font)', fontWeight:700, fontSize:12, letterSpacing:1,
              cursor:'pointer' }}>{l}</button>
          ))}
        </div>

        {activeTab === 'lista' && (
          <div style={{ padding:'16px' }}>
            {loading ? (
              <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Cargando...</div>
            ) : items.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Sin platos aún</div>
            ) : categoriesOrdenadas.map(cat => {
              const abierta = catsAbiertas[cat] || false
              const catItems = byCategory[cat] || []
              return (
              <div key={cat} style={{ marginBottom:12 }}>
                <div onClick={() => setCatsAbiertas(prev => ({ ...prev, [cat]: !abierta }))}
                  style={{
                    background: abierta
                      ? 'linear-gradient(135deg, rgba(245,166,35,.15), rgba(245,166,35,.06))'
                      : 'linear-gradient(135deg, rgba(245,166,35,.07), rgba(245,166,35,.02))',
                    border:`1.5px solid ${abierta ? 'rgba(245,166,35,.5)' : 'rgba(245,166,35,.2)'}`,
                    borderRadius: abierta ? '14px 14px 0 0' : 14,
                    padding:'12px 16px', cursor:'pointer',
                    display:'flex', alignItems:'center', gap:10, userSelect:'none' }}>
                  <div style={{ width:4, height:22, background:'var(--accent)', borderRadius:4, flexShrink:0 }} />
                  <div className="section-label" style={{ margin:0, flex:1, color:'var(--accent)', fontSize:13 }}>{cat}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>{catItems.length} plato{catItems.length!==1?'s':''}</div>
                  <div style={{ fontSize:12, color:'var(--accent)', fontWeight:800,
                    transition:'transform .2s', transform: abierta ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</div>
                </div>
                {abierta && (
                <div style={{ padding:'10px 8px 2px', background:'rgba(245,166,35,.03)',
                  border:'1.5px solid rgba(245,166,35,.2)', borderTop:'none', borderRadius:'0 0 14px 14px' }}>
                {catItems.map(item => {
                  const disabled = deshabilitados.has(item.id)
                  const tieneVariantes = item.variantes?.length > 0
                  return (
                    <div key={item.id} style={{
                      background: disabled ? 'rgba(255,255,255,.02)' : 'var(--card)',
                      border:`1.5px solid ${disabled ? 'rgba(255,77,77,.3)' : 'var(--border)'}`,
                      borderRadius:14, marginBottom:8, overflow:'hidden',
                      display:'flex', alignItems:'stretch',
                      opacity: disabled ? 0.7 : 1, transition:'all .2s' }}>
                      {item.fotoUrl ? (
                        <img src={item.fotoUrl} alt={item.name}
                          style={{ width:72, objectFit:'cover', flexShrink:0,
                            filter: disabled ? 'grayscale(1)' : 'none' }}
                          loading="lazy" />
                      ) : (
                        <div style={{ width:72, background:'var(--surface)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:26, flexShrink:0, color:'var(--border)' }}>🍽</div>
                      )}
                      <div style={{ flex:1, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'flex-start',
                          justifyContent:'space-between', gap:8 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                              <div style={{ fontWeight:700, fontSize:14,
                                textDecoration: disabled ? 'line-through' : 'none',
                                color: disabled ? 'var(--muted)' : 'var(--text)' }}>{item.name}</div>
                              {disabled && (
                                <span style={{ background:'rgba(255,77,77,.15)', color:'#ff4d4d',
                                  fontSize:9, fontWeight:800, padding:'2px 7px',
                                  borderRadius:20, letterSpacing:1 }}>AGOTADO</span>
                              )}
                            </div>
                            {/* Precios */}
                            {tieneVariantes ? (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:6 }}>
                                {item.variantes.map((v,i) => {
                                  const varKey = `${item.id}__${i}`
                                  const varDisabled = deshabilitados.has(varKey)
                                  return (
                                    <span key={i} onClick={() => toggleDeshabilitar(varKey)}
                                      title={varDisabled ? 'Habilitar presentación' : 'Marcar presentación agotada'}
                                      style={{
                                        background: varDisabled ? 'rgba(255,77,77,.1)' : 'rgba(245,166,35,.12)',
                                        border: `1px solid ${varDisabled ? 'rgba(255,77,77,.35)' : 'rgba(245,166,35,.3)'}`,
                                        borderRadius:20, padding:'3px 9px', cursor:'pointer',
                                        fontSize:11, fontWeight:700,
                                        color: varDisabled ? '#ff4d4d' : 'var(--accent)',
                                        textDecoration: varDisabled ? 'line-through' : 'none',
                                        fontFamily:'var(--mono)', whiteSpace:'nowrap' }}>
                                      {varDisabled ? '🚫 ' : ''}{v.nombre} · S/{Number(v.precio).toFixed(2)}
                                    </span>
                                  )
                                })}
                              </div>
                            ) : (
                              <div style={{ color: disabled ? 'var(--muted)' : 'var(--accent)',
                                fontFamily:'var(--mono)', fontWeight:700, fontSize:13, marginTop:4 }}>
                                S/ {Number(item.price).toFixed(2)}
                              </div>
                            )}
                          </div>
                          <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                            <button onClick={() => toggleDeshabilitar(item.id)}
                              title={disabled ? 'Habilitar' : 'Marcar agotado'}
                              style={{ padding:'6px 9px', fontSize:13, borderRadius:10, border:'none',
                                cursor:'pointer', fontWeight:700,
                                background: disabled ? 'rgba(39,201,122,.15)' : 'rgba(255,77,77,.12)',
                                color: disabled ? 'var(--green)' : '#ff4d4d' }}>
                              {disabled ? '✅' : '🚫'}
                            </button>
                            <button className="btn btn-ghost" style={{ padding:'6px 9px', fontSize:13 }}
                              onClick={() => startEdit(item)}>✏️</button>
                            <button className="btn btn-danger" style={{ padding:'6px 9px', fontSize:13 }}
                              onClick={() => del(item.id, item.name)}>🗑</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                </div>
                )}
              </div>
              )
            })}
          </div>
        )}

        {activeTab === 'form' && (
          <div style={{ padding:'20px 16px' }}>
            {/* Foto */}
            <div style={{ marginBottom:16 }}>
              <div className="section-label">Foto (opcional)</div>
              {form.fotoUrl && (
                <img src={form.fotoUrl} alt="preview"
                  style={{ width:120, height:120, objectFit:'cover',
                    borderRadius:14, border:'2px solid var(--accent)',
                    display:'block', marginBottom:10 }}
                  onError={e => e.target.style.display='none'} />
              )}
              <input ref={fileInputRef} type="file" accept="image/*"
                onChange={handleFotoFile} style={{ display:'none' }} />
              <button type="button" className="btn btn-primary"
                style={{ width:'100%', padding:13, fontSize:13, marginBottom:10 }}
                disabled={subiendoFoto}
                onClick={() => fileInputRef.current?.click()}>
                {subiendoFoto ? '⏳ SUBIENDO...' : '📷 SUBIR FOTO'}
              </button>
              <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>
                Se comprime automáticamente al subirla — o pega una URL manual:
              </div>
              <input className="input" placeholder="https://ejemplo.com/imagen.jpg"
                value={form.fotoUrl}
                onChange={e => setForm(f => ({ ...f, fotoUrl: e.target.value }))} />
            </div>

            {/* Nombre */}
            <div style={{ marginBottom:16 }}>
              <div className="section-label">Nombre del plato</div>
              <input className="input" placeholder="Ej: Ceviche Mixto"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            {/* Switch variantes */}
            <div style={{ marginBottom:16 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:12, padding:'12px 16px' }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>Múltiples presentaciones</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                    Ej: Plato / Fuente · Pequeño / Grande
                  </div>
                </div>
                <div onClick={() => setForm(f => ({ ...f, tieneVariantes: !f.tieneVariantes }))}
                  style={{ width:48, height:26, borderRadius:13, cursor:'pointer', flexShrink:0,
                    background: form.tieneVariantes ? 'var(--accent)' : 'var(--border)',
                    position:'relative', transition:'background .2s' }}>
                  <div style={{ position:'absolute', top:3,
                    left: form.tieneVariantes ? 25 : 3,
                    width:20, height:20, borderRadius:'50%',
                    background:'white', transition:'left .2s' }} />
                </div>
              </div>
            </div>

            {/* Precio simple o variantes */}
            {!form.tieneVariantes ? (
              <div style={{ marginBottom:16 }}>
                <div className="section-label">Precio (S/)</div>
                <input className="input" type="number" placeholder="Ej: 25"
                  value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  min="0" step="0.5" />
              </div>
            ) : (
              <div style={{ marginBottom:16 }}>
                <div className="section-label">Presentaciones y precios</div>
                {form.variantes.map((v, i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
                    <input className="input" placeholder="Ej: Plato"
                      value={v.nombre}
                      onChange={e => setVariante(i, 'nombre', e.target.value)}
                      style={{ flex:2, marginBottom:0 }} />
                    <div style={{ display:'flex', alignItems:'center', flex:1,
                      background:'var(--card)', border:'1.5px solid var(--border)',
                      borderRadius:12, overflow:'hidden' }}>
                      <span style={{ padding:'0 8px', color:'var(--accent)',
                        fontWeight:800, fontFamily:'var(--mono)', fontSize:13 }}>S/</span>
                      <input type="number" placeholder="0.00" min="0" step="0.5"
                        value={v.precio}
                        onChange={e => setVariante(i, 'precio', e.target.value)}
                        style={{ flex:1, background:'none', border:'none', color:'var(--text)',
                          padding:'12px 8px 12px 0', fontSize:14,
                          fontFamily:'var(--font)', outline:'none' }} />
                    </div>
                    {form.variantes.length > 1 && (
                      <button onClick={() => removeVariante(i)}
                        style={{ background:'rgba(255,77,77,.12)', border:'none',
                          color:'#ff4d4d', borderRadius:10, padding:'10px 12px',
                          cursor:'pointer', fontSize:16, flexShrink:0 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={addVariante}
                  style={{ width:'100%', background:'rgba(245,166,35,.08)',
                    border:'1.5px dashed rgba(245,166,35,.4)', borderRadius:12,
                    color:'var(--accent)', padding:'10px 0', fontSize:13,
                    fontWeight:700, cursor:'pointer', marginTop:4 }}>
                  + Agregar presentación
                </button>
              </div>
            )}

            {/* Categoría */}
            <div style={{ marginBottom:24 }}>
              <div className="section-label">Categoría</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {categories.map(cat => (
                  <button key={cat} onClick={() => setForm(f => ({ ...f, category: cat }))} style={{
                    background: form.category===cat ? 'var(--accent)' : 'var(--card)',
                    border:`1.5px solid ${form.category===cat ? 'var(--accent)' : 'var(--border)'}`,
                    color: form.category===cat ? '#111' : 'var(--muted2)',
                    borderRadius:20, padding:'7px 14px', fontSize:13,
                    fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>{cat}</button>
                ))}
              </div>
            </div>

            <button className="btn btn-primary"
              style={{ width:'100%', fontSize:16, letterSpacing:2, padding:16 }}
              disabled={saving} onClick={save}>
              {saving ? 'GUARDANDO...' : editId ? '💾 ACTUALIZAR PLATO' : '➕ AGREGAR AL MENÚ'}
            </button>
            {editId && (
              <button className="btn btn-ghost" style={{ width:'100%', marginTop:10, padding:14 }}
                onClick={() => {
                  setForm({ ...EMPTY_FORM, category: categories[0]||'' })
                  setEditId(null); setActiveTab('lista')
                }}>Cancelar</button>
            )}
          </div>
        )}
      </>)}

      {/* ── CATEGORÍAS ── */}
      {tabMenu === 'categorias' && (
        <div style={{ padding:'16px' }}>
          <div style={{ background:'var(--card)', border:'1.5px solid var(--border)',
            borderRadius:14, padding:16, marginBottom:20 }}>
            <div className="section-label" style={{ marginBottom:10 }}>➕ Nueva Categoría</div>
            <div style={{ display:'flex', gap:8 }}>
              <input className="input" placeholder="Ej: Sopas, Postres..."
                value={nuevaCat} onChange={e => setNuevaCat(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && agregarCategoria()}
                style={{ flex:1, marginBottom:0 }} />
              <button className="btn btn-primary" style={{ padding:'0 18px', fontSize:20, flexShrink:0 }}
                onClick={agregarCategoria}>+</button>
            </div>
          </div>
          <div className="section-label" style={{ marginBottom:10 }}>Categorías ({categories.length})</div>
          {categories.map((cat, idx) => {
            const count = items.filter(i => i.category === cat).length
            return (
              <div key={cat} style={{
                background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:12, padding:'12px 14px', marginBottom:8,
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <div style={{ flex:1 }}>
                  <span style={{ fontWeight:700, fontSize:14 }}>{cat}</span>
                  <span style={{ color:'var(--muted)', fontSize:12, marginLeft:8 }}>{count} plato{count!==1?'s':''}</span>
                </div>
                <div style={{ display:'flex', gap:5 }}>
                  <button className="btn btn-ghost" style={{ padding:'6px 9px', fontSize:12 }}
                    onClick={() => moverCategoria(idx, -1)} disabled={idx===0}>↑</button>
                  <button className="btn btn-ghost" style={{ padding:'6px 9px', fontSize:12 }}
                    onClick={() => moverCategoria(idx, 1)} disabled={idx===categories.length-1}>↓</button>
                  <button className="btn btn-danger" style={{ padding:'6px 9px', fontSize:12 }}
                    onClick={() => eliminarCategoria(cat)}>🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
