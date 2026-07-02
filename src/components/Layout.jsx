import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState, createContext, useContext, useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { getSession, clearSession, canAccess, saveLastRestoId } from '../lib/auth'

export const ToastContext   = createContext(null)
export const SessionContext = createContext(null)
export const useToast       = () => useContext(ToastContext)
export const useSession     = () => useContext(SessionContext)

export default function Layout() {
  const [toasts, setToasts]     = useState([])
  const [session, setSession]   = useState(null)
  const [checked, setChecked]   = useState(false)   // ← evita flash negro
  const location  = useLocation()
  const navigate  = useNavigate()
  const isPedido  = location.pathname.startsWith('/pedido')
  const isConfig  = location.pathname.startsWith('/config')

  useEffect(() => {
    const s = getSession()
    if (!s) {
      navigate('/login', { replace: true })
      setChecked(true)
      return
    }
    // Esperar a que Firebase Auth restaure la sesión (custom token) antes
    // de habilitar las lecturas autenticadas de las páginas internas — si
    // no, justo tras refrescar la página hay un instante donde request.auth
    // todavía es null y las lecturas fallan con permission-denied antes de
    // que la sesión termine de restaurarse.
    const unsub = onAuthStateChanged(auth, user => {
      if (!user) {
        clearSession()
        navigate('/login', { replace: true })
        setChecked(true)
        return
      }
      setSession(s)
      setChecked(true)
      // Redirigir a ruta correcta según rol si carga raíz
      const path = location.pathname
      if (path === '/' || path === '') {
        if (s.role === 'cocina')          navigate('/cocina',      { replace: true })
        else if (s.role === 'repartidor') navigate('/repartidor',  { replace: true })
        else                              navigate('/mesas',       { replace: true })
      }
    })
    return () => unsub()
  }, [])   // solo al montar

  const showToast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  const handleLogout = () => {
    const s = getSession()
    if (s?.restoId) saveLastRestoId(s.restoId)
    clearSession()
    navigate('/login')
  }

  // No renderizar nada hasta verificar sesión → evita pantalla negra
  if (!checked) return null

  // Sin sesión → ya redirigimos, nada que mostrar
  if (!session) return null

  const role = session.role
  const navItems = [
    { to:'/mesas',     icon:'🍽', label:'Mesas',     page:'mesas' },
    { to:'/cocina',    icon:'🍳', label:'Cocina',     page:'cocina' },
    { to:'/historial', icon:'📋', label:'Historial',  page:'historial' },
    { to:'/stats',     icon:'📊', label:'Stats',      page:'stats' },
    { to:'/menu',      icon:'✏️', label:'Menú',       page:'menu' },
    { to:'/qr',        icon:'📲', label:'QR',         page:'qr' },
    { to:'/config',    icon:'⚙️', label:'Config',     page:'config' },
  ].filter(item => canAccess(role, item.page))

  return (
    <ToastContext.Provider value={showToast}>
      <SessionContext.Provider value={session}>
        <div style={{ minHeight:'100vh', background:'var(--bg)' }}>
          <Outlet />
          {!isPedido && !isConfig && (
            <nav className="nav">
              {navItems.map(item => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
              <button className="nav-item" onClick={handleLogout}
                style={{ border:'none', background:'none' }}>
                <span className="nav-icon">🚪</span>
                Salir
              </button>
            </nav>
          )}
          <div style={{ textAlign:'center', fontSize:10, color:'var(--muted)',
            letterSpacing:1, opacity:.35, padding:'6px 0 80px',
            fontFamily:'var(--font)' }}>
            © 2026 GastroFlow · Luis Alberto Ortiz Jauregui
          </div>
          <div className="toast-container">
            {toasts.map(t => (
              <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
            ))}
          </div>
        </div>
      </SessionContext.Provider>
    </ToastContext.Provider>
  )
}
