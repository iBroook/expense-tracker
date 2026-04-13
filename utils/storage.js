// ============================================================
// STORAGE.JS - Gestión de localStorage
// ============================================================

const Storage = {
  PREFIX: 'fintrack_',

  set(key, value) {
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage.set error:', e);
      return false;
    }
  },

  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('Storage.get error:', e);
      return defaultValue;
    }
  },

  remove(key) {
    localStorage.removeItem(this.PREFIX + key);
  },

  clear() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.PREFIX))
      .forEach(k => localStorage.removeItem(k));
  },

  // Token de Google OAuth
  setToken(token) {
    this.set('auth_token', token);
  },

  getToken() {
    return this.get('auth_token');
  },

  clearToken() {
    this.remove('auth_token');
    this.remove('user_info');
    this.remove('spreadsheet_id');
  },

  // Info del usuario
  setUserInfo(info) {
    this.set('user_info', info);
  },

  getUserInfo() {
    return this.get('user_info');
  },

  // ID del spreadsheet
  setSpreadsheetId(id) {
    this.set('spreadsheet_id', id);
  },

  getSpreadsheetId() {
    return this.get('spreadsheet_id');
  },

  // Divisas (incluye temporales)
  setCurrencies(currencies) {
    this.set('currencies', currencies);
  },

  getCurrencies() {
    const saved = this.get('currencies');
    if (saved) return saved;

    // Defaults
    return PERMANENT_CURRENCIES.map(code => ({
      code,
      name: this._currencyName(code),
      rate: this._defaultRate(code),
      isPermanent: true
    }));
  },

  _currencyName(code) {
    const names = { COP: 'Peso Colombiano', USD: 'Dólar Americano', USDT: 'Tether USD', VES: 'Bolívar Venezolano' };
    return names[code] || code;
  },

  _defaultRate(code) {
    // Tasa aproximada a COP (el usuario debe actualizar)
    const rates = { COP: 1, USD: 4000, USDT: 4000, VES: 0.1 };
    return rates[code] || 1;
  },

  // Cache de transacciones
  setTransactionsCache(transactions) {
    this.set('transactions_cache', transactions);
  },

  getTransactionsCache() {
    return this.get('transactions_cache', []);
  },

  // Tema
  setTheme(theme) {
    this.set('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  },

  getTheme() {
    return this.get('theme', 'dark');
  },

  // Último spreadsheet seleccionado
  setLastSpreadsheet(data) {
    this.set('last_spreadsheet', data);
  },

  getLastSpreadsheet() {
    return this.get('last_spreadsheet');
  }
};

window.Storage = Storage;
