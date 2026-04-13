# 💳 FinTrack — Control de Gastos

Aplicación web de control de gastos en múltiples divisas con IA (Claude Vision) y sincronización con Google Sheets.

## ✨ Características

- 📷 **IA Vision**: Sube fotos de facturas/recibos y Claude extrae monto, divisa, fecha y concepto automáticamente
- 💱 **Multi-divisa**: COP, USD, USDT, VES + divisas temporales personalizadas
- ☁️ **Google Sheets**: Sincronización en tiempo real como base de datos
- 📊 **Dashboard**: Saldos, resúmenes mensuales, gastos por categoría
- 📈 **Reportes**: Exportar a CSV, análisis mensual, evolución temporal
- 🌙 **Dark/Light mode**: Tema oscuro y claro
- 📱 **Mobile first**: Diseño responsivo

## 🚀 Setup (10 minutos)

### Paso 1: Crear repositorio en GitHub

1. Ve a https://github.com/new
2. Nombre: `expense-tracker`
3. Público ✓
4. Crea el repositorio

### Paso 2: Subir archivos

Sube **todos** los archivos con su estructura de carpetas:

```
expense-tracker/
├── index.html
├── styles.css
├── script.js
├── config.js
├── utils/
│   ├── claude-api.js
│   ├── google-sheets.js
│   ├── currency.js
│   └── storage.js
├── README.md
└── .github/workflows/
    └── deploy.yml
```

### Paso 3: Crear Google OAuth App

1. Ve a https://console.cloud.google.com
2. Crea un nuevo proyecto (o usa uno existente)
3. Habilita la **Google Sheets API** y la **Google Drive API**
4. Ve a **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Tipo: **Web application**
6. En **Authorized JavaScript origins** agrega:
   - `https://[tuusuario].github.io`
   - `http://localhost:8080` (para desarrollo local)
7. Guarda y copia el **Client ID**

### Paso 4: Obtener Claude API Key

1. Ve a https://console.anthropic.com
2. Crea una API key
3. Cópiala (empieza con `sk-ant-...`)

### Paso 5: Configurar GitHub Secrets

1. En tu repositorio ve a **Settings** → **Secrets and variables** → **Actions**
2. Crea estos 2 secrets:

| Secret | Valor |
|--------|-------|
| `CLAUDE_API_KEY` | Tu API key de Anthropic |
| `GOOGLE_CLIENT_ID` | Tu Client ID de Google OAuth |

### Paso 6: Activar GitHub Pages

1. **Settings** → **Pages**
2. Source: **GitHub Actions**
3. Guarda

### Paso 7: ¡Listo!

Tu app estará disponible en:
```
https://[tuusuario].github.io/expense-tracker/
```

El deploy automático toma ~2 minutos tras subir archivos.

---

## 🔐 Seguridad

- Las API keys **nunca** están en el código fuente
- Se inyectan via GitHub Actions en tiempo de build
- OAuth 2.0 maneja la autenticación con Google de forma segura
- Los tokens se guardan en localStorage del navegador

## 📱 Uso

1. Abre la app → **Conectar con Google**
2. Autoriza acceso a Google Sheets
3. Selecciona una hoja existente o crea `FinTrack`
4. ¡Empieza a registrar!

### Registrar gasto con foto:
1. Tab **Registrar** → Sube foto de factura
2. Clic **Analizar con IA**
3. Revisa/corrige los datos extraídos
4. **Guardar Transacción**

### Registrar manualmente:
1. Tab **Registrar** → Rellena el formulario
2. **Guardar Transacción**

### Ver resumen:
- Tab **Dashboard** → Filtra por mes/año

### Exportar datos:
- Tab **Reportes** → **Exportar a Excel**

---

## 🐛 Troubleshooting

**"Google Client ID no configurado"**
→ Verifica que `GOOGLE_CLIENT_ID` está en GitHub Secrets y que el deploy se ejecutó después de agregar el secret.

**"Claude API key no configurada"**
→ Verifica que `CLAUDE_API_KEY` está en GitHub Secrets.

**"Error de autenticación Google"**
→ Verifica que el dominio `https://[tuusuario].github.io` está en los Authorized origins de tu OAuth app.

**"Error leyendo Sheets"**
→ Asegúrate de haber habilitado Google Sheets API y Google Drive API en Google Cloud Console.

**GitHub Pages no publica**
→ Settings → Pages → Source debe ser "GitHub Actions" (no una branch específica).

---

## 💻 Desarrollo local

```bash
# Sin servidor necesario para la mayoría de features
# Para OAuth, necesitas un servidor local

# Opción 1: Python
python3 -m http.server 8080

# Opción 2: Node.js
npx serve .

# Opción 3: VS Code Live Server
# Instala extensión "Live Server" y clic en "Go Live"
```

Crea un archivo `env.js` en la raíz con tus keys de desarrollo:
```javascript
window.ENV_CLAUDE_API_KEY = 'sk-ant-tu-key-aqui';
window.ENV_GOOGLE_CLIENT_ID = 'tu-client-id.apps.googleusercontent.com';
```

Y agrégalo en `index.html` **antes** de `config.js`:
```html
<script src="env.js"></script>
<script src="config.js"></script>
```

> ⚠️ **Nunca** subas `env.js` a GitHub. Agrégalo a `.gitignore`.

---

## 📋 Estructura de Google Sheets

La app crea automáticamente estas columnas en tu hoja:

| Columna | Descripción |
|---------|-------------|
| Fecha | YYYY-MM-DD |
| Tipo | Ingreso / Gasto |
| Clasificación | Empresa / Personal / Mixto |
| Monto | Número |
| Divisa | COP, USD, USDT, VES, etc. |
| Categoría | Software, Comida, etc. |
| Descripción | Texto libre |
| % (Mixto) | Porcentaje empresa si es Mixto |
| Monto Original | Si se convirtió de otra divisa |
| Divisa Original | Divisa antes de conversión |
| Tasa de Cambio | Tasa usada en la conversión |
| ID | Identificador único |

Puedes editar directamente en Google Sheets. Los cambios se reflejarán al sincronizar en la app.

---

## 🛠️ Tecnologías

- **HTML + CSS + JavaScript** puro (sin frameworks)
- **Claude Vision API** (Anthropic) para análisis de imágenes
- **Google Sheets API v4** como base de datos
- **Google OAuth 2.0** para autenticación
- **GitHub Pages + GitHub Actions** para hosting y deploy

---

*Hecho con ❤️ para finanzas organizadas*
