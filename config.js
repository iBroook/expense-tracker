// ============================================================
// CONFIG.JS - Configuración global de la aplicación
// IMPORTANTE: Las API keys se inyectan via GitHub Actions
// ============================================================

const CONFIG = {
  // Estas variables son reemplazadas por GitHub Actions al hacer deploy
  // Para desarrollo local, crea un archivo config.local.js con tus valores
  CLAUDE_API_KEY: window.ENV_CLAUDE_API_KEY || '',
  GOOGLE_CLIENT_ID: window.ENV_GOOGLE_CLIENT_ID || '',

  // Google OAuth & Sheets
  GOOGLE_SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
  GOOGLE_SHEETS_API: 'https://sheets.googleapis.com/v4/spreadsheets',
  GOOGLE_OAUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_USERINFO_URL: 'https://www.googleapis.com/oauth2/v3/userinfo',

  // Claude API
  CLAUDE_API_URL: 'https://fintrack-proxy.gabrielhm1005.workers.dev',
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
