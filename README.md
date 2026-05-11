# ⚽ Porra Mundial 2026

Aplicación web completa de porra del Mundial de Fútbol 2026.  
Stack: **HTML + CSS + Vanilla JS** (ES Modules) · **Supabase** (Auth + PostgreSQL + RLS + Realtime) · Deploy en **GitHub Pages**.

---

## 📁 Estructura del proyecto

```
porra/
├── supabase/
│   ├── schema.sql       ← Tablas, índices, restricciones
│   ├── rls.sql          ← Row Level Security (ejecutar tras schema)
│   ├── functions.sql    ← Funciones, triggers, vistas
│   └── seed.sql         ← Datos iniciales (equipos, grupos, partidos, logros)
└── frontend/
    ├── index.html       ← Página de login / registro
    ├── dashboard.html   ← Dashboard del usuario
    ├── admin.html       ← Panel SUPERADMIN
    ├── css/
    │   ├── main.css     ← Estilos globales (mobile-first)
    │   ├── dashboard.css
    │   └── admin.css
    └── js/
        ├── config.js    ← Inicialización Supabase ⚠️ Configura aquí
        ├── utils.js     ← Utilidades compartidas
        ├── auth.js      ← Autenticación (login, registro, JWT)
        ├── api.js       ← Todas las llamadas a Supabase
        ├── predictions.js
        ├── ranking.js
        ├── admin.js
        └── app.js       ← Punto de entrada, router
```

---

## 🚀 Guía de despliegue paso a paso

### PASO 1 — Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → **New project**
2. Anota tu **Project URL** y **anon/public key** (Settings → API)

### PASO 2 — Ejecutar SQL en Supabase

En el **SQL Editor** de tu proyecto, ejecuta los archivos **en este orden**:

```
1. supabase/schema.sql
2. supabase/rls.sql
3. supabase/functions.sql
4. supabase/seed.sql
```

> ⚠️ Ejecuta cada archivo por separado. Si alguno falla, revisa el mensaje de error antes de continuar.

### PASO 3 — Configurar credenciales en el frontend

Edita `frontend/js/config.js` y sustituye los valores:

```javascript
const SUPABASE_URL      = 'https://TU_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'TU_ANON_PUBLIC_KEY';
```

> ✅ La **anon key** es pública y segura para el frontend. La seguridad real la proveen las políticas RLS.

### PASO 4 — Configurar Supabase Auth

En Supabase Dashboard → **Authentication → Settings**:

1. **Site URL**: `https://TU_USUARIO.github.io/porra`
2. **Redirect URLs**: añadir `https://TU_USUARIO.github.io/porra/index.html`
3. **Email confirmations**: activa o desactiva según prefieras (recomendado: activado)
4. En **Email Templates** puedes personalizar los emails en español

### PASO 5 — Crear cuenta SUPERADMIN

1. Regístrate normalmente en la app
2. En Supabase SQL Editor, ejecuta:
   ```sql
   UPDATE public.profiles 
   SET role = 'SUPERADMIN' 
   WHERE email = 'tu@email.com';
   ```
3. Recarga la app — aparecerá el botón "Admin" en el dashboard

### PASO 6 — Deploy en GitHub Pages

```bash
# 1. Crea un repositorio en GitHub (ej: "porra")
# 2. Sube solo la carpeta frontend/
git init
git add frontend/
git commit -m "feat: initial deploy"
git remote add origin https://github.com/TU_USUARIO/porra.git
git push -u origin main

# 3. En GitHub → Settings → Pages
#    Source: Deploy from branch → main → /frontend (o /root si moviste los archivos)
```

> 💡 **Alternativa más sencilla**: copia el contenido de `frontend/` a la raíz del repositorio.

La app estará disponible en: `https://TU_USUARIO.github.io/porra/`

---

## ⚙️ Configuración post-despliegue

### Configurar fechas límite

1. Entra como SUPERADMIN → Panel Admin → **⏰ Plazos**
2. Establece las fechas antes de cada ronda
3. Una vez pasado el plazo, las predicciones se bloquean automáticamente

### Introducir equipos knockout

Cuando conozcas los equipos clasificados para octavos:
1. Admin → **📅 Partidos** → Editar partidos de octavos
2. Asigna Local/Visitante con los equipos clasificados

### Introducir resultados

Admin → **✅ Resultados** → Introduce el marcador de cada partido.  
Al guardar, automáticamente:
- Se calculan los puntos de todos los usuarios
- Se actualiza la clasificación general
- Se verifican los logros desbloqueados
- Se actualizan las clasificaciones de grupo

---

## 🧮 Sistema de puntuación

| Ronda | Exacto | Resultado | Notas |
|-------|--------|-----------|-------|
| Grupos | +2 | +1 | — |
| Dieciseisavos | +3 | +1 | — |
| Octavos | +4 | +1.5 | — |
| Cuartos | +5 | +2 | — |
| Semifinales | +6 | +2.5 | — |
| 3er/4º Puesto | +6 | +2 | — |
| Final | +8 | +3 | — |

**Predicciones de grupo (clasificación final):**
- +0.5 por cada posición correcta
- +4 si las 4 posiciones son perfectas

**Predicciones de torneo:**
- Campeón correcto: **+8 pts**
- Finalista correcto (cada uno): **+4 pts**
- Máximo goleador correcto: **+6 pts**

---

## 🏅 Sistema de logros (automático)

| Logro | Condición |
|-------|-----------|
| ⭐ Primera Predicción | Primera predicción enviada |
| 🥉 Bronce | 5 predicciones exactas |
| 🥈 Plata | 10 predicciones exactas |
| 🥇 Oro | 15 predicciones exactas |
| 💎 Platino | 20 predicciones exactas |
| 💠 Diamante | 25 predicciones exactas |
| 🏆 Leyenda | 30 predicciones exactas |
| 🎯 Maestro | 40 predicciones exactas |
| 🔮 Profeta | 50 predicciones exactas |

---

## 🔒 Seguridad

- **RLS (Row Level Security)** activado en todas las tablas
- Los usuarios **solo ven/editan sus propias predicciones** (antes del plazo)
- Después del plazo, las predicciones son visibles para todos
- SUPERADMIN tiene acceso completo
- Las contraseñas las gestiona Supabase Auth con bcrypt
- Los tokens JWT se renuevan automáticamente
- Toda entrada de usuario se sanitiza con `escapeHtml()` antes de inyectarse en el DOM

---

## 🛠️ Desarrollo local

Al trabajar localmente, los ES modules necesitan un servidor HTTP:

```bash
# Con Python
cd frontend
python -m http.server 8080

# Con Node.js (npx)
cd frontend  
npx serve .

# Con VS Code — extensión Live Server
```

> ⚠️ **No abras los HTML directamente con `file://`** — los ES modules no funcionan sin servidor.

---

## 📈 Mejoras recomendadas

### Prioridad alta
- [ ] **Realtime rankings**: ya incluido con `subscribeToScores()`, activar en producción
- [ ] **PWA**: añadir `manifest.json` y Service Worker para instalable en móvil
- [ ] **Notificaciones push**: avisar cuando se acerca el plazo

### Prioridad media
- [ ] **Gráfica de evolución**: línea temporal de puntos por ronda (base ya en `ranking.js`)
- [ ] **Clasificación de grupos pública**: mostrar clasificaciones de grupo en tiempo real
- [ ] **Compartir predicciones**: link público por usuario tras el cierre del plazo

### Prioridad baja
- [ ] **Avatar personalizable**: subida a Supabase Storage
- [ ] **Historial de predicciones**: ver cómo cambió cada predicción
- [ ] **Mini-liga privada**: subgrupos dentro de la porra general
- [ ] **Exportar resultados**: CSV/PDF de la clasificación final

---

## 📞 Problemática común

**"No se cargan los datos"**  
→ Verifica SUPABASE_URL y SUPABASE_ANON_KEY en `config.js`

**"Error de RLS / permission denied"**  
→ Asegúrate de haber ejecutado `rls.sql` correctamente

**"Las predicciones no se guardan"**  
→ Confirma que el plazo está configurado y no ha pasado (Admin → Plazos)

**"El usuario no ve el botón Admin"**  
→ Ejecuta el UPDATE de rol en Supabase SQL Editor

**"Módulos no se cargan en local"**  
→ Usa un servidor HTTP local, no abras el HTML directamente

---

*Versión 1.0 — Mundial 2026 · Construido con Supabase + Vanilla JS*
