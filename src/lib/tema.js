// ── Tema de la app del personal: oscuro (noche), claro (día) o automático ──
// Se guarda por dispositivo: cada celular/tablet elige el suyo.

export const TEMAS = [
  { id: 'auto',   icon: '🌓', label: 'Auto',   desc: 'Claro de 6 a.m. a 6 p.m., oscuro de noche' },
  { id: 'claro',  icon: '☀️', label: 'Día',    desc: 'Fondo claro, mejor con mucha luz' },
  { id: 'oscuro', icon: '🌙', label: 'Noche',  desc: 'Fondo oscuro, cansa menos la vista de noche' },
]

const CLAVE = 'gastro_tema'

export function getTema() {
  try { return localStorage.getItem(CLAVE) || 'oscuro' } catch { return 'oscuro' }
}

function esDeDia() {
  const h = new Date().getHours()
  return h >= 6 && h < 18
}

export function aplicarTema() {
  const tema = getTema()
  const claro = tema === 'claro' || (tema === 'auto' && esDeDia())
  if (claro) document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
}

export function setTema(tema) {
  try { localStorage.setItem(CLAVE, tema) } catch {}
  aplicarTema()
}

// En modo auto, revisar cada minuto si cambió de día a noche
export function iniciarTema() {
  aplicarTema()
  setInterval(aplicarTema, 60 * 1000)
}
