import { useState } from 'react'
import { listarClientes, textoHace, normTelefono } from '../lib/clientes'

// Asociar (opcional) la cuenta de una mesa a un cliente habitual, para
// registrar su visita al cobrar. value: null | { id?, nombre, telefono }
export default function ClienteCobro({ restoId, value, onChange }) {
  const [abierto, setAbierto]   = useState(false)
  const [clientes, setClientes] = useState(null)
  const [buscar, setBuscar]     = useState('')
  const [nuevo, setNuevo]       = useState(null) // { nombre, telefono } mientras se crea

  const abrir = async () => {
    setAbierto(true)
    if (!clientes) {
      try { setClientes(await listarClientes(restoId)) } catch { setClientes([]) }
    }
  }

  const cerrar = () => { setAbierto(false); setBuscar(''); setNuevo(null) }

  const caja = {
    background:'var(--surface)', borderRadius:12, padding:12, marginBottom:12,
  }
  const titulo = (
    <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:10 }}>
      👤 Cliente <span style={{ textTransform:'none', letterSpacing:0 }}>(opcional)</span>
    </div>
  )

  // Ya elegido
  if (value) return (
    <div style={caja}>
      {titulo}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
        background:'rgba(39,201,122,.08)', border:'1.5px solid var(--green)', borderRadius:10, padding:'10px 12px' }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:14 }}>{value.nombre}</div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
            {value.id ? `Última visita: ${textoHace(value.ultimaVisita).toLowerCase()}` : 'Cliente nuevo — se guarda al cobrar'}
          </div>
        </div>
        <button onClick={() => onChange(null)}
          style={{ background:'none', border:'1px solid var(--border)', color:'var(--muted)', borderRadius:8,
            padding:'6px 10px', cursor:'pointer', fontFamily:'var(--font)', fontSize:12, flexShrink:0 }}>
          Quitar
        </button>
      </div>
    </div>
  )

  if (!abierto) return (
    <div style={caja}>
      {titulo}
      <button onClick={abrir}
        style={{ width:'100%', background:'var(--card)', border:'1.5px dashed var(--border)', color:'var(--muted2)',
          borderRadius:10, padding:'10px', cursor:'pointer', fontFamily:'var(--font)', fontSize:13, fontWeight:700 }}>
        + Asociar a un cliente habitual
      </button>
    </div>
  )

  if (nuevo) {
    const tel = normTelefono(nuevo.telefono)
    const valido = nuevo.nombre.trim() && tel.length >= 9
    return (
      <div style={caja}>
        {titulo}
        <input className="input" placeholder="Nombre *" value={nuevo.nombre} autoFocus
          onChange={e => setNuevo(n => ({ ...n, nombre: e.target.value }))} style={{ marginBottom:8 }} />
        <input className="input" type="tel" placeholder="Celular * (ej: 987654321)" value={nuevo.telefono}
          onChange={e => setNuevo(n => ({ ...n, telefono: e.target.value }))} style={{ marginBottom:8 }} />
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" style={{ flex:1, padding:10 }} onClick={() => setNuevo(null)}>Atrás</button>
          <button className="btn btn-primary" style={{ flex:2, padding:10, fontSize:13 }} disabled={!valido}
            onClick={() => { onChange({ nombre: nuevo.nombre.trim(), telefono: nuevo.telefono }); cerrar() }}>
            Usar este cliente
          </button>
        </div>
      </div>
    )
  }

  const q = buscar.trim().toLowerCase()
  const qDig = q.replace(/\D/g, '')
  const coincidencias = (clientes || [])
    .filter(c => !q || (c.nombre || '').toLowerCase().includes(q) || (qDig && (c.telefono || '').includes(qDig)))
    .sort((a, b) => (b.ultimaVisita || '').localeCompare(a.ultimaVisita || ''))
    .slice(0, 5)

  return (
    <div style={caja}>
      {titulo}
      <input className="input" type="search" placeholder="Buscar por nombre o celular…" value={buscar} autoFocus
        onChange={e => setBuscar(e.target.value)} style={{ marginBottom:8 }} />
      {clientes === null ? (
        <div style={{ fontSize:12, color:'var(--muted)', padding:6 }}>Cargando…</div>
      ) : coincidencias.map(c => (
        <button key={c.id} onClick={() => { onChange(c); cerrar() }}
          style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8,
            background:'var(--card)', border:'1px solid var(--border)', borderRadius:10, padding:'9px 12px',
            marginBottom:6, cursor:'pointer', fontFamily:'var(--font)', color:'var(--text)', textAlign:'left' }}>
          <span style={{ fontWeight:700, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nombre}</span>
          <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0 }}>{textoHace(c.ultimaVisita)}</span>
        </button>
      ))}
      <div style={{ display:'flex', gap:8, marginTop:4 }}>
        <button className="btn btn-ghost" style={{ flex:1, padding:10, fontSize:13 }} onClick={cerrar}>Cancelar</button>
        <button className="btn btn-ghost" style={{ flex:2, padding:10, fontSize:13 }}
          onClick={() => setNuevo({ nombre: /\d/.test(buscar) ? '' : buscar, telefono: /\d/.test(buscar) ? buscar : '' })}>
          + Cliente nuevo
        </button>
      </div>
    </div>
  )
}
