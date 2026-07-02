import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

/** Comprime una imagen a WebP intentando quedar entre ~10-40KB */
export async function comprimirImagenWebp(file, { targetMaxBytes = 40 * 1024, maxDim = 800 } = {}) {
  const bitmap = await createImageBitmap(file)
  let width = bitmap.width
  let height = bitmap.height
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  let quality = 0.8
  let blob = null
  for (let i = 0; i < 7; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) break
    if (blob.size <= targetMaxBytes) break
    if (quality > 0.35) quality -= 0.15
    else { width = Math.round(width * 0.85); height = Math.round(height * 0.85) }
  }
  return blob
}

/** Comprime y sube la foto de un plato a Storage, devuelve la URL pública */
export async function subirFotoMenu(restoId, itemId, file) {
  const blob = await comprimirImagenWebp(file)
  if (!blob) throw new Error('No se pudo procesar la imagen')
  const nombre = `${itemId || Date.now()}_${Math.random().toString(36).slice(2, 7)}.webp`
  const storageRef = ref(storage, `restaurantes/${restoId}/menu/${nombre}`)
  await uploadBytes(storageRef, blob, { contentType: 'image/webp' })
  return getDownloadURL(storageRef)
}
