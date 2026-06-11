import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Login from './pages/Login'
import Mesas from './pages/Mesas'
import Pedido from './pages/Pedido'
import Cocina from './pages/Cocina'
import Historial from './pages/Historial'
import Menu from './pages/Menu'
import Stats from './pages/Stats'
import QRMesas from './pages/QRMesas'
import Config from './pages/Config'
import ClienteMesa from './pages/ClienteMesa'
import Delivery from './pages/Delivery'
import Repartidor from './pages/Repartidor'
import AdminPanel from './pages/AdminPanel'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight:'100vh', background:'#0d1117', color:'white',
          fontFamily:'monospace', display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
          <div style={{ fontSize:18, fontWeight:700, color:'#f5a623', marginBottom:12 }}>
            Error al cargar la aplicación
          </div>
          <div style={{ fontSize:13, color:'#8b949e', maxWidth:400, lineHeight:1.6, marginBottom:20 }}>
            {this.state.error.message}
          </div>
          <button onClick={() => window.location.reload()}
            style={{ background:'#f5a623', color:'#111', border:'none', borderRadius:10,
              padding:'12px 24px', fontSize:14, fontWeight:800, cursor:'pointer' }}>
            🔄 Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* Rutas públicas */}
          <Route path="/cliente/:restoId/mesa/:num" element={<ClienteMesa />} />
          <Route path="/delivery/:restoId"           element={<Delivery />} />
          <Route path="/login"                       element={<Login />} />
          <Route path="/admin"                       element={<AdminPanel />} />

          {/* App interna */}
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/mesas" replace />} />
            <Route path="mesas"        element={<Mesas />} />
            <Route path="pedido/:mesa" element={<Pedido />} />
            <Route path="cocina"       element={<Cocina />} />
            <Route path="historial"    element={<Historial />} />
            <Route path="stats"        element={<Stats />} />
            <Route path="menu"         element={<Menu />} />
            <Route path="qr"           element={<QRMesas />} />
            <Route path="config"       element={<Config />} />
            <Route path="repartidor"   element={<Repartidor />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
