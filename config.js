// ============================================================
// CONFIG.JS - Configuración global de la aplicación
// IMPORTANTE: Las API keys se inyectan via GitHub Actions
// ============================================================

const CONFIG = {
  // Estas variables son reemplazadas por GitHub Actions al hacer deploy
  // Para desarrollo local, crea un archivo config.local.js con tus valores
  // NOTA: no agregar secretos aqui. Todo lo que este en config.js/env.js se
  // sirve publicamente en GitHub Pages. La key de Anthropic vive solo en el
  // Worker de Cloudflare (server-side); el front nunca la ve ni la envia.
  GOOGLE_CLIENT_ID: window.ENV_GOOGLE_CLIENT_ID || '',

  // Spreadsheet de la app Agencia. Separado del de finanzas a proposito: son
  // dos negocios distintos y el mismo token OAuth cubre ambos. No es una
  // credencial (conocer el ID no da acceso; eso lo controla con quien esta
  // compartida la hoja), pero se inyecta via secret para no dejarlo en el
  // historial de git de un repositorio publico.
  AGENCIA_SPREADSHEET_ID: window.ENV_AGENCIA_SPREADSHEET_ID || '',

  // Unidad compartida de Drive donde se guardan fotos y archivos de pizarra.
  // Va aparte porque en "Mi unidad" el archivo lo posee quien lo sube y
  // consume SU cuota, aunque este en una carpeta ajena; en una unidad
  // compartida lo posee la unidad y el espacio sale del Workspace.
  // Vacio = se usa "Mi unidad" de la cuenta que inicio sesion.
  AGENCIA_DRIVE_ID: window.ENV_AGENCIA_DRIVE_ID || '',

  // Google OAuth & Sheets
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
  GOOGLE_SHEETS_API: 'https://sheets.googleapis.com/v4/spreadsheets',
  GOOGLE_OAUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_USERINFO_URL: 'https://www.googleapis.com/oauth2/v3/userinfo',

  // Claude API — el front nunca habla directo con api.anthropic.com (CORS lo
  // bloquea y ademas obligaria a exponer la key). Siempre via proxy.
  //
  // Ruta relativa a proposito: apunta a functions/api/claude.js, que corre en
  // el MISMO origen que la app. Eso elimina el CORS (no hay preflight ni
  // cabeceras que mantener al cambiar de dominio) y, sobre todo, el proxy
  // abierto: Cloudflare Access protege el dominio entero, esta ruta incluida,
  // y el navegador manda su cookie de sesion sola por ser mismo-origen.
  //
  // Sustituye al Worker fintrack-proxy, que era publico y sin autenticacion:
  // cualquiera con su URL podia gastar creditos de la cuenta.
  CLAUDE_API_URL: '/api/claude',
  CLAUDE_MODEL: 'claude-opus-4-6',

  // App
  APP_NAME: 'FinTrack',
  DEFAULT_CURRENCY: 'COP',
  SPREADSHEET_NAME: 'FinTrack - Control de Gastos',

  // Columnas del Sheet (índice base 0)
  SHEET_COLUMNS: {
    DATE: 0,
    TYPE: 1,
    CLASSIFICATION: 2,
    AMOUNT: 3,
    CURRENCY: 4,
    CATEGORY: 5,
    DESCRIPTION: 6,
    PERCENTAGE: 7,
    ORIGINAL_AMOUNT: 8,
    ORIGINAL_CURRENCY: 9,
    EXCHANGE_RATE: 10,
    ID: 11
  },

  SHEET_HEADER: [
    'Fecha', 'Tipo', 'Clasificación', 'Monto', 'Divisa',
    'Categoría', 'Descripción', '% (Mixto)',
    'Monto Original', 'Divisa Original', 'Tasa de Cambio', 'ID'
  ]
};

// Divisas permanentes
const PERMANENT_CURRENCIES = ['COP', 'USD', 'USDT', 'VES'];

// Categorías de gasto
const CATEGORIES = [
  'Software',
  'Comida',
  'Transporte',
  'Mercancía',
  'Luz',
  'Seguro',
  'Seguridad Social',
  'Otro'
];

// Tipos de transacción
const TRANSACTION_TYPES = ['Ingreso', 'Gasto'];

// Clasificaciones
const CLASSIFICATIONS = ['Empresa', 'Personal', 'Mixto'];

// Colores para gráficas
const CHART_COLORS = {
  Software: '#6366f1',
  Comida: '#f59e0b',
  Transporte: '#10b981',
  Mercancía: '#3b82f6',
  Luz: '#f97316',
  Seguro: '#8b5cf6',
  'Seguridad Social': '#ec4899',
  Otro: '#6b7280'
};

window.CONFIG = CONFIG;
window.PERMANENT_CURRENCIES = PERMANENT_CURRENCIES;
window.CATEGORIES = CATEGORIES;
window.TRANSACTION_TYPES = TRANSACTION_TYPES;
window.CLASSIFICATIONS = CLASSIFICATIONS;
window.CHART_COLORS = CHART_COLORS;
