# 🍽 RestoPOS — Firebase + Vercel

Sistema de pedidos en tiempo real para restaurante.
Funciona desde cualquier dispositivo con navegador y WiFi.

---

## ⚡ PASO 1 — Configurar Firebase

### 1.1 Crear proyecto Firebase
1. Ve a https://console.firebase.google.com
2. Clic en **"Crear un proyecto"**
3. Ponle un nombre (ej: `mi-restaurante`)
4. Desactiva Google Analytics (no es necesario) → Crear proyecto

### 1.2 Crear la app Web
1. En la pantalla principal del proyecto, clic en el ícono **</>** (Web)
2. Ponle un nombre (ej: `resto-app`)
3. **NO** marques "Firebase Hosting"
4. Clic en **"Registrar app"**
5. Verás un bloque de código con `firebaseConfig` — **cópialo**

### 1.3 Pegar las credenciales
Abre el archivo `src/lib/firebase.js` y reemplaza los valores:
```js
const firebaseConfig = {
  apiKey:            "PEGA_AQUÍ",
  authDomain:        "PEGA_AQUÍ",
  databaseURL:       "PEGA_AQUÍ",   // ← ver paso 1.5
  projectId:         "PEGA_AQUÍ",
  storageBucket:     "PEGA_AQUÍ",
  messagingSenderId: "PEGA_AQUÍ",
  appId:             "PEGA_AQUÍ",
}
```

### 1.4 Activar Firestore (menú e historial)
1. En Firebase Console → menú izquierdo → **Firestore Database**
2. Clic en **"Crear base de datos"**
3. Selecciona **"Modo de prueba"** → Siguiente → Finalizar

### 1.5 Activar Realtime Database (pedidos en vivo)
1. En Firebase Console → menú izquierdo → **Realtime Database**
2. Clic en **"Crear una base de datos"**
3. Selecciona tu región → **"Modo de prueba"** → Listo
4. Copia la URL que aparece (ej: `https://mi-restaurante-default-rtdb.firebaseio.com`)
5. Pégala en `firebase.js` en el campo `databaseURL`

### 1.6 Reglas de seguridad (para producción)
En cada base de datos → pestaña **Reglas**, pega esto:

**Firestore:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Realtime Database:**
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
> ⚠️ Estas reglas son abiertas (modo prueba). Para un negocio real, agrega autenticación.

---

## ⚡ PASO 2 — Subir a Vercel

### Opción A: desde GitHub (recomendado)
1. Sube esta carpeta a un repositorio en https://github.com
2. Ve a https://vercel.com → **"Add New Project"**
3. Importa tu repositorio
4. Vercel detecta automáticamente que es Vite
5. Clic en **Deploy** → listo 🎉

### Opción B: desde la terminal
```bash
npm install -g vercel
cd resto-firebase
npm install
vercel
```
Sigue las instrucciones en pantalla.

---

## ⚡ PASO 3 — Usar la app

Una vez desplegada, tendrás una URL tipo `https://mi-restaurante.vercel.app`

| Dispositivo | URL | Para qué |
|---|---|---|
| Celular mesero | `https://tu-app.vercel.app/mesas` | Tomar pedidos |
| Tablet cocina | `https://tu-app.vercel.app/cocina` | Ver pedidos en vivo |
| Admin | `https://tu-app.vercel.app/menu` | Gestionar el menú |
| Dueño | `https://tu-app.vercel.app/historial` | Ver ventas del día |

### Tip para Android:
En Chrome → menú ⋮ → **"Agregar a pantalla de inicio"**
→ Se instala como app nativa, sin barra del navegador.

---

## 📱 Funciones de cada pantalla

### 🍽 Mesas
- 10 mesas con número visual
- Las mesas con pedido activo se marcan en naranja
- Toca una mesa para ir al menú

### 📋 Pedido (al tocar una mesa)
- Menú cargado desde Firebase (lo que tú configures)
- Botones +/− por plato
- Total en tiempo real
- Campo libre de **Adicionales** para pedir cosas fuera del menú
- Botón "Enviar a cocina"

### 🍳 Cocina
- Pedidos aparecen instantáneamente con sonido
- Reloj en vivo (hora y fecha)
- Temporizador por pedido:
  - 🟢 Verde → menos de 10 min
  - 🟡 Amarillo → más de 10 min
  - 🔴 Rojo parpadeante → más de 20 min (urgente)
- Número de mesa grande
- Adicionales destacados en amarillo
- Botón **"PEDIDO LISTO"** → mueve al historial automáticamente

### 📋 Historial
- Todos los pedidos completados
- Filtros: Hoy / 7 días / Todo
- Total de ventas del período
- Detalle de cada pedido con items y extras

### ✏️ Menú (Gestión)
- Agregar nuevos platos con nombre, precio y categoría
- Editar platos existentes
- Eliminar platos
- Categorías: Ceviches, Combinados, Bebidas, Guarniciones, Entradas, Postres, Otros

---

## 🔧 Prueba local (opcional)
```bash
cd resto-firebase
npm install
npm run dev
```
Abre http://localhost:5173

---

## ❓ Preguntas frecuentes

**¿Necesita internet?**
Sí, usa Firebase de Google. Funciona con el WiFi del restaurante + internet básico.

**¿Cuánto cuesta?**
Firebase tiene un plan gratuito (Spark) que aguanta perfectamente un restaurante pequeño/mediano. Vercel también es gratuito.

**¿Cuántos dispositivos pueden conectarse?**
Ilimitados. Todos los meseros con su celular, la tablet de cocina, y el admin, todos a la vez.

**¿Los datos se pierden si se corta internet?**
Los pedidos activos se recuperan al reconectar. El historial está guardado permanentemente en Firestore.
