// ── Utilidades compartidas ────────────────────────────────────────

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
      const k = item.id || item.name
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

/** ¿Todos los items son bebidas? */
export function esSoloBebidas(items) {
  return items.length > 0 && items.every(i =>
    BEBIDAS_CAT.includes((i.category || '').toLowerCase().trim())
  )
}
