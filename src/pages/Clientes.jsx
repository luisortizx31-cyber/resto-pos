import { useEffect, useMemo, useState } from 'react'
import { useSession, useToast } from '../components/Layout'
import {
  listarClientes, guardarCliente, eliminarCliente, marcarMensaje,
  diasDesde, textoHace, cumpleEsteMes, normTelefono,
  DIAS_POR_RECUPERAR, VISITAS_FRECUENTE, PLANTILLAS, armarMensaje, linkWhatsapp,
} from '../lib/clientes'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const FILTROS = [
  { id:'todos',      label:'Todos' },
  { id:'recuperar',  label:'🔔 Por recuperar' },
  { id:'frecuentes', label:'⭐ Frecuentes' },
  { id:'cumple',     label:'🎂 Cumpleaños' },
  { id:'nuevos',     label:'🆕 Nuevos' },
]

const ORDENES = [
  { id:'reciente', label:'Última visita' },
  { id:'visitas',  label:'Más visitas' },
  { id:'gasto',    label:'Más gasto' },
  { id:'nombre',   label:'Nombre (A-Z)' },
]

const S = (n) => `S/${Number(n || 0).toFixed(2)}`

// Color según cuánto hace que no viene
function colorRecencia(dias) {
  if (dias === null) return 'var(--muted)'
  if (dias < 15) return 'var(--green)'
  if (dias < DIAS_POR_RECUPERAR) return 'var(--yellow)'
  return 'var(--red)'
}

function fmtFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-PE', { day:'numeric', month:'short', year:'numeric' })
}

export default function Clientes() {
  const session   = useSession()
  const showToast = useToast()
  const restoId   = session?.restoId
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [buscar, setBuscar]     = useState('')
  const [filtro, setFiltro]     = useState('todos')
  const [orden, setOrden]       = useState('reciente')
  const [ficha, setFicha]       = useState(null)   // cliente abierto
  const [form, setForm]         = useState(null)   // null | {} (nuevo) | cliente (editar)
  const [mensaje, setMensaje]   = useState(null)   // cliente al que se le escribe

  const cargar = async () => {
    setCargando(true)
    try { setClientes(await listarClientes(restoId)) }
    catch (e) { console.error(e); showToast('Error al cargar clientes', 'error') }
    setCargando(false)
  }
  useEffect(() => { if (restoId) cargar() }, [restoId])

  // Mantener la ficha abierta al día después de recargar
  useEffect(() => {
    if (ficha) setFicha(clientes.find(c => c.id === ficha.id) || null)
  }, [clientes])

  const resumen = useMemo(() => ({
    total:     clientes.length,
    activos:   clientes.filter(c => { const d = diasDesde(c.ultimaVisita); return d !== null && d < DIAS_POR_RECUPERAR }).length,
    recuperar: clientes.filter(c => (diasDesde(c.ultimaVisita) ?? 0) >= DIAS_POR_RECUPERAR).length,
    cumple:    clientes.filter(cumpleEsteMes).length,
  }), [clientes])

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const qDig = q.replace(/\D/g, '')
    let l = clientes.filter(c =>
      !q || (c.nombre || '').toLowerCase().includes(q) || (qDig && (c.telefono || '').includes(qDig)))
    if (filtro === 'recuperar')  l = l.filter(c => (diasDesde(c.ultimaVisita) ?? 0) >= DIAS_POR_RECUPERAR)
    if (filtro === 'frecuentes') l = l.filter(c => (c.visitas || 0) >= VISITAS_FRECUENTE)
    if (filtro === 'cumple')     l = l.filter(cumpleEsteMes)
    if (filtro === 'nuevos')     l = l.filter(c => (c.visitas || 0) <= 1)
    const cmp = {
      reciente: (a, b) => (b.ultimaVisita || '').localeCompare(a.ultimaVisita || ''),
      visitas:  (a, b) => (b.visitas || 0) - (a.visitas || 0),
      gasto:    (a, b) => (b.totalGastado || 0) - (a.totalGastado || 0),
      nombre:   (a, b) => (a.nombre || '').localeCompare(b.nombre || ''),
    }[orden]
    // En "por recuperar" primero los que hace más tiempo no vienen
    if (filtro === 'recuperar') return [...l].sort((a, b) => (a.ultimaVisita || '').localeCompare(b.ultimaVisita || ''))
    if (filtro === 'cumple') return [...l].sort((a, b) => (a.cumple || '').localeCompare(b.cumple || ''))
    return [...l].sort(cmp)
  }, [clientes, buscar, filtro, orden])

  const borrar = async (c) => {
    if (!confirm(`¿Eliminar a ${c.nombre}? Se pierde su historial de visitas.`)) return
    try {
      await eliminarCliente(restoId, c.id)
      setFicha(null)
      showToast('🗑 Cliente eliminado')
      cargar()
    } catch { showToast('Error al eliminar', 'error') }
  }

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">CLIENTES</span>
        <button className="btn btn-primary" style={{ padding:'10px 16px', fontSize:13 }}
          onClick={() => setForm({})}>+ Cliente</button>
      </div>

      <div style={{ padding:16 }}>
        {/* Resumen */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:14 }}>
          {[
            ['Clientes', resumen.total, 'var(--text)', 'todos'],
            ['Activos', resumen.activos, 'var(--green)', 'todos'],
            ['Por recuperar', resumen.recuperar, 'var(--red)', 'recuperar'],
            ['Cumplen este mes', resumen.cumple, 'var(--accent)', 'cumple'],
          ].map(([label, n, color, f]) => (
            <button key={label} onClick={() => setFiltro(f)}
              style={{ background:'var(--card)', border:'1.5px solid var(--border)', borderRadius:12,
                padding:'10px 4px', cursor:'pointer', fontFamily:'var(--font)', textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:900, color, fontFamily:'var(--mono)' }}>{n}</div>
              <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:.5, textTransform:'uppercase',
                fontWeight:700, marginTop:2, lineHeight:1.2 }}>{label}</div>
            </button>
          ))}
        </div>

        {/* Buscador + orden */}
        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <input className="input" type="search" value={buscar} onChange={e => setBuscar(e.target.value)}
            placeholder="Buscar por nombre o teléfono…" style={{ flex:1 }} />
          <select className="input" value={orden} onChange={e => setOrden(e.target.value)}
            style={{ width:'auto', flexShrink:0 }} disabled={filtro === 'recuperar' || filtro === 'cumple'}>
            {ORDENES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>

        {/* Filtros */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', marginBottom:14, paddingBottom:2 }}>
          {FILTROS.map(f => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              style={{ flexShrink:0, padding:'7px 12px', borderRadius:20, cursor:'pointer',
                fontFamily:'var(--font)', fontSize:12, fontWeight:700,
                background: filtro===f.id ? 'var(--accent)' : 'var(--card)',
                color: filtro===f.id ? '#111' : 'var(--muted2)',
                border: `1.5px solid ${filtro===f.id ? 'var(--accent)' : 'var(--border)'}` }}>
              {f.label}
            </button>
          ))}
        </div>

        {filtro === 'recuperar' && lista.length > 0 && (
          <div style={{ fontSize:12, color:'var(--muted2)', background:'rgba(245,64,58,.06)',
            border:'1px solid rgba(245,64,58,.25)', borderRadius:10, padding:'8px 12px', marginBottom:12, lineHeight:1.5 }}>
            Clientes que no vienen hace {DIAS_POR_RECUPERAR} días o más. Toca 💬 para invitarlos a volver.
          </div>
        )}

        {/* Lista */}
        {cargando ? (
          <div style={{ textAlign:'center', color:'var(--muted)', padding:40 }}>Cargando...</div>
        ) : lista.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--muted)', padding:'40px 20px', lineHeight:1.7 }}>
            <div style={{ fontSize:48, opacity:.3, marginBottom:8 }}>👥</div>
            {clientes.length === 0
              ? <>Aún no hay clientes.<br/>Se agregan solos con los pedidos de delivery, al asociar un cliente al cobrar una mesa, o con <strong>+ Cliente</strong>.</>
              : 'Ningún cliente coincide.'}
          </div>
        ) : lista.map(c => {
          const dias = diasDesde(c.ultimaVisita)
          const ticket = c.visitas ? (c.totalGastado || 0) / c.visitas : 0
          return (
            <div key={c.id} style={{ display:'flex', gap:8, marginBottom:8 }}>
              <button onClick={() => setFicha(c)}
                style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:12, textAlign:'left',
                  background:'var(--card)', border:'1.5px solid var(--border)', borderRadius:14,
                  padding:'12px 14px', cursor:'pointer', fontFamily:'var(--font)', color:'var(--text)' }}>
                <div style={{ width:42, height:42, borderRadius:'50%', flexShrink:0,
                  background:'rgba(245,166,35,.12)', color:'var(--accent)', fontWeight:900, fontSize:17,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {(c.nombre || '?').slice(0,1).toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                    <span style={{ fontWeight:800, fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {c.nombre}
                    </span>
                    {(c.visitas || 0) >= VISITAS_FRECUENTE && <span title="Frecuente">⭐</span>}
                    {cumpleEsteMes(c) && <span title="Cumple este mes">🎂</span>}
                  </div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>
                    {c.visitas || 0} visita{c.visitas === 1 ? '' : 's'} · {S(c.totalGastado)}
                    {c.visitas ? ` · prom. ${S(ticket)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:12, fontWeight:800, color: colorRecencia(dias) }}>{textoHace(c.ultimaVisita)}</div>
                  {c.ultimoMensaje && (
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:3 }}>💬 {textoHace(c.ultimoMensaje).toLowerCase()}</div>
                  )}
                </div>
              </button>
              <button onClick={() => c.telefono ? setMensaje(c) : showToast('Este cliente no tiene teléfono', 'error')}
                aria-label={`Enviar WhatsApp a ${c.nombre}`}
                style={{ width:52, flexShrink:0, borderRadius:14, border:'none', cursor:'pointer', fontSize:22,
                  background: c.telefono ? '#25D366' : 'var(--card)', opacity: c.telefono ? 1 : .4 }}>
                💬
              </button>
            </div>
          )
        })}
      </div>

      {ficha && (
        <FichaCliente cliente={ficha} onCerrar={() => setFicha(null)}
          onEditar={() => setForm(ficha)} onEliminar={() => borrar(ficha)}
          onMensaje={() => setMensaje(ficha)} />
      )}
      {form && (
        <FormCliente restoId={restoId} cliente={form.id ? form : null} showToast={showToast}
          onCerrar={() => setForm(null)} onGuardado={() => { setForm(null); cargar() }} />
      )}
      {mensaje && (
        <ModalMensaje restoId={restoId} cliente={mensaje} restaurante={session?.restoNombre}
          showToast={showToast} onCerrar={() => setMensaje(null)} onEnviado={cargar} />
      )}
    </div>
  )
}

// ── Contenedor de modal (hoja inferior) ─────────────────────────────
function Hoja({ titulo, onCerrar, children }) {
  return (
    <div onClick={onCerrar} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:300,
      display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'var(--bg)', width:'100%', maxWidth:480,
        maxHeight:'92vh', overflowY:'auto', borderRadius:'20px 20px 0 0', border:'1.5px solid var(--border)',
        borderBottom:'none' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 20px', borderBottom:'1px solid var(--border)', background:'var(--surface)',
          position:'sticky', top:0, zIndex:1 }}>
          <span style={{ fontWeight:800, fontSize:16 }}>{titulo}</span>
          <button onClick={onCerrar} style={{ background:'none', border:'none', color:'var(--muted)',
            fontSize:26, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  )
}

// ── Ficha del cliente ───────────────────────────────────────────────
function FichaCliente({ cliente: c, onCerrar, onEditar, onEliminar, onMensaje }) {
  const dias = diasDesde(c.ultimaVisita)
  const ticket = c.visitas ? (c.totalGastado || 0) / c.visitas : 0
  const [mm, dd] = (c.cumple || '').split('-')
  return (
    <Hoja titulo={c.nombre} onCerrar={onCerrar}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:13, color:'var(--muted2)', fontFamily:'var(--mono)' }}>
            {c.telefono ? `📱 +${c.telefono}` : 'Sin teléfono'}
          </div>
          {c.cumple && <div style={{ fontSize:13, color:'var(--muted2)', marginTop:4 }}>🎂 {Number(dd)} de {MESES[Number(mm)-1]}</div>}
        </div>
        <div style={{ fontSize:13, fontWeight:800, color: colorRecencia(dias) }}>{textoHace(c.ultimaVisita)}</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 }}>
        {[['Visitas', c.visitas || 0], ['Gastado', S(c.totalGastado)], ['Ticket prom.', S(ticket)]].map(([l, v]) => (
          <div key={l} style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12,
            padding:'10px 6px', textAlign:'center' }}>
            <div style={{ fontWeight:900, fontSize:16, fontFamily:'var(--mono)' }}>{v}</div>
            <div style={{ fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize:12, color:'var(--muted)', marginBottom:16, lineHeight:1.7 }}>
        Cliente desde: <strong style={{ color:'var(--text)' }}>{fmtFecha(c.primeraVisita || c.creadoEn)}</strong><br/>
        Último mensaje: <strong style={{ color:'var(--text)' }}>{c.ultimoMensaje ? fmtFecha(c.ultimoMensaje) : 'nunca'}</strong>
      </div>

      {c.notas && (
        <div style={{ background:'rgba(245,200,66,.08)', border:'1px solid rgba(245,200,66,.3)', borderRadius:10,
          padding:'10px 12px', fontSize:13, marginBottom:16, lineHeight:1.5, whiteSpace:'pre-wrap' }}>
          📝 {c.notas}
        </div>
      )}

      <div className="section-label">Últimas visitas</div>
      {(c.ultimasVisitas || []).length === 0 ? (
        <div style={{ fontSize:13, color:'var(--muted)', marginBottom:16 }}>Todavía sin visitas registradas.</div>
      ) : (
        <div style={{ marginBottom:16 }}>
          {c.ultimasVisitas.map((v, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:13,
              padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
              <span>{v.tipo === 'delivery' ? '🛵' : '🍽'} {fmtFecha(v.fecha)}</span>
              <span style={{ fontFamily:'var(--mono)', fontWeight:700 }}>{S(v.total)}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={onMensaje} disabled={!c.telefono}
        style={{ width:'100%', background:'#25D366', color:'white', border:'none', borderRadius:12,
          padding:14, fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:'var(--font)',
          marginBottom:10, opacity: c.telefono ? 1 : .4 }}>
        💬 Enviar WhatsApp
      </button>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-ghost" style={{ flex:1 }} onClick={onEditar}>✏️ Editar</button>
        <button className="btn btn-danger" style={{ flex:1 }} onClick={onEliminar}>🗑 Eliminar</button>
      </div>
    </Hoja>
  )
}

// ── Formulario nuevo / editar ───────────────────────────────────────
function FormCliente({ restoId, cliente, showToast, onCerrar, onGuardado }) {
  const [mm0, dd0] = (cliente?.cumple || '').split('-')
  const [nombre, setNombre]     = useState(cliente?.nombre || '')
  const [telefono, setTelefono] = useState(cliente?.telefono || '')
  const [mes, setMes]           = useState(mm0 || '')
  const [dia, setDia]           = useState(dd0 || '')
  const [notas, setNotas]       = useState(cliente?.notas || '')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (!nombre.trim()) { showToast('El nombre es obligatorio', 'error'); return }
    const tel = normTelefono(telefono)
    if (telefono.trim() && tel.length < 9) { showToast('Revisa el teléfono', 'error'); return }
    if ((mes && !dia) || (!mes && dia)) { showToast('Completa día y mes del cumpleaños', 'error'); return }
    setGuardando(true)
    try {
      await guardarCliente(restoId, {
        nombre, telefono, notas,
        cumple: mes && dia ? `${mes}-${dia}` : '',
      }, cliente?.id)
      showToast(cliente ? '✅ Cliente actualizado' : '✅ Cliente agregado')
      onGuardado()
    } catch (e) {
      console.error(e)
      showToast('Error al guardar', 'error')
    }
    setGuardando(false)
  }

  const etiqueta = (t) => (
    <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>{t}</div>
  )

  return (
    <Hoja titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'} onCerrar={onCerrar}>
      {etiqueta('Nombre *')}
      <input className="input" value={nombre} onChange={e => setNombre(e.target.value)}
        placeholder="Ej: María López" style={{ marginBottom:14 }} />
      {etiqueta('Celular (WhatsApp)')}
      <input className="input" type="tel" value={telefono} onChange={e => setTelefono(e.target.value)}
        placeholder="Ej: 987654321" style={{ marginBottom:4 }} />
      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:14 }}>
        Sin el 51 está bien: se agrega solo a los celulares peruanos.
        {cliente?.id?.startsWith('tel_') && ' Si lo cambias, se guarda en este mismo cliente.'}
      </div>
      {etiqueta('Cumpleaños (opcional)')}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <select className="input" value={dia} onChange={e => setDia(e.target.value)} style={{ flex:1 }}>
          <option value="">Día</option>
          {Array.from({ length:31 }, (_, i) => String(i+1).padStart(2,'0')).map(d => <option key={d} value={d}>{Number(d)}</option>)}
        </select>
        <select className="input" value={mes} onChange={e => setMes(e.target.value)} style={{ flex:2 }}>
          <option value="">Mes</option>
          {MESES.map((m, i) => <option key={m} value={String(i+1).padStart(2,'0')}>{m}</option>)}
        </select>
      </div>
      {etiqueta('Notas (opcional)')}
      <textarea className="input" value={notas} onChange={e => setNotas(e.target.value)}
        placeholder="Ej: alérgico a mariscos, prefiere la mesa 4, pide su ceviche sin ají…"
        style={{ marginBottom:18 }} />
      <button className="btn btn-primary" style={{ width:'100%' }} disabled={guardando} onClick={guardar}>
        {guardando ? 'GUARDANDO...' : '💾 GUARDAR'}
      </button>
    </Hoja>
  )
}

// ── Mensaje de WhatsApp con plantillas ──────────────────────────────
function ModalMensaje({ restoId, cliente, restaurante, showToast, onCerrar, onEnviado }) {
  const inicial = cumpleEsteMes(cliente) ? 'cumple'
    : (diasDesde(cliente.ultimaVisita) ?? 0) >= DIAS_POR_RECUPERAR ? 'extranamos' : 'gracias'
  const [plantilla, setPlantilla] = useState(inicial)
  const [texto, setTexto] = useState(() => armarMensaje(PLANTILLAS.find(p => p.id === inicial), cliente, restaurante))

  const elegir = (p) => {
    setPlantilla(p.id)
    setTexto(armarMensaje(p, cliente, restaurante))
  }

  const enviar = async () => {
    window.open(linkWhatsapp(cliente.telefono, texto), '_blank')
    try {
      await marcarMensaje(restoId, cliente.id, plantilla)
      onEnviado()
    } catch (e) { console.error(e) }
    onCerrar()
  }

  const diasMsg = diasDesde(cliente.ultimoMensaje)

  return (
    <Hoja titulo={`WhatsApp a ${cliente.nombre}`} onCerrar={onCerrar}>
      {diasMsg !== null && diasMsg < 7 && (
        <div style={{ fontSize:12, color:'var(--yellow)', background:'rgba(245,200,66,.08)',
          border:'1px solid rgba(245,200,66,.3)', borderRadius:10, padding:'8px 12px', marginBottom:14 }}>
          ⚠️ Ya le escribiste {textoHace(cliente.ultimoMensaje).toLowerCase()}. Muchos mensajes seguidos pueden molestar.
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
        {PLANTILLAS.map(p => (
          <button key={p.id} onClick={() => elegir(p)}
            style={{ padding:'10px 8px', borderRadius:12, cursor:'pointer', fontFamily:'var(--font)',
              fontSize:13, fontWeight:700,
              background: plantilla===p.id ? 'rgba(37,211,102,.12)' : 'var(--card)',
              color: plantilla===p.id ? '#1fa855' : 'var(--text)',
              border:`1.5px solid ${plantilla===p.id ? '#25D366' : 'var(--border)'}` }}>
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2, textTransform:'uppercase', marginBottom:6 }}>
        Mensaje (puedes editarlo)
      </div>
      <textarea className="input" value={texto} onChange={e => setTexto(e.target.value)}
        style={{ minHeight:130, marginBottom:16, lineHeight:1.5 }} />
      <button onClick={enviar} disabled={!texto.trim()}
        style={{ width:'100%', background:'#25D366', color:'white', border:'none', borderRadius:12,
          padding:15, fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:'var(--font)' }}>
        💬 Abrir WhatsApp
      </button>
      <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center', marginTop:8 }}>
        Se abre WhatsApp con el mensaje listo; solo falta tocar Enviar.
      </div>
    </Hoja>
  )
}
