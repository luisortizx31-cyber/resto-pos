# ⚙️ Configuración de Variables de Entorno en Vercel

## Por qué es necesario
El archivo `.env.local` NO se sube a Git (está en .gitignore por seguridad).
Debes configurar las variables directamente en Vercel.

## Pasos

1. Ve a **vercel.com** → tu proyecto → **Settings** → **Environment Variables**

2. Agrega cada una de estas variables con sus valores:

| Variable | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | `AIzaSyBMhgIgHTtbacOHXVND8hsWCaFBTFZzAz4` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `restaurante-b665c.firebaseapp.com` |
| `VITE_FIREBASE_DATABASE_URL` | `https://restaurante-b665c-default-rtdb.firebaseio.com` |
| `VITE_FIREBASE_PROJECT_ID` | `restaurante-b665c` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `restaurante-b665c.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `821629230892` |
| `VITE_FIREBASE_APP_ID` | `1:821629230892:web:84283b01d6354f97155689` |

3. Marca las 3 casillas: **Production**, **Preview**, **Development**

4. Haz clic en **Save** y luego en **Redeploy**

## Si ves pantalla negra
La app ahora mostrará exactamente qué variable falta en vez de pantalla negra.
