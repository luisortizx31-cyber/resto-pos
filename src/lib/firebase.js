import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

// Verifica que las variables de entorno estén definidas
const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = required.filter(k => !import.meta.env[k])
if (missing.length > 0) {
  // Mostrar error legible en lugar de pantalla negra
  document.getElementById('root').innerHTML = `
    <div style="min-height:100vh;background:#0c0b0a;color:white;display:flex;flex-direction:column;
      align-items:center;justify-content:center;padding:24px;text-align:center;font-family:monospace;">
      <div style="font-size:48px;margin-bottom:16px">⚙️</div>
      <div style="font-size:20px;font-weight:700;color:#f5a623;margin-bottom:12px">
        Variables de entorno faltantes
      </div>
      <div style="font-size:13px;color:#8b949e;max-width:420px;line-height:1.8;margin-bottom:20px">
        Configura estas variables en Vercel → Settings → Environment Variables:
      </div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;
        padding:16px 24px;text-align:left;font-size:12px;color:#f5a623;line-height:2">
        ${missing.map(k => `<div>${k}</div>`).join('')}
      </div>
      <div style="margin-top:20px;font-size:12px;color:#8b949e">
        Luego haz un nuevo deploy en Vercel.
      </div>
    </div>
  `
  throw new Error(`Firebase: faltan variables de entorno: ${missing.join(', ')}`)
}

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db        = getFirestore(app)
export const rtdb      = getDatabase(app)
export const auth      = getAuth(app)
export const functions = getFunctions(app)
export const storage   = getStorage(app)
