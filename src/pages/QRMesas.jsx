import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { useSession } from '../components/Layout'
import { doc, getDoc, updateDoc } from 'firebase/firestore'

export default function QRMesas() {
  const session  = useSession()
  const restoId  = session?.restoId
  const [numMesas, setNumMesas]           = useState(10)
  // FIX P4: inicializar con window.location.origin directamente, no en useEffect
  const [baseUrl, setBaseUrl]             = useState(() => window.location.origin)
  const [mesaSeleccionada, setMesaSeleccionada] = useState(null)
  const [qrGlobal, setQrGlobal]           = useState(true)
  const [mesasOff, setMesasOff]           = useState(new Set())
  const [guardando, setGuardando]         = useState(false)

  useEffect(() => {
    async function load() {
      const [mesasSnap, restoSnap] = await Promise.all([
        getDoc(doc(db, 'restaurantes', restoId, 'config', 'mesas')),
        getDoc(doc(db, 'restaurantes', restoId)),
      ])
      if (mesasSnap.exists()) setNumMesas(mesasSnap.data().total || 10)
      if (restoSnap.exists()) {
        const d = restoSnap.data()
        setQrGlobal(d.qrActivo !== false)
        setMesasOff(new Set(d.qrMesasOff || []))
      }
    }
    load()
  }, [restoId])

  const mesaUrl = (num) => `${baseUrl}/cliente/${restoId}/mesa/${num}`

  const getQrUrl = (num) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mesaUrl(num))}`

  const mesaActiva = (num) => qrGlobal && !mesasOff.has(num)

  // Toggle global ON/OFF
  const toggleGlobal = async () => {
    const nuevo = !qrGlobal
    setGuardando(true)
    await updateDoc(doc(db, 'restaurantes', restoId), { qrActivo: nuevo })
    setQrGlobal(nuevo)
    // FIX P5: si se desactiva globalmente, cerrar modal para evitar estado inconsistente
    if (!nuevo) setMesaSeleccionada(null)
    setGuardando(false)
  }

  // Toggle individual de una mesa
  const toggleMesa = async (num) => {
    const nuevasOff = new Set(mesasOff)
    if (nuevasOff.has(num)) nuevasOff.delete(num)
    else nuevasOff.add(num)
    setMesasOff(nuevasOff)
    await updateDoc(doc(db, 'restaurantes', restoId), {
      qrMesasOff: [...nuevasOff]
    })
  }

  const mesas = Array.from({ length: numMesas }, (_, i) => i + 1)
  const totalActivas  = mesas.filter(n => mesaActiva(n)).length
  const totalInactivas = numMesas - totalActivas

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-title">CÓDIGOS QR</span>
        <span style={{ fontSize:12, color:'var(--muted)', letterSpacing:2 }}>{numMesas} MESAS</span>
      </div>

      {/* Control global */}
      <div style={{ margin:'0 16px 16px', background:'var(--card)',
        border:`2px solid ${qrGlobal ? 'var(--green)' : 'var(--red)'}`,
        borderRadius:16, padding:'16px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{ fontWeight:900, fontSize:15, marginBottom:4 }}>
              {qrGlobal ? '📷 QR activo para todas las mesas' : '🚫 QR desactivado globalmente'}
            </div>
            <div style={{ fontSize:12, color:'var(--muted)' }}>
              {qrGlobal
                ? `${totalActivas} activas · ${totalInactivas} desactivadas individualmente`
                : 'Los clientes no pueden escanear ningún QR'}
            </div>
          </div>
          <button onClick={toggleGlobal} disabled={guardando}
            style={{
              width:56, height:30, borderRadius:15, border:'none', cursor:'pointer',
              background: qrGlobal ? 'var(--green)' : 'rgba(255,77,77,.4)',
              position:'relative', transition:'background .2s', flexShrink:0
            }}>
            <div style={{
              width:24, height:24, borderRadius:'50%', background:'white',
              position:'absolute', top:3,
              left: qrGlobal ? 29 : 3,
              transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,.4)'
            }} />
          </button>
        </div>
        {!qrGlobal && (
          <div style={{ marginTop:10, fontSize:12, color:'var(--red)',
            background:'rgba(255,77,77,.08)', borderRadius:8, padding:'7px 10px',
            border:'1px solid rgba(255,77,77,.2)' }}>
            ⚠️ Todos los QR están bloqueados. Los clientes verán "Pedidos desactivados".
          </div>
        )}
      </div>

      {/* Instrucción */}
      <div style={{ padding:'0 16px 10px', color:'var(--muted)', fontSize:13, lineHeight:1.6 }}>
        Toca una mesa para ver su QR. Usa el switch para activar/desactivar individualmente.
      </div>

      {/* Grid mesas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, padding:'4px 16px 20px' }}>
        {mesas.map(num => {
          const activa = mesaActiva(num)
          return (
            <div key={num} style={{ position:'relative' }}>
              <button onClick={() => setMesaSeleccionada(num)}
                style={{ width:'100%', background:'var(--card)',
                  border:`2px solid ${activa ? 'var(--border)' : 'var(--red)'}`,
                  borderRadius:14, aspectRatio:'1', display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', cursor:'pointer',
                  fontFamily:'var(--font)', color: activa ? 'var(--text)' : 'var(--muted)',
                  gap:4, opacity: activa ? 1 : 0.6 }}>
                <span style={{ fontSize:26, fontWeight:900, fontFamily:'var(--mono)',
                  color: activa ? 'var(--accent)' : 'var(--red)' }}>{num}</span>
                <span style={{ fontSize:9, letterSpacing:2,
                  color: activa ? 'var(--muted)' : 'var(--red)' }}>
                  {activa ? 'VER QR' : 'INACTIVA'}
                </span>
              </button>
              {/* Switch individual — solo visible si el global está ON */}
              {qrGlobal && (
                <button onClick={(e) => { e.stopPropagation(); toggleMesa(num) }}
                  title={activa ? 'Desactivar QR de esta mesa' : 'Activar QR de esta mesa'}
                  style={{
                    position:'absolute', top:6, right:6,
                    width:30, height:17, borderRadius:9, border:'none', cursor:'pointer',
                    background: activa ? 'var(--green)' : 'rgba(255,77,77,.5)',
                    padding:0
                  }}>
                  <div style={{
                    width:13, height:13, borderRadius:'50%', background:'white',
                    position:'absolute', top:2,
                    left: activa ? 15 : 2,
                    transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.3)'
                  }} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal QR */}
      {mesaSeleccionada && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.9)',
          zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'white', borderRadius:20, padding:28,
            width:'100%', maxWidth:340, textAlign:'center', color:'#111' }}>
            <div style={{ fontSize:13, color:'#666', letterSpacing:3,
              textTransform:'uppercase', marginBottom:4 }}>Mesa</div>
            <div style={{ fontSize:52, fontWeight:900, lineHeight:1, marginBottom:8 }}>
              {mesaSeleccionada}
            </div>
            {/* Estado dentro del modal */}
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:2, marginBottom:14,
              color: mesaActiva(mesaSeleccionada) ? '#27c97a' : '#ff4d4d' }}>
              {mesaActiva(mesaSeleccionada) ? '● QR ACTIVO' : '● QR DESACTIVADO'}
            </div>
            {mesaActiva(mesaSeleccionada) ? (
              <img src={getQrUrl(mesaSeleccionada)}
                alt={`QR Mesa ${mesaSeleccionada}`}
                style={{ width:220, height:220, borderRadius:12,
                  border:'3px solid #f5a623', marginBottom:16 }} />
            ) : (
              <div style={{ width:220, height:220, borderRadius:12,
                border:'3px solid #ff4d4d', marginBottom:16, background:'#fff0f0',
                display:'flex', flexDirection:'column', alignItems:'center',
                justifyContent:'center', margin:'0 auto 16px' }}>
                <div style={{ fontSize:48 }}>🚫</div>
                <div style={{ fontSize:12, color:'#ff4d4d', fontWeight:700, marginTop:8 }}>
                  QR desactivado
                </div>
              </div>
            )}
            <div style={{ fontSize:11, color:'#999', wordBreak:'break-all',
              background:'#f6f8fa', borderRadius:8, padding:'8px 12px', marginBottom:14 }}>
              {mesaUrl(mesaSeleccionada)}
            </div>
            {/* Toggle individual desde el modal */}
            {qrGlobal && (
              <button onClick={() => toggleMesa(mesaSeleccionada)}
                style={{ width:'100%',
                  background: mesaActiva(mesaSeleccionada) ? 'rgba(255,77,77,.1)' : 'rgba(39,201,122,.1)',
                  border:`2px solid ${mesaActiva(mesaSeleccionada) ? '#ff4d4d' : '#27c97a'}`,
                  color: mesaActiva(mesaSeleccionada) ? '#ff4d4d' : '#27c97a',
                  borderRadius:12, padding:'11px 0',
                  fontSize:13, fontWeight:800, cursor:'pointer', marginBottom:10, letterSpacing:1 }}>
                {mesaActiva(mesaSeleccionada) ? '🚫 Desactivar este QR' : '✅ Activar este QR'}
              </button>
            )}
            <button onClick={() => window.open(mesaUrl(mesaSeleccionada), '_blank')}
              style={{ width:'100%', background:'#f5a623', color:'#111',
                border:'none', borderRadius:12, padding:'13px 0',
                fontSize:14, fontWeight:800, cursor:'pointer', marginBottom:10, letterSpacing:2 }}>
              🔗 ABRIR ENLACE
            </button>
            <button onClick={() => setMesaSeleccionada(null)}
              style={{ width:'100%', background:'none', border:'2px solid #e0e0e0',
                color:'#666', borderRadius:12, padding:'12px 0',
                fontSize:14, fontWeight:700, cursor:'pointer' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
