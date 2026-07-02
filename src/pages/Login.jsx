import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginResto, loginRepartidor, loginSuperAdmin, obtenerInfoLogin, ROLE_INFO, getSession, getLastRestoId, saveLastRestoId } from '../lib/auth'

const MAX_INTENTOS = 3

function roleToPath(role) {
  if (role === 'cocina')     return '/cocina'
  if (role === 'repartidor') return '/repartidor'
  return '/mesas'
}

export default function Login() {
  const [restoId, setRestoId]         = useState(getLastRestoId)
  const [step, setStep]               = useState('id')   // 'id' | 'rol' | 'pin' | 'rep_select'
  const [role, setRole]               = useState(null)
  const [pin, setPin]                 = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [superPin, setSuperPin]       = useState('')
  const [showSuper, setShowSuper]     = useState(false)
  const [nombreResto, setNombreResto] = useState('')
  const [intentos, setIntentos]       = useState(0)
  // Para repartidores
  const [repartidores, setRepartidores] = useState([])
  const [repSeleccionado, setRepSeleccionado] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const session = getSession()
    if (session?.role && session?.restoId) {
      navigate(roleToPath(session.role), { replace: true })
    }
  }, [])

  const handleId = async () => {
    if (!restoId.trim()) { setError('Ingresa el código del restaurante'); return }
    setLoading(true); setError('')
    try {
      const res = await obtenerInfoLogin(restoId.trim().toLowerCase())
      if (!res.ok) { setError('❌ Restaurante no encontrado.'); setLoading(false); return }
      setNombreResto(res.nombre || restoId)
      setRepartidores(res.repartidores || [])
      setIntentos(0)
      setStep('rol')
    } catch { setError('Error de conexión. Intenta de nuevo.') }
    setLoading(false)
  }

  const handleRole = (r) => {
    setRole(r)
    setPin('')
    setError('')
    if (r === 'repartidor') {
      // Mostrar selector de repartidor en vez del PIN genérico
      setRepSeleccionado(null)
      setStep('rep_select')
    } else {
      setStep('pin')
    }
  }

  const handlePin = async (digit) => {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError('')
    if (next.length === 4) {
      setLoading(true)
      setTimeout(async () => {
        const res = role === 'repartidor' && repSeleccionado
          ? await loginRepartidor(restoId.trim().toLowerCase(), repSeleccionado.id, next)
          : await loginResto(restoId.trim().toLowerCase(), role, next)
        if (res.ok) {
          saveLastRestoId(restoId.trim().toLowerCase())
          navigate(roleToPath(role), { replace: true })
        } else if (res.suspendido) {
          setError('🚫 Este restaurante está suspendido. Contacta al administrador.')
          setPin(''); setStep('id'); setLoading(false); return
        } else {
          const nuevosIntentos = intentos + 1
          setIntentos(nuevosIntentos)
          if (nuevosIntentos >= MAX_INTENTOS) {
            setError('🔒 Demasiados intentos fallidos. Contacta al administrador.')
            setPin(''); setLoading(false); return
          }
          setError(`PIN incorrecto. ${MAX_INTENTOS - nuevosIntentos} intento(s) restante(s).`)
          setPin('')
        }
        setLoading(false)
      }, 200)
    }
  }

  const handleSuperAdmin = async () => {
    setLoading(true)
    const res = await loginSuperAdmin(superPin)
    if (res.ok) {
      navigate('/admin')
    } else {
      setError(res.error || 'PIN incorrecto')
      setSuperPin('')
    }
    setLoading(false)
  }

  const ROLES_DISPLAY = ['mesero', 'cocina', 'dueno', 'repartidor']

  // ── STEP: INGRESO ID ─────────────────────────────────────────────
  if (step === 'id') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>🍽</div>
          <div style={{ fontSize:28, fontWeight:900, letterSpacing:3, color:'var(--accent)' }}>GASTROFLOW</div>
          <div style={{ fontSize:12, color:'var(--muted)', letterSpacing:4, marginTop:4 }}>POS RESTAURANTE</div>
        </div>
        <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:2,
          textTransform:'uppercase', marginBottom:8 }}>Código del restaurante</div>
        <input className="input" value={restoId}
          onChange={e => setRestoId(e.target.value.toLowerCase())}
          onKeyDown={e => e.key==='Enter' && handleId()}
          placeholder="Ej: mirestaurante"
          style={{ marginBottom:16 }} />
        {error && <div style={{ color:'var(--red)', fontSize:13, marginBottom:12 }}>{error}</div>}
        <button className="btn btn-primary"
          style={{ width:'100%', padding:16, fontSize:15, letterSpacing:2 }}
          disabled={loading} onClick={handleId}>
          {loading ? 'BUSCANDO...' : 'CONTINUAR →'}
        </button>
        {/* Super admin oculto */}
        <div style={{ marginTop:40, borderTop:'1px solid var(--border)', paddingTop:20 }}>
          {!showSuper ? (
            <button onClick={() => setShowSuper(true)}
              style={{ background:'none', border:'none', color:'var(--muted)',
                fontSize:11, cursor:'pointer', width:'100%', letterSpacing:2, fontFamily:'var(--font)' }}>
              ···
            </button>
          ) : (
            <div style={{ display:'flex', gap:8 }}>
              <input className="input" type="number" placeholder="PIN super admin"
                value={superPin} onChange={e => setSuperPin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSuperAdmin()}
                style={{ flex:1 }} />
              <button className="btn btn-primary" style={{ padding:'0 18px' }}
                onClick={handleSuperAdmin} disabled={loading}>→</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // ── STEP: SELECCIÓN DE ROL ────────────────────────────────────────
  if (step === 'rol') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:22, fontWeight:900, color:'var(--accent)', letterSpacing:2 }}>
            {nombreResto.toUpperCase()}
          </div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:4, letterSpacing:2 }}>¿QUIÉN ERES?</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {ROLES_DISPLAY.map(key => {
            const info = ROLE_INFO[key]
            return (
              <button key={key} onClick={() => handleRole(key)}
                style={{ background:'var(--card)', border:'2px solid var(--border)',
                  borderRadius:18, padding:'22px 12px', display:'flex',
                  flexDirection:'column', alignItems:'center', gap:8,
                  cursor:'pointer', transition:'all .15s', fontFamily:'var(--font)',
                  color:'var(--text)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = info.color; e.currentTarget.style.background = `${info.color}15` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--card)' }}>
                <span style={{ fontSize:34 }}>{info.emoji}</span>
                <span style={{ fontSize:13, fontWeight:800, letterSpacing:1 }}>{info.label.toUpperCase()}</span>
              </button>
            )
          })}
        </div>
        <button onClick={() => setStep('id')} className="btn btn-ghost"
          style={{ width:'100%', marginTop:20, padding:12 }}>← Cambiar restaurante</button>
      </div>
    </div>
  )

  // ── STEP: SELECTOR DE REPARTIDOR ─────────────────────────────────
  if (step === 'rep_select') return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>🛵</div>
          <div style={{ fontSize:18, fontWeight:900, letterSpacing:2 }}>SELECCIONA TU NOMBRE</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>{nombreResto}</div>
        </div>
        {repartidores.length === 0 ? (
          <div style={{ textAlign:'center', color:'var(--muted)', padding:'20px 0', lineHeight:1.7 }}>
            No hay repartidores registrados.<br/>Pide al dueño que los configure.
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
            {repartidores.map(r => (
              <button key={r.id} onClick={() => { setRepSeleccionado(r); setPin(''); setStep('pin') }}
                style={{ background: repSeleccionado?.id===r.id ? 'rgba(39,201,122,.1)' : 'var(--card)',
                  border: `2px solid ${repSeleccionado?.id===r.id ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius:14, padding:'16px 18px', display:'flex',
                  alignItems:'center', gap:14, cursor:'pointer',
                  fontFamily:'var(--font)', color:'var(--text)', textAlign:'left' }}>
                <span style={{ fontSize:28 }}>🛵</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>{r.nombre}</div>
                  {r.celular && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>📱 {r.celular}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
        {error && <div style={{ color:'var(--red)', fontSize:13, marginBottom:12 }}>{error}</div>}
        <button onClick={() => setStep('rol')} className="btn btn-ghost"
          style={{ width:'100%', padding:12 }}>← Volver</button>
      </div>
    </div>
  )

  // ── STEP: PIN ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>
            {role === 'repartidor' ? '🛵' : ROLE_INFO[role]?.emoji}
          </div>
          <div style={{ fontSize:18, fontWeight:900, letterSpacing:2 }}>
            {role === 'repartidor' && repSeleccionado ? repSeleccionado.nombre.toUpperCase() : ROLE_INFO[role]?.label.toUpperCase()}
          </div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:4, letterSpacing:2 }}>INGRESA TU PIN</div>
        </div>
        {/* Indicador PIN */}
        <div style={{ display:'flex', gap:12, justifyContent:'center', marginBottom:28 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width:18, height:18, borderRadius:'50%',
              background: i < pin.length ? 'var(--accent)' : 'var(--surface)',
              border:'2px solid var(--border)', transition:'all .15s' }} />
          ))}
        </div>
        {/* Teclado */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
            <button key={i} onClick={() => {
              if (d === '⌫') { setPin(p => p.slice(0,-1)); setError('') }
              else if (d) handlePin(d)
            }}
              style={{ padding:'18px 0', background: d ? 'var(--card)' : 'transparent',
                border: d ? '1.5px solid var(--border)' : 'none',
                borderRadius:14, fontSize:22, fontWeight:700, cursor: d ? 'pointer' : 'default',
                color:'var(--text)', fontFamily:'var(--mono)',
                opacity: loading ? .5 : 1 }}
              disabled={loading || !d}>
              {d}
            </button>
          ))}
        </div>
        {loading && (
          <div style={{ textAlign:'center', color:'var(--muted)', fontSize:13, marginBottom:12 }}>
            Verificando...
          </div>
        )}
        {error && <div style={{ color:'var(--red)', fontSize:13, textAlign:'center', marginBottom:12 }}>{error}</div>}
        <button onClick={() => {
          setPin(''); setError(''); setIntentos(0)
          setStep(role === 'repartidor' ? 'rep_select' : 'rol')
        }} className="btn btn-ghost" style={{ width:'100%', padding:12 }}>← Volver</button>
      </div>
    </div>
  )
}
