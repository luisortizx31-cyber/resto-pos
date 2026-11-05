// ── Clientes habituales: agenda, visitas y mensajes de WhatsApp ───────────
// Firestore: restaurantes/{restoId}/clientes/{id}
//   id = 'tel_<teléfono normalizado>' si tiene teléfono (así no se duplica
//   cuando el mismo cliente vuelve por delivery o en mesa), o uno automático.
import { db } from './firebase'
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction,
} from 'firebase/firestore'

const col = (restoId) => collection(db, 'restaurantes', restoId, 'clientes')

/** Teléfono solo dígitos, con 51 delante si es un celular peruano de 9 dígitos */
export function normTelefono(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  if (d.length === 9 && d.startsWith('9')) return '51' + d
  return d
}

export function idCliente(tel) {
  const d = normTelefono(tel)
  return d.length >= 7 ? `tel_${d}` : null
}

/** Días desde una fecha ISO (null si no hay fecha) */
export function diasDesde(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export function textoHace(iso) {
  const d = diasDesde(iso)
  if (d === null) return 'Sin visitas'
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Ayer'
  if (d < 30) return `Hace ${d} días`
  const m = Math.floor(d / 30)
  return m === 1 ? 'Hace 1 mes' : `Hace ${m} meses`
}

export const DIAS_POR_RECUPERAR = 30
export const VISITAS_FRECUENTE  = 5

export function cumpleEsteMes(c) {
  if (!c.cumple) return false
  return Number(c.cumple.split('-')[0]) === new Date().getMonth() + 1
}

export async function listarClientes(restoId) {
  const snap = await getDocs(col(restoId))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/** Crea o actualiza un cliente. `cumple` = 'MM-DD' o '' */
export async function guardarCliente(restoId, { nombre, telefono, cumple, notas }, idExistente) {
  const data = {
    nombre: nombre.trim(),
    telefono: normTelefono(telefono),
    cumple: cumple || '',
    notas: (notas || '').trim(),
    actualizadoEn: new Date().toISOString(),
  }
  if (idExistente) {
    await updateDoc(doc(col(restoId), idExistente), data)
    return idExistente
  }
  const id = idCliente(telefono)
  const ref = id ? doc(col(restoId), id) : doc(col(restoId))
  // merge: si ya existía con ese teléfono (p. ej. vino por delivery), no se pierden sus visitas
  await setDoc(ref, { ...data, creadoEn: new Date().toISOString() }, { merge: true })
  return ref.id
}

export async function eliminarCliente(restoId, id) {
  await deleteDoc(doc(col(restoId), id))
}

/**
 * Suma una visita al cliente (lo crea si no existe y tiene teléfono).
 * `ref` evita contar dos veces el mismo pedido de delivery.
 */
export async function registrarVisita(restoId, cliente, { total = 0, tipo = 'mesa', ref = null } = {}) {
  const id = cliente.id || idCliente(cliente.telefono)
  if (!id) return null
  const docRef = doc(col(restoId), id)
  const ahora = new Date().toISOString()
  await runTransaction(db, async (t) => {
    const snap = await t.get(docRef)
    const d = snap.exists() ? snap.data() : {}
    const ultimas = d.ultimasVisitas || []
    if (ref && ultimas.some(v => v.ref === ref)) return
    const visita = { fecha: ahora, total: Number(total) || 0, tipo, ...(ref ? { ref } : {}) }
    t.set(docRef, {
      nombre: d.nombre || (cliente.nombre || '').trim() || 'Cliente',
      telefono: d.telefono || normTelefono(cliente.telefono),
      visitas: (d.visitas || 0) + 1,
      totalGastado: Math.round(((d.totalGastado || 0) + visita.total) * 100) / 100,
      ultimaVisita: ahora,
      primeraVisita: d.primeraVisita || ahora,
      ultimasVisitas: [visita, ...ultimas].slice(0, 10),
      ...(snap.exists() ? {} : { creadoEn: ahora, cumple: '', notas: '' }),
    }, { merge: true })
  })
  return id
}

/** Para los pedidos de delivery: registra la visita usando su nombre y teléfono */
export function registrarVisitaDelivery(restoId, pedido, total) {
  const telefono = pedido.telefonoCliente || pedido.cliente?.telefono || pedido.telefono || ''
  if (!idCliente(telefono)) return Promise.resolve(null)
  return registrarVisita(restoId,
    { nombre: pedido.cliente?.nombre || pedido.nombre || '', telefono },
    { total: total ?? pedido.total ?? 0, tipo: 'delivery', ref: pedido.key || null })
}

export async function marcarMensaje(restoId, id, plantilla) {
  await updateDoc(doc(col(restoId), id), {
    ultimoMensaje: new Date().toISOString(),
    ultimoMensajeTipo: plantilla,
  })
}

// ── Plantillas de WhatsApp ({nombre} y {restaurante} se reemplazan) ──────
export const PLANTILLAS = [
  { id: 'extranamos', icon: '💛', label: 'Te extrañamos',
    texto: '¡Hola {nombre}! 👋 Te extrañamos en {restaurante}. Hace tiempo que no vienes y nos encantaría volver a atenderte. ¡Te esperamos pronto! 🍽️' },
  { id: 'cumple', icon: '🎂', label: 'Cumpleaños',
    texto: '¡Feliz cumpleaños, {nombre}! 🎂🎉 Todo el equipo de {restaurante} te desea un día increíble. Ven a celebrarlo con nosotros, ¡te esperamos!' },
  { id: 'promo', icon: '🔥', label: 'Promoción',
    texto: '¡Hola {nombre}! 🔥 Esta semana en {restaurante} tenemos algo especial para ti: [escribe aquí tu promoción]. ¡Te esperamos!' },
  { id: 'gracias', icon: '🙌', label: 'Gracias',
    texto: '¡Gracias por visitarnos, {nombre}! 🙌 Fue un gusto atenderte en {restaurante}. ¡Vuelve pronto!' },
]

export function armarMensaje(plantilla, cliente, restaurante) {
  const primerNombre = (cliente.nombre || '').trim().split(/\s+/)[0] || ''
  return plantilla.texto
    .replaceAll('{nombre}', primerNombre)
    .replaceAll('{restaurante}', restaurante || 'nuestro restaurante')
}

export function linkWhatsapp(telefono, texto) {
  return `https://wa.me/${normTelefono(telefono)}?text=${encodeURIComponent(texto)}`
}
