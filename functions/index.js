const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()

const DEFAULT_PINS = { mesero: '1111', cocina: '2222', dueno: '3333' }
const ROLES = ['mesero', 'cocina', 'dueno']

function normId(id) {
  return String(id || '').trim().toLowerCase()
}

async function getResto(restoId) {
  const snap = await db.doc(`restaurantes/${restoId}`).get()
  if (!snap.exists) return { exists: false, suspendido: false }
  const d = snap.data()
  return { exists: true, suspendido: d.active === false || d.activo === false, data: d }
}

async function getAuthDoc(restoId) {
  const ref = db.doc(`restaurantes/${restoId}/config/auth`)
  const snap = await ref.get()
  return { ref, snap, exists: snap.exists, data: snap.exists ? snap.data() : null }
}

// ── Info pública para pantalla de login (sin PINs) ────────────────────
exports.obtenerInfoLogin = onCall(async (request) => {
  const restoId = normId(request.data?.restoId)
  if (!restoId) throw new HttpsError('invalid-argument', 'Falta restoId')

  const resto = await getResto(restoId)
  const auth = await getAuthDoc(restoId)
  if (!auth.exists) return { ok: false, error: 'Restaurante no encontrado' }

  const repartidores = (auth.data.repartidores || []).map(r => ({
    id: r.id, nombre: r.nombre, celular: r.celular || '',
  }))

  return {
    ok: true,
    nombre: auth.data.nombre || restoId,
    whatsapp: auth.data.whatsapp || '',
    repartidores,
    suspendido: resto.suspendido,
  }
})

// ── Login mesero / cocina / dueño ──────────────────────────────────────
exports.loginResto = onCall(async (request) => {
  const restoId = normId(request.data?.restoId)
  const role = request.data?.role
  const pin = String(request.data?.pin || '')
  if (!restoId || !ROLES.includes(role)) throw new HttpsError('invalid-argument', 'Datos inválidos')

  const resto = await getResto(restoId)
  if (resto.exists && resto.suspendido) {
    return { ok: false, suspendido: true, error: 'SUSPENDIDO' }
  }

  const auth = await getAuthDoc(restoId)
  if (!auth.exists) return { ok: false, error: 'Restaurante no encontrado' }

  const expected = auth.data.pins?.[role] || DEFAULT_PINS[role]
  if (pin !== expected) return { ok: false, error: 'PIN incorrecto' }

  const uid = `${restoId}__${role}`
  const token = await admin.auth().createCustomToken(uid, { restoId, role })
  return { ok: true, token, restoNombre: auth.data.nombre || restoId }
})

// ── Login repartidor ────────────────────────────────────────────────────
exports.loginRepartidor = onCall(async (request) => {
  const restoId = normId(request.data?.restoId)
  const repartidorId = request.data?.repartidorId
  const pin = String(request.data?.pin || '')
  if (!restoId || !repartidorId) throw new HttpsError('invalid-argument', 'Datos inválidos')

  const resto = await getResto(restoId)
  if (resto.exists && resto.suspendido) {
    return { ok: false, suspendido: true, error: 'SUSPENDIDO' }
  }

  const auth = await getAuthDoc(restoId)
  if (!auth.exists) return { ok: false, error: 'Restaurante no encontrado' }

  const rep = (auth.data.repartidores || []).find(r => r.id === repartidorId)
  if (!rep) return { ok: false, error: 'Repartidor no encontrado' }
  if (pin !== rep.pin) return { ok: false, error: 'PIN incorrecto' }

  const uid = `${restoId}__repartidor__${repartidorId}`
  const token = await admin.auth().createCustomToken(uid, { restoId, role: 'repartidor', repartidorId })
  return {
    ok: true, token,
    restoNombre: auth.data.nombre || restoId,
    repartidorNombre: rep.nombre,
    repartidorCelular: rep.celular || '',
  }
})

// ── Login super admin ────────────────────────────────────────────────────
exports.loginSuperAdmin = onCall(async (request) => {
  const pin = String(request.data?.pin || '')
  const snap = await db.doc('config/superadmin').get()
  if (!snap.exists) return { ok: false, error: 'Configuración no encontrada' }
  const expected = snap.data().pin
  if (!expected) return { ok: false, error: 'PIN no configurado' }
  if (pin !== expected) return { ok: false, error: 'PIN incorrecto' }

  const token = await admin.auth().createCustomToken('superadmin', { role: 'superadmin' })
  return { ok: true, token }
})

// ── Gestión de config/auth (PINs, repartidores, alta/edición/baja de resto) ──
exports.gestionarAuthResto = onCall(async (request) => {
  const claims = request.auth?.token
  if (!claims) throw new HttpsError('unauthenticated', 'Sesión requerida')

  const restoId = normId(request.data?.restoId)
  const accion = request.data?.accion
  const payload = request.data?.payload || {}
  if (!restoId || !accion) throw new HttpsError('invalid-argument', 'Datos inválidos')

  const esDuenoDeEsteResto = claims.restoId === restoId && claims.role === 'dueno'
  const esSuperAdmin = claims.role === 'superadmin'

  if (accion === 'setPins') {
    if (!esDuenoDeEsteResto) throw new HttpsError('permission-denied', 'No autorizado')
    const auth = await getAuthDoc(restoId)
    if (!auth.exists) throw new HttpsError('not-found', 'Restaurante no encontrado')
    const update = {}
    if (payload.pins) {
      const currentDuenoPin = auth.data.pins?.dueno || DEFAULT_PINS.dueno
      if (payload.currentPin !== currentDuenoPin) {
        return { ok: false, error: 'PIN actual incorrecto' }
      }
      const newPins = { ...(auth.data.pins || {}) }
      ROLES.forEach(k => {
        if (payload.pins[k] && /^\d{4}$/.test(payload.pins[k])) newPins[k] = payload.pins[k]
      })
      update.pins = newPins
    }
    if (typeof payload.whatsapp === 'string') update.whatsapp = payload.whatsapp.trim()
    await auth.ref.update(update)
    return { ok: true }
  }

  if (accion === 'addRepartidor') {
    if (!esDuenoDeEsteResto) throw new HttpsError('permission-denied', 'No autorizado')
    const nombre = String(payload.nombre || '').trim()
    const celular = String(payload.celular || '').trim()
    const pin = String(payload.pin || '')
    if (!nombre) throw new HttpsError('invalid-argument', 'El nombre es obligatorio')
    if (!celular) throw new HttpsError('invalid-argument', 'El celular es obligatorio')
    if (!/^\d{4}$/.test(pin)) throw new HttpsError('invalid-argument', 'PIN de 4 dígitos requerido')
    const auth = await getAuthDoc(restoId)
    if (!auth.exists) throw new HttpsError('not-found', 'Restaurante no encontrado')
    const repartidores = auth.data.repartidores || []
    if (repartidores.some(r => r.pin === pin)) {
      return { ok: false, error: 'Ese PIN ya lo usa otro repartidor' }
    }
    const nuevo = [...repartidores, { nombre, celular, pin, id: Date.now().toString() }]
    await auth.ref.update({ repartidores: nuevo })
    return { ok: true }
  }

  if (accion === 'removeRepartidor') {
    if (!esDuenoDeEsteResto) throw new HttpsError('permission-denied', 'No autorizado')
    const auth = await getAuthDoc(restoId)
    if (!auth.exists) throw new HttpsError('not-found', 'Restaurante no encontrado')
    const nuevo = (auth.data.repartidores || []).filter(r => r.id !== payload.id)
    await auth.ref.update({ repartidores: nuevo })
    return { ok: true }
  }

  if (accion === 'adminCreate') {
    if (!esSuperAdmin) throw new HttpsError('permission-denied', 'No autorizado')
    const ref = db.doc(`restaurantes/${restoId}/config/auth`)
    await ref.set({
      nombre: payload.nombre || restoId,
      whatsapp: payload.whatsapp || '',
      pins: payload.pins || { ...DEFAULT_PINS },
      repartidores: payload.repartidores || [],
    })
    return { ok: true }
  }

  if (accion === 'adminUpdate') {
    if (!esSuperAdmin) throw new HttpsError('permission-denied', 'No autorizado')
    const auth = await getAuthDoc(restoId)
    if (!auth.exists) throw new HttpsError('not-found', 'Restaurante no encontrado')
    const update = {}
    if (payload.nombre !== undefined) update.nombre = payload.nombre
    if (payload.whatsapp !== undefined) update.whatsapp = payload.whatsapp
    if (payload.pins !== undefined) update.pins = { ...(auth.data.pins || {}), ...payload.pins }
    await auth.ref.update(update)
    return { ok: true }
  }

  if (accion === 'adminDelete') {
    if (!esSuperAdmin) throw new HttpsError('permission-denied', 'No autorizado')
    await db.doc(`restaurantes/${restoId}/config/auth`).delete().catch(() => {})
    return { ok: true }
  }

  throw new HttpsError('invalid-argument', 'Acción desconocida')
})

// ── Listado de restaurantes para AdminPanel (sin PINs) ─────────────────
exports.adminListarRestos = onCall(async (request) => {
  const claims = request.auth?.token
  if (!claims || claims.role !== 'superadmin') {
    throw new HttpsError('permission-denied', 'No autorizado')
  }
  const snap = await db.collection('restaurantes').get()
  const restos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  return { ok: true, restos }
})
