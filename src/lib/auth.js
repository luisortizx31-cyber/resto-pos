import { db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'

export const PERMS = {
  mesero:     ['mesas', 'pedido', 'qr'],
  cocina:     ['cocina'],
  dueno:      ['mesas', 'pedido', 'cocina', 'historial', 'menu', 'stats', 'qr', 'config'],
  repartidor: ['repartidor'],
  superadmin: ['admin'],
}

export const ROLE_INFO = {
  mesero:     { label: 'Mesero',     emoji: '🍽', color: '#f5a623' },
  cocina:     { label: 'Cocina',     emoji: '🍳', color: '#e8521a' },
  dueno:      { label: 'Dueño',      emoji: '👑', color: '#4a9eff' },
  repartidor: { label: 'Repartidor', emoji: '🛵', color: '#27c97a' },
}

export function getSession() {
  try { const s = localStorage.getItem('resto_session'); return s ? JSON.parse(s) : null }
  catch { return null }
}
export function saveSession(restoId, role, extra = {}) {
  localStorage.setItem('resto_session', JSON.stringify({ restoId, role, ...extra }))
}
export function saveLastRestoId(restoId) { localStorage.setItem('resto_last_id', restoId) }
export function getLastRestoId() { return localStorage.getItem('resto_last_id') || '' }
export function clearSession() {
  localStorage.removeItem('resto_session')
  localStorage.removeItem('resto_superadmin')
}
export function isSuperAdmin() { return localStorage.getItem('resto_superadmin') === 'true' }
export function canAccess(role, page) { return PERMS[role]?.includes(page) ?? false }

export async function loginSuperAdmin(pin) {
  try {
    const snap = await getDoc(doc(db, 'config', 'superadmin'))
    if (!snap.exists()) return { ok: false, error: 'Configuración no encontrada' }
    const expected = snap.data().pin
    if (!expected) return { ok: false, error: 'PIN no configurado' }
    if (pin === expected) { localStorage.setItem('resto_superadmin', 'true'); return { ok: true } }
    return { ok: false, error: 'PIN incorrecto' }
  } catch { return { ok: false, error: 'Error de conexión' } }
}

export async function loginResto(restoId, role, pin) {
  try {
    // 1. Verificar que el restaurante esté activo (campo canónico: active)
    const restoSnap = await getDoc(doc(db, 'restaurantes', restoId))
    if (restoSnap.exists()) {
      const d = restoSnap.data()
      // Soportar tanto 'active' como 'activo' por compatibilidad con datos legacy
      if (d.active === false || d.activo === false) {
        return { ok: false, error: 'SUSPENDIDO', suspendido: true }
      }
    }

    // 2. Validar PIN
    const snap = await getDoc(doc(db, 'restaurantes', restoId, 'config', 'auth'))
    if (!snap.exists()) return { ok: false, error: 'Restaurante no encontrado' }
    const pins = snap.data().pins || {}
    const defaultPins = { mesero: '1111', cocina: '2222', dueno: '3333' }
    const expected = pins[role] || defaultPins[role]
    if (pin === expected) {
      const extra = { restoNombre: snap.data().nombre || restoId }
      saveSession(restoId, role, extra)
      return { ok: true }
    }
    return { ok: false, error: 'PIN incorrecto' }
  } catch { return { ok: false, error: 'Error de conexión' } }
}
