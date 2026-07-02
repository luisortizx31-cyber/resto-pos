import { auth, functions } from './firebase'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'

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
  signOut(auth).catch(() => {})
}
export function isSuperAdmin() { return localStorage.getItem('resto_superadmin') === 'true' }
export function canAccess(role, page) { return PERMS[role]?.includes(page) ?? false }

export async function obtenerInfoLogin(restoId) {
  try {
    const fn = httpsCallable(functions, 'obtenerInfoLogin')
    const res = await fn({ restoId })
    return res.data
  } catch { return { ok: false, error: 'Error de conexión' } }
}

export async function loginSuperAdmin(pin) {
  try {
    const fn = httpsCallable(functions, 'loginSuperAdmin')
    const res = await fn({ pin })
    if (!res.data.ok) return { ok: false, error: res.data.error }
    await signInWithCustomToken(auth, res.data.token)
    localStorage.setItem('resto_superadmin', 'true')
    return { ok: true }
  } catch { return { ok: false, error: 'Error de conexión' } }
}

export async function loginResto(restoId, role, pin) {
  try {
    const fn = httpsCallable(functions, 'loginResto')
    const res = await fn({ restoId, role, pin })
    if (!res.data.ok) {
      return { ok: false, error: res.data.error, suspendido: res.data.suspendido }
    }
    await signInWithCustomToken(auth, res.data.token)
    saveSession(restoId, role, { restoNombre: res.data.restoNombre })
    return { ok: true }
  } catch { return { ok: false, error: 'Error de conexión' } }
}

export async function loginRepartidor(restoId, repartidorId, pin) {
  try {
    const fn = httpsCallable(functions, 'loginRepartidor')
    const res = await fn({ restoId, repartidorId, pin })
    if (!res.data.ok) {
      return { ok: false, error: res.data.error, suspendido: res.data.suspendido }
    }
    await signInWithCustomToken(auth, res.data.token)
    saveSession(restoId, 'repartidor', {
      restoNombre: res.data.restoNombre,
      repartidorNombre: res.data.repartidorNombre,
      repartidorId,
      repartidorCelular: res.data.repartidorCelular,
    })
    return { ok: true }
  } catch { return { ok: false, error: 'Error de conexión' } }
}
