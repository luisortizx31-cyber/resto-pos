import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore'
import { useToast, useSession } from '../components/Layout'

const DEFAULT_CATEGORIES = ['Ceviches', 'Combinados', 'Bebidas', 'Guarniciones', 'Entradas', 'Postres', 'Otros']

export default function Menu() {
  const session = useSession()
  const restoId = session?.restoId
  const [items, setItems]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [form, setForm]               = useState({ name:'', price:'', category:'', fotoUrl:'' })
  const [editId, setEditId]           = useState(null)
  const [saving, setSaving]           = useState(false)
  const [activeTab, setActiveTab]     = useState('lista')
  const [categories, setCategories]   = useState(DEFAULT_CATEGORIES)
  const [nuevaCat, setNuevaCat]       = useState('')
  const [tabMenu, setTabMenu]         = useState('platos')
  const [deshabilitados, setDeshabilitados] = useState(new Set())
  const showToast = useToast()

  // Cargar platos deshabilitados
  useEffect(() => {
    if (!restoId) return
    getDoc(doc(db, 'restaurantes', restoId, 'config', 'menu')).then(snap => {
      if (snap.exists()) setDeshabilitados(new Set(snap.data().deshabilitados || []))
    })
  }, [restoId])

  const toggleDeshabilitar = async (itemId) => {
    const nuevo = new Set(deshabilitados)
    if (nuevo.has(itemId)) nuevo.delete(itemId)
    else nuevo.add(itemId)
    setDeshabilitados(nuevo)
    await setDoc(doc(db, 'restaurantes', restoId, 'config', 'menu'),
      { deshabilitados: [...nuevo] }, { merge: true })
    showToast(nuevo.has(itemId) ? '🚫 Plato deshabilitado' : '✅ Plato habilitado')
  }

  // ── Categorías ──────────────────────────────────────────────────
  const loadCategories = async () => {
    try {
      const snap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'))
      if (snap.exists() && snap.data().lista?.length) {
        setCategories(snap.data().lista)
        return snap.data().lista
      }
    } catch {}
    return DEFAULT_CATEGORIES
  }

  const saveCategories = async (lista) => {
    try { await setDoc(doc(db, 'restaurantes', restoId, 'config', 'categorias'), { lista }) }
    catch { showToast('Error guardando categorías', 'error') }
  }

  const moverCategoria = async (index, direccion) => {
    const nueva = [...categories]
    const destino = index + direccion
    if (destino < 0 || destino >= nueva.length) return
    ;[nueva[index], nueva[destino]] = [nueva[destino], nueva[index]]
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
    showToast(`🗑 Categoría "${cat}" eliminada`)
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
    loadCategories().then(cats => setForm(f => ({ ...f, category: cats[0] || '' })))
    load()
  }, [])

  // ── Guardar plato ────────────────────────────────────────────────
  const save = async () => {
    if (!form.name.trim() || !form.price) { showToast('Completa nombre y precio', 'error'); return }
    setSaving(true)
    try {
      const data = {
        name: form.name.trim(),
        price: parseFloat(form.price),
        category: form.category,
        fotoUrl: form.fotoUrl.trim() || null,
      }

      if (editId) {
        await updateDoc(doc(db, 'restaurantes', restoId, 'menu', editId), data)
        showToast('✅ Plato actualizado')
      } else {
        await addDoc(collection(db, 'restaurantes', restoId, 'menu'), data)
        showToast('✅ Plato agregado')
      }

      setForm({ name:'', price:'', category: categories[0] || '', fotoUrl:'' })
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
    setForm({ name: item.name, price: String(item.price), category: item.category, fotoUrl: item.fotoUrl || '' })
    setEditId(item.id)
    setActiveTab('form')
    setTabMenu('platos')
  }

  const byCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">MENÚ</span>
        <button className="btn btn-ghost" style={{ padding:'8px 14px', fontSize:13 }}
          onClick={() => {
            setEditId(null)
            setForm({ name:'', price:'', category: categories[0]||'', fotoUrl:'' })
            setActiveTab('form'); setTabMenu('platos')
          }}>+ Agregar</button>
      </div>

      {/* Tabs principales */}
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
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
          {[['lista','📋 Lista'],['form', editId ? '✏️ Editar' : '➕ Nuevo']].map(([tab,label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex:1, padding:'11px 0', background:'none', border:'none',
              borderBottom: activeTab===tab ? '2px solid var(--blue)' : '2px solid transparent',
              color: activeTab===tab ? 'var(--blue)' : 'var(--muted)',
              fontFamily:'var(--font)', fontWeight:700, fontSize:13,
              cursor:'pointer', letterSpacing:1 }}>{label}</button>
          ))}
        </div>

        {activeTab === 'lista' && (
          <div style={{ padding:'12px 16px' }}>
            {loading ? (
              <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Cargando...</div>
            ) : items.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
                <div style={{ fontSize:48, opacity:.3, marginBottom:12 }}>🍽</div>
                <div style={{ letterSpacing:2, fontSize:13 }}>Menú vacío</div>
              </div>
            ) : Object.entries(byCategory).map(([cat, catItems]) => (
              <div key={cat} style={{ marginBottom:20 }}>
                <div className="section-label">{cat}</div>
                {catItems.map(item => {
                  const disabled = deshabilitados.has(item.id)
                  return (
                  <div key={item.id} style={{
                    background: disabled ? 'rgba(255,255,255,.02)' : 'var(--card)',
                    border:`1.5px solid ${disabled ? 'rgba(255,77,77,.3)' : 'var(--border)'}`,
                    borderRadius:14, marginBottom:8, overflow:'hidden',
                    display:'flex', alignItems:'stretch',
                    opacity: disabled ? 0.7 : 1, transition:'all .2s' }}>
                    {item.fotoUrl ? (
                      <img src={item.fotoUrl} alt={item.name}
                        style={{ width:72, height:72, objectFit:'cover', flexShrink:0,
                          filter: disabled ? 'grayscale(1)' : 'none' }}
                        loading="lazy" />
                    ) : (
                      <div style={{ width:72, height:72, background:'var(--surface)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:26, flexShrink:0, color:'var(--border)' }}>🍽</div>
                    )}
                    <div style={{ flex:1, padding:'10px 12px', display:'flex',
                      alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ fontWeight:700, fontSize:14,
                            textDecoration: disabled ? 'line-through' : 'none',
                            color: disabled ? 'var(--muted)' : 'var(--text)' }}>{item.name}</div>
                          {disabled && (
                            <span style={{ background:'rgba(255,77,77,.15)', color:'#ff4d4d',
                              fontSize:9, fontWeight:800, padding:'2px 7px',
                              borderRadius:20, letterSpacing:1 }}>AGOTADO</span>
                          )}
                        </div>
                        <div style={{ color: disabled ? 'var(--muted)' : 'var(--accent)',
                          fontFamily:'var(--mono)', fontWeight:700, fontSize:13, marginTop:2 }}>
                          S/ {Number(item.price).toFixed(2)}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          onClick={() => toggleDeshabilitar(item.id)}
                          title={disabled ? 'Habilitar plato' : 'Marcar como agotado'}
                          style={{ padding:'7px 10px', fontSize:13, borderRadius:10, border:'none',
                            cursor:'pointer', fontWeight:700,
                            background: disabled ? 'rgba(39,201,122,.15)' : 'rgba(255,77,77,.12)',
                            color: disabled ? 'var(--green)' : '#ff4d4d' }}>
                          {disabled ? '✅' : '🚫'}
                        </button>
                        <button className="btn btn-ghost" style={{ padding:'7px 10px', fontSize:13 }}
                          onClick={() => startEdit(item)}>✏️</button>
                        <button className="btn btn-danger" style={{ padding:'7px 10px', fontSize:13 }}
                          onClick={() => del(item.id, item.name)}>🗑</button>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'form' && (
          <div style={{ padding:'20px 16px' }}>
            {/* Foto URL */}
            <div style={{ marginBottom:20 }}>
              <div className="section-label">URL de imagen (opcional)</div>
              {form.fotoUrl && (
                <img src={form.fotoUrl} alt="preview"
                  style={{ width:130, height:130, objectFit:'cover',
                    borderRadius:14, border:'2px solid var(--accent)',
                    display:'block', marginBottom:10 }}
                  onError={e => e.target.style.display='none'} />
              )}
              <input className="input" placeholder="https://ejemplo.com/imagen.jpg"
                value={form.fotoUrl}
                onChange={e => setForm(f => ({ ...f, fotoUrl: e.target.value }))} />
              <div style={{ fontSize:11, color:'var(--muted)', marginTop:6 }}>
                Pega el link directo de la imagen del plato
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div className="section-label">Nombre del plato</div>
              <input className="input" placeholder="Ej: Ceviche de Camarones"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div style={{ marginBottom:16 }}>
              <div className="section-label">Precio (S/)</div>
              <input className="input" type="number" placeholder="Ej: 25"
                value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                min="0" step="0.5" />
            </div>

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
              disabled={!form.name.trim() || !form.price || saving}
              onClick={save}>
              {saving ? 'GUARDANDO...' : editId ? '💾 ACTUALIZAR PLATO' : '➕ AGREGAR AL MENÚ'}
            </button>
            {editId && (
              <button className="btn btn-ghost" style={{ width:'100%', marginTop:10, padding:14 }}
                onClick={() => {
                  setForm({ name:'', price:'', category: categories[0]||'', fotoUrl:'' })
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

          <div className="section-label" style={{ marginBottom:10 }}>
            Categorías ({categories.length})
          </div>
          {categories.map((cat, idx) => {
            const count = items.filter(i => i.category === cat).length
            return (
              <div key={cat} style={{
                background:'var(--card)', border:'1.5px solid var(--border)',
                borderRadius:12, padding:'12px 14px', marginBottom:8,
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>{cat}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                    {count === 0 ? 'Sin platos' : `${count} plato${count!==1?'s':''}`}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <button onClick={() => moverCategoria(idx,-1)} disabled={idx===0}
                      style={{ background:'var(--surface)', border:'1px solid var(--border)',
                        color: idx===0 ? 'var(--border)' : 'var(--muted2)',
                        borderRadius:6, width:28, height:28, fontSize:12,
                        cursor: idx===0 ? 'default':'pointer', fontFamily:'var(--font)',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>▲</button>
                    <button onClick={() => moverCategoria(idx,1)} disabled={idx===categories.length-1}
                      style={{ background:'var(--surface)', border:'1px solid var(--border)',
                        color: idx===categories.length-1 ? 'var(--border)' : 'var(--muted2)',
                        borderRadius:6, width:28, height:28, fontSize:12,
                        cursor: idx===categories.length-1 ? 'default':'pointer', fontFamily:'var(--font)',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>▼</button>
                  </div>
                  <button onClick={() => eliminarCategoria(cat)}
                    style={{ background:'rgba(255,77,77,.1)', border:'1px solid rgba(255,77,77,.3)',
                      color:'var(--red)', borderRadius:10, padding:'8px 12px',
                      fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>🗑</button>
                </div>
              </div>
            )
          })}

          <div style={{ marginTop:16, background:'rgba(74,158,255,.06)',
            border:'1px solid rgba(74,158,255,.15)', borderRadius:12, padding:12 }}>
            <div style={{ fontSize:11, color:'var(--blue)', fontWeight:800, letterSpacing:1, marginBottom:4 }}>ℹ️ NOTA</div>
            <div style={{ fontSize:12, color:'var(--muted2)', lineHeight:1.6 }}>
              El orden define cómo aparecen en la carta del cliente.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
