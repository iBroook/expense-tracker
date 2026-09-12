# RealContent — Finanzas (FinTrack) + Agencia

Una sola web app con **dos partes independientes** que comparten interfaz y sesión OAuth,
pero **cada una guarda en su propio spreadsheet de Google**.

- **Finanzas (FinTrack)** — gastos e ingresos multi-divisa, con extracción de datos desde fotos de recibos vía Claude.
- **Agencia** — producción: material disponible, kanban con cronómetro por etapas, resumen semanal, rendimiento, cuentas por cobrar y pizarra colaborativa.

```
Navegador (Cloudflare Pages)
   │
   ├─ OAuth Google ──┬──► Sheets API ──► Spreadsheet "FinTrack"  (finanzas)
   │                 ├──► Sheets API ──► Spreadsheet "Agencia"   (producción)
   │                 └──► Drive API  ──► Unidad compartida       (fotos, audio, PDF, vídeo)
   │
   └─ POST /api/claude ──► functions/api/claude.js ──► api.anthropic.com
                            (la API key vive aquí, nunca en el navegador)
```

---

## Stack — leer antes de proponer nada

**Sin build step, sin framework, sin bundler, sin npm, sin módulos ES.**
HTML + CSS + JavaScript plano cargado con `<script src>` en orden. Todo global.

No propongas React, Vite, TypeScript, imports ES ni `npm install` salvo que el humano lo
pida explícitamente. **La arquitectura es deliberada, no deuda técnica.**

No hay tests ni linter: la verificación es manual en el navegador.

---

## Reglas duras

1. 🔴 **Nunca un secreto en `env.js`, `config.js` ni `build.sh`.** El repo es **público** y
   todo eso se sirve como archivo estático. `CLAUDE_API_KEY` vive solo como Secret en
   Cloudflare Pages y solo la lee `functions/api/claude.js`.

2. ⚠️ **El CSS de Agencia va scopeado bajo `#agencia-root`.** Diez clases colisionan con las
   de finanzas (`.active`, `.modal`, `.toast`, `.badge`, `.btn-primary`…). Sin el scope la
   interfaz se rompe entera. Únicas excepciones legítimas: selectores con prefijo propio
   (`.ag-*`, `#agencia-*`) y los bloques de variables de tema.

3. **El front nunca habla directo con `api.anthropic.com`.** Siempre vía `/api/claude`
   (ruta relativa, mismo origen). Eso elimina CORS y el proxy abierto: Cloudflare Access
   protege el dominio entero, esa ruta incluida, y el navegador manda su cookie solo.

4. **El proxy tiene allowlist de modelos** en `functions/api/claude.js`:
   `claude-opus-4-6`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`.
   Tope `max_tokens` 4096 (se recorta, no se rechaza), cuerpo máximo 12 MB.
   **Si cambias `CONFIG.CLAUDE_MODEL`, actualiza la allowlist.** Hoy: `claude-opus-4-6`.

5. **`nowDateTimeISO()` en `state.js` devuelve hora local sin timezone** a propósito.
   **No usar `toISOString()`**: produce UTC con sufijo `Z` y rompe las comparaciones.

6. **Drive: unidad compartida, no carpeta.** En *Mi unidad* el archivo lo posee quien lo
   sube y consume **su** cuota. En unidad compartida lo posee la unidad.

7. **La API de Drive ignora las unidades compartidas** salvo que cada llamada lleve
   `supportsAllDrives=true` (y las búsquedas además `corpora=drive` + `driveId`). Resuelto
   con un helper central en `utils/drive-files.js` — no quitar esos parámetros.

8. **Archivos privados vía `blob:`.** El scope es `drive.file`: la app solo ve lo que ella
   creó, y es privado. `drive.google.com/uc?id=...` **no sirve**. Se descarga con `fetch` +
   `Authorization: Bearer` y se sirve como `blob:` URL. En el Sheet se guarda la referencia
   **`drive:<fileId>`, no una URL** — los `blob:` mueren al recargar.

9. **Las secciones de Agencia viven permanentes en el DOM.** No se re-renderiza el HTML al
   cambiar de pestaña: los módulos enlazan sus manejadores una sola vez en `init()` y
   reconstruir el marcado los perdería. `agencia-nav.js` solo alterna visibilidad.

---

## Estructura

| Ruta | Rol |
|---|---|
| `index.html` | Interfaz completa: login, sidebar y secciones de ambas apps |
| `config.js` | Constantes globales + lectura de `window.ENV_*` |
| `env.js` | Generado por `build.sh`. **Gitignored**, no editar en deploy |
| `build.sh` | Genera `env.js` desde variables de entorno |
| `script.js`, `styles.css` | **Finanzas. No tocar sin motivo** |
| `utils/google-sheets.js` | OAuth + primitivos de Sheets (**compartido por ambas apps**) |
| `utils/currency.js`, `storage.js`, `claude-api.js` | Finanzas |
| `utils/agencia-sheets.js` | CRUD genérico por nombre de hoja + `SCHEMA` de las 8 hojas |
| `utils/agencia-bootstrap.js` | Crea hojas y encabezados faltantes. **Idempotente** |
| `utils/drive-files.js` | Subida y visualización en la unidad compartida |
| `utils/prompt-modal.js` + `prompt-modal.css` | Modal de precio |
| `agencia/js/*` | Los 14 módulos de Agencia |
| `agencia.css` | Estilos de Agencia, **scopeados bajo `#agencia-root`** |
| `agencia-nav.js` | Pegamento de navegación entre ambas apps |
| `functions/api/claude.js` | Proxy a Anthropic (Cloudflare Pages Function) |

`agencia/js/api.js` es una fachada delgada sobre `AgenciaSheets`, legado del backend Python
que ya no existe.

### Orden de carga (`index.html:385-416`) — **importa**

```
env.js → config.js
  → utils/storage.js, currency.js, claude-api.js, google-sheets.js
  → utils/agencia-sheets.js, agencia-bootstrap.js, drive-files.js, prompt-modal.js
  → agencia/js/api.js, state.js, priority.js, parser.js, etapas.js, notificaciones.js,
    material.js, kanban.js, resumen.js, rendimiento.js, recibo.js, cobrar.js,
    pizarra.js, app.js
  → script.js
  → agencia-nav.js
```

`agencia-nav.js` va **último a propósito**: envuelve `window.switchTab` y `window.showApp`
de `script.js` sin modificarlo. En un script clásico el binding de una función global **es**
la propiedad `window.switchTab`, así que reasignarla afecta también a los `onclick` inline.

### Contratos entre las dos apps

- **`window.Agencia.init()`** — punto de entrada. `agencia-nav.js` lo resuelve con fallbacks
  (`window.AgenciaApp.init`, `window.initAgencia`).
- **Agencia NO arranca en `DOMContentLoaded`.** Espera a que el usuario pase el login de
  Google: sin token OAuth toda lectura de Sheets falla.
- `init()` es idempotente (flag `iniciado`) para no duplicar listeners ni timers.
- Antes de leer datos, `init()` llama a `AgenciaBootstrap.asegurarEstructura()`.
- Refresco automático cada 60 s (`setInterval` en `app.js`).

---

## Cómo agregar una función a Agencia

Patrón de módulo (top-level `const` en script clásico → binding global accesible por nombre):

```js
const MiModulo = (() => {
  function bindEvents() { /* una sola vez */ }
  function render() { /* lee de State, pinta el DOM */ }
  return { bindEvents, render };
})();
```

Pasos para una pestaña nueva:

1. **Hoja nueva** (si hace falta): añádela a `AgenciaSheets.SCHEMA` en
   `utils/agencia-sheets.js:9`. El bootstrap la crea sola, es idempotente.
2. **Estado**: un `refreshMiCosa()` async en `agencia/js/state.js` (junto a los otros).
3. **Módulo**: `agencia/js/mi-modulo.js` con el patrón de arriba.
4. **Registro en `agencia/js/app.js`**: el `refresh` en `loadAll()`, el `render()` en
   `renderAll()`, el `bindEvents()` en `init()`.
5. **Marcado en `index.html`**: item de sidebar
   `<div class="nav-item" data-tab="micosa" onclick="switchTab('micosa')">` y una
   `<section id="tab-micosa" class="tab-panel">` dentro de `#agencia-root`.
6. **Navegación**: añade `'micosa'` al array `AGENCIA_TABS` en `agencia-nav.js:18`.
   Sin esto la pestaña se delega a FinTrack y no se muestra.
7. **`<script src>`** en `index.html` en el bloque de `agencia/js/`, **antes de `app.js`**.
8. **CSS** en `agencia.css`, scopeado bajo `#agencia-root`.

API de datos disponible: `AgenciaSheets.getSheet(hoja)`, `.createRow(hoja, data)`,
`.updateRow(hoja, id, updates)`, `.deleteRow(hoja, id)`.
Utilidades en `state.js`: `toast()`, fechas ISO, semana ISO, duraciones.

Pestañas actuales de Agencia: `material`, `kanban`, `resumen`, `rendimiento`, `cxc`, `pizarra`.

---

## Configuración

Tres variables **públicas**, inyectadas en `env.js` por `build.sh` (`env.js` está en `.gitignore`):

| Variable | Qué es |
|---|---|
| `GOOGLE_CLIENT_ID` | Cliente OAuth. Público por diseño; lo que protege es la lista de orígenes |
| `AGENCIA_SPREADSHEET_ID` | No es credencial: el acceso lo dan los permisos de la hoja |
| `AGENCIA_DRIVE_ID` | Unidad compartida. Vacío = usa *Mi unidad* |

Y `CLAUDE_API_KEY`, que **nunca llega al navegador** (Secret en Cloudflare Pages).

**Orígenes OAuth autorizados** (Google Cloud Console → Credenciales):
JavaScript `https://app.realcontent.site`, `http://localhost:8788` ·
Redirección `https://app.realcontent.site/`, `http://localhost:8788/`.
`google-sheets.js` construye la redirección como `origin + pathname` — **la barra final importa**.

**Scopes:** `.../auth/spreadsheets` + `.../auth/drive.file`

---

## Estructura de datos

**Finanzas** — hoja `Transacciones`:
`Fecha · Tipo · Clasificación · Monto · Divisa · Categoría · Descripción · % (Mixto) ·
Monto Original · Divisa Original · Tasa de Cambio · ID`
Más una hoja `Deudas` para cuotas. Índices de columna en `CONFIG.SHEET_COLUMNS`.

**Agencia** — 8 hojas, creadas en el primer arranque por `agencia-bootstrap.js`:
`material_disponible · kanban_tareas · cuentas_por_cobrar · empleados_output ·
tarifas · tareas_etapas · pizarras · pizarra_elementos`

El bootstrap **solo añade columnas** cuando el encabezado existente coincide celda por celda
con el principio del esquema. Cualquier otra diferencia se reporta pero **no se toca**:
reordenar desalinearía los datos ya escritos.

---

## Desarrollo y despliegue

```bash
# env.js con los tres valores (gitignored), luego servir en el puerto autorizado
python -m http.server 8788 --bind 127.0.0.1
```

Con eso funciona todo salvo `/api/claude`. Para probar también la función:
`wrangler pages dev . --port 8788` (key propia en `.dev.vars`, gitignored).

> Abre la app en incógnito: las extensiones del navegador llenan la consola de errores ajenos.

| Dato | Valor |
|---|---|
| Repo | `https://github.com/iBroook/expense-tracker` (**público**), rama `main` |
| Producción | Cloudflare Pages → `https://app.realcontent.site`, con Cloudflare Access delante |
| Build | `sh build.sh` · directorio de salida `.` |
| Deploy | Automático en cada push a `main` |
| GitHub Pages | `.github/workflows/deploy.yml`, **solo manual**. Salida de emergencia; ahí `/api/claude` no funciona |

⚠️ **`git` no está instalado en esta máquina** (no está en PATH ni en `Program Files` ni en
`LOCALAPPDATA\Programs`). Se puede leer y editar el código, pero **no commitear ni hacer
push desde la terminal** — y el deploy depende del push. Commitea desde GitHub Desktop o la
UI de VS Code, o instala Git.

---

## Limitaciones conocidas (no son bugs por descubrir)

| Asunto | Detalle |
|---|---|
| Notificaciones de fondo | Solo mientras la pestaña esté abierta |
| Nombre y foto del usuario | La barra lateral muestra "Usuario": los scopes no incluyen perfil |
| Sin streaming de vídeo | El archivo se descarga entero antes de reproducirse (consecuencia de `blob:`) |
| `.webm` en pizarra | Se trata como audio. Para vídeo, `.mp4` o `.mov` |
| Deshacer tras borrar en pizarra | Restaura el elemento pero el archivo ya se borró de Drive |
| Huérfanos en Drive | `enviarAKanban` y `completarMaterial` borran la fila sin limpiar la foto |
| Escrituras concurrentes | No hay bloqueo: dos pestañas sobre la misma fila pueden pisarse |

---

## Solución de problemas

| Síntoma | Causa casi siempre |
|---|---|
| "Google Client ID no configurado" | `env.js` no se generó, o `GOOGLE_CLIENT_ID` vacío |
| El login falla o redirige mal | Orígenes / URIs de redirección. La barra final importa |
| "CONFIG.AGENCIA_SPREADSHEET_ID no configurado" | Falta la variable, o la cuenta no tiene Editor en la hoja |
| Fotos no se ven, o 404 al subir | La cuenta no es miembro de la unidad compartida. Un 404 en Drive casi siempre es permiso, no ruta |
| Error de autenticación al analizar foto | Falta `CLAUDE_API_KEY` en las variables del proyecto de Pages |
| Interfaz de Agencia rota | Alguna regla de `agencia.css` perdió el scope `#agencia-root` |
| Pestaña nueva no aparece | Falta en `AGENCIA_TABS` (`agencia-nav.js:18`) |
