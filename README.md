# RealContent — Finanzas + Agencia

Una sola aplicación web con dos partes independientes:

- **Finanzas (FinTrack)** — control de gastos e ingresos multi-divisa, con extracción automática de datos desde fotos de recibos.
- **Agencia** — gestión de producción: material disponible, kanban con cronómetro por etapas, resumen semanal, rendimiento histórico, cuentas por cobrar y pizarra colaborativa.

Comparten interfaz y sesión, pero **cada una guarda en su propio spreadsheet**.

---

## Arquitectura

Sin build step, sin framework, sin bundler. HTML + CSS + JavaScript plano cargado con `<script>`.

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

**Un solo login OAuth.** La cuenta con la que entras debe tener acceso de Editor a ambos spreadsheets y ser miembro de la unidad compartida.

### Por qué unidad compartida y no una carpeta

En *Mi unidad*, el archivo lo posee **quien lo sube** y consume **su** cuota, aunque esté dentro de una carpeta que otro compartió. En una unidad compartida los archivos los posee la unidad y el espacio sale del almacenamiento agrupado del Workspace.

La API de Drive **ignora las unidades compartidas** salvo que cada llamada incluya `supportsAllDrives=true` (y las búsquedas, además, `corpora=drive` + `driveId`). Está resuelto en `utils/drive-files.js`.

### Cómo se muestran los archivos privados

El scope es `drive.file`: la app solo ve los archivos que ella misma crea, y quedan privados. Por eso `drive.google.com/uc?id=...` no sirve. Se descargan con `fetch` + `Authorization: Bearer` y se sirven como `blob:` URL, con caché y liberación de memoria.

Consecuencia: **el archivo se descarga entero antes de reproducirse**; no hay streaming progresivo. Irrelevante para notas de voz, notable en vídeos largos.

Lo que se guarda en el Sheet es la referencia `drive:<fileId>`, no una URL — los `blob:` URL mueren al recargar.

---

## Estructura de archivos

| Ruta | Rol |
|---|---|
| `index.html` | Interfaz completa: login, sidebar y las secciones de ambas apps |
| `config.js` | Constantes y lectura de variables de entorno |
| `script.js`, `styles.css` | **Finanzas.** No tocar sin motivo |
| `utils/google-sheets.js` | OAuth + primitivos de Sheets (compartido) |
| `utils/currency.js`, `storage.js`, `claude-api.js` | Finanzas |
| `utils/agencia-sheets.js` | CRUD genérico por nombre de hoja sobre el Sheet de Agencia |
| `utils/agencia-bootstrap.js` | Crea hojas y encabezados que falten. Idempotente |
| `utils/drive-files.js` | Subida y visualización en la unidad compartida |
| `utils/prompt-modal.js` + `prompt-modal.css` | Modal de precio (sustituye al `input()` de terminal) |
| `agencia/js/*` | Los 14 módulos de Agencia |
| `agencia.css` | Estilos de Agencia, **scopeados bajo `#agencia-root`** |
| `agencia-nav.js` | Pegamento de navegación entre ambas apps |
| `functions/api/claude.js` | Proxy a Anthropic (Cloudflare Pages Function) |
| `build.sh` | Genera `env.js` a partir de variables de entorno |

⚠️ **El CSS de Agencia debe seguir scopeado bajo `#agencia-root`.** Diez clases colisionan con las de finanzas (`.active`, `.modal`, `.toast`, `.badge`, `.btn-primary`…) y sin el scope la interfaz se rompe.

---

## Configuración

Tres variables públicas, inyectadas en `env.js` por `build.sh`:

| Variable | Qué es |
|---|---|
| `GOOGLE_CLIENT_ID` | Cliente OAuth. Público por diseño; lo que protege es la lista de orígenes autorizados |
| `AGENCIA_SPREADSHEET_ID` | Spreadsheet de Agencia. No es credencial: el acceso lo dan los permisos de la hoja |
| `AGENCIA_DRIVE_ID` | Unidad compartida de Drive. Vacío = usa *Mi unidad* |

Y una que **nunca llega al navegador**:

| Variable | Dónde vive |
|---|---|
| `CLAUDE_API_KEY` | Variable de entorno del proyecto de Pages, marcada como **Secret**. Solo la lee `functions/api/claude.js` |

> 🔴 **Nunca pongas la key de Anthropic en `env.js`, `config.js` ni en un secret que alimente `build.sh`.** Todo lo que pase por ahí se sirve como archivo estático y es legible por cualquiera. Este repositorio es público.

### Orígenes OAuth autorizados

En Google Cloud Console → Credenciales, el cliente OAuth necesita:

| Campo | Valores |
|---|---|
| Orígenes de JavaScript | `https://app.realcontent.site`, `http://localhost:8788` |
| URIs de redirección | `https://app.realcontent.site/`, `http://localhost:8788/` |

La redirección la construye `google-sheets.js` como `origin + pathname`; de ahí la barra final.

---

## Desarrollo local

```bash
# 1. Crear env.js con tus valores (está en .gitignore)
cat > env.js <<'EOF'
window.ENV_GOOGLE_CLIENT_ID = 'tu-client-id.apps.googleusercontent.com';
window.ENV_AGENCIA_SPREADSHEET_ID = 'id-del-spreadsheet';
window.ENV_AGENCIA_DRIVE_ID = 'id-de-la-unidad-compartida';
EOF

# 2. Servir en el puerto 8788 (el que está autorizado en OAuth)
python -m http.server 8788 --bind 127.0.0.1
```

Con eso funciona todo salvo `/api/claude`. Para probar también la función:

```bash
npm install -g wrangler
wrangler pages dev . --port 8788
```

> Abre la app en una ventana de incógnito: las extensiones del navegador llenan la consola de errores ajenos y cuesta ver los propios.

---

## Despliegue

Cloudflare Pages, con **Cloudflare Access** delante para que el sitio no sea público.

1. Proyecto de Pages conectado al repositorio
2. Comando de build: `sh build.sh` · directorio de salida: `.`
3. Variables de entorno: las tres públicas + `CLAUDE_API_KEY` como Secret
4. Dominio: `app.realcontent.site`
5. Política de Access sobre ese dominio

Access protege también `/api/claude` por ser el mismo origen: el navegador manda su cookie sola y deja de ser un proxy abierto sin escribir una línea de autenticación.

---

## Estructura de datos

**Spreadsheet de finanzas** — hoja `Transacciones`:
`Fecha · Tipo · Clasificación · Monto · Divisa · Categoría · Descripción · % (Mixto) · Monto Original · Divisa Original · Tasa de Cambio · ID`
Más una hoja `Deudas` para el seguimiento de cuotas.

**Spreadsheet de Agencia** — 8 hojas, creadas automáticamente en el primer arranque por `agencia-bootstrap.js`:
`material_disponible · kanban_tareas · cuentas_por_cobrar · empleados_output · tarifas · tareas_etapas · pizarras · pizarra_elementos`

El bootstrap solo añade columnas cuando el encabezado existente coincide celda por celda con el principio del esquema. Cualquier otra diferencia se reporta pero **no se toca**: reordenar desalinearía los datos ya escritos.

---

## Limitaciones conocidas

| Asunto | Detalle |
|---|---|
| Notificaciones de fondo | Solo mientras la pestaña esté abierta. Para avisos con el navegador cerrado hay que dejar `scheduler.py` corriendo en local |
| Nombre y foto del usuario | La barra lateral muestra "Usuario": los scopes no incluyen permiso de perfil |
| `.webm` en pizarra | Se trata como audio. Para vídeo, usa `.mp4` o `.mov` |
| Deshacer tras borrar en pizarra | Restaura el elemento pero el archivo ya se borró de Drive; se muestra el aviso de carga fallida |
| Huérfanos en Drive | `enviarAKanban` y `completarMaterial` borran la fila sin limpiar la foto |
| Escrituras concurrentes | No hay bloqueo: dos pestañas escribiendo la misma fila a la vez pueden pisarse |

---

## Solución de problemas

**"Google Client ID no configurado"**
→ `env.js` no se generó o `GOOGLE_CLIENT_ID` está vacío en las variables del proyecto.

**El login falla o redirige mal**
→ Revisa orígenes y URIs de redirección. La barra final del URI importa.

**Agencia no carga / "CONFIG.AGENCIA_SPREADSHEET_ID no configurado"**
→ Falta la variable, o la cuenta con la que entraste no tiene acceso de Editor a ese spreadsheet.

**Las fotos no se ven, o 404 al subir**
→ Comprueba que la cuenta es miembro de la unidad compartida. Un 404 en Drive casi siempre es permiso, no ruta.

**El análisis por foto da error de autenticación**
→ El problema está en la función, no en el navegador: revisa que `CLAUDE_API_KEY` exista como variable de entorno del proyecto de Pages.

**La interfaz de Agencia se ve rota**
→ Alguna regla de `agencia.css` perdió el scope `#agencia-root`.
