// ── Utilidades compartidas ────────────────────────────────────────
import { useEffect, useState } from 'react'
import { collection, doc, getDocs, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

/** Formatea ISO → "h:mm AM/PM" */
export function fmt12(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  let h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Formatea ISO → "d/m h:mm AM/PM" (para historial) */
export function fmt12Date(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  let h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${d.getDate()}/${d.getMonth() + 1} ${h}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Fusiona items de varios pedidos sumando cantidades */
export function mergeItems(orders) {
  const map = {}
  orders.forEach(([, o]) => {
    ;(o.items || []).forEach(item => {
      // Usar name+price como key para que variantes del mismo plato con diferente precio no se fusionen
      const k = `${item.name}__${item.price}`
      if (map[k]) map[k] = { ...map[k], qty: map[k].qty + item.qty }
      else map[k] = { ...item }
    })
  })
  return Object.values(map)
}

/** Fusiona items de un array plano de pedidos (para Delivery) */
export function mergeItemsFlat(pedidos) {
  const map = {}
  pedidos.forEach(p => {
    ;(p.items || []).forEach(item => {
      const k = item.id || item.name
      if (map[k]) map[k] = { ...map[k], qty: map[k].qty + item.qty }
      else map[k] = { ...item }
    })
  })
  return Object.values(map)
}

/** Categorías de bebidas (para excluir de cocina) */
export const BEBIDAS_CAT = ['bebidas', 'bebida', 'drinks', 'drink']

// Categorías que el dueño marcó como bebida en Menú → Categorías (config/categorias.bebidas)
let bebidasMarcadas = new Set()
const normCat = (c) => (c || '').toLowerCase().trim()

/** ¿Este item es bebida? (no se prepara en cocina) */
export function esBebida(item) {
  const c = normCat(item?.category)
  return BEBIDAS_CAT.includes(c) || bebidasMarcadas.has(c)
}

/** ¿Todos los items son bebidas? */
export function esSoloBebidas(items) {
  return items.length > 0 && items.every(esBebida)
}

/** Carga (en vivo) las categorías marcadas como bebida. Llamar una vez por página. */
export function useCategoriasBebida(restoId) {
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!restoId) return
    return onSnapshot(doc(db, 'restaurantes', restoId, 'config', 'categorias'), snap => {
      bebidasMarcadas = new Set((snap.exists() ? snap.data().bebidas || [] : []).map(normCat))
      setVersion(v => v + 1)
    }, () => {})
  }, [restoId])
}

/**
 * Vuelve a poner el precio y la categoría reales del menú en items que mandó un
 * cliente (QR / delivery). El precio viene del celular del cliente y podría
 * estar alterado. Devuelve { items, cambiados } con los nombres corregidos.
 */
export async function repreciarItems(restoId, items) {
  const snap = await getDocs(collection(db, 'restaurantes', restoId, 'menu'))
  const menu = {}
  snap.forEach(d => { menu[d.id] = d.data() })
  const cambiados = []
  const nuevos = (items || []).map(item => {
    const m = menu[item.id]
    if (!m) return item
    let precio = Number(m.price)
    if (m.variantes?.length) {
      const v = m.variantes.find(v => `${m.name} (${v.nombre})` === item.name)
      if (!v) return item
      precio = Number(v.precio)
    }
    if (!Number.isFinite(precio)) return item
    if (precio !== Number(item.price)) cambiados.push(item.name)
    return { ...item, price: precio, category: m.category || item.category || '' }
  })
  return { items: nuevos, cambiados }
}
