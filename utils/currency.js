// ============================================================
// CURRENCY.JS - Cálculos y conversión de divisas
// ============================================================

const Currency = {
  // Obtener todas las divisas
  getAll() {
    return Storage.getCurrencies();
  },

  // Obtener divisa por código
  getByCode(code) {
    return this.getAll().find(c => c.code === code);
  },

  // Convertir monto a COP (divisa base)
  toCOP(amount, fromCurrency) {
    const currency = this.getByCode(fromCurrency);
    if (!currency) return amount;
    return amount * currency.rate;
  },

  // Convertir de COP a otra divisa
  fromCOP(amountCOP, toCurrency) {
    const currency = this.getByCode(toCurrency);
    if (!currency || currency.rate === 0) return amountCOP;
    return amountCOP / currency.rate;
  },

  // Convertir entre dos divisas
  convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;
    const amountInCOP = this.toCOP(amount, fromCurrency);
    return this.fromCOP(amountInCOP, toCurrency);
  },

  // Actualizar tasa de cambio
  updateRate(code, newRate) {
    const currencies = this.getAll();
    const idx = currencies.findIndex(c => c.code === code);
    if (idx !== -1) {
      currencies[idx].rate = parseFloat(newRate);
      Storage.setCurrencies(currencies);
      return true;
    }
    return false;
  },

  // Agregar divisa temporal
  addTemporary(code, name, rate) {
    const currencies = this.getAll();
    if (currencies.find(c => c.code === code)) {
      return false; // Ya existe
    }
    currencies.push({
      code: code.toUpperCase(),
      name,
      rate: parseFloat(rate),
      isPermanent: false
    });
    Storage.setCurrencies(currencies);
    return true;
  },

  // Eliminar divisa temporal
  removeTemporary(code) {
    const currencies = this.getAll();
    const currency = currencies.find(c => c.code === code);
    if (!currency || currency.isPermanent) return false;

    const filtered = currencies.filter(c => c.code !== code);
    Storage.setCurrencies(filtered);
    return true;
  },

  // Formatear monto según divisa
  format(amount, currencyCode) {
    if (amount === null || amount === undefined || isNaN(amount)) return '—';

    const formatters = {
      COP: new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }),
      USDT: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      VES: new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    };

    const formatter = formatters[currencyCode];
    if (formatter) {
      const formatted = formatter.format(Math.abs(amount));
      return currencyCode === 'USDT' ? `${formatted} USDT` : formatted;
    }

    return `${Math.abs(amount).toFixed(2)} ${currencyCode}`;
  },

  // Formatear número simple
  formatNumber(amount, decimals = 2) {
    return new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(amount);
  },

  // Calcular totales del dashboard
  calculateTotals(transactions) {
    const currencies = this.getAll();
    const totals = {};

    currencies.forEach(c => {
      totals[c.code] = { balance: 0, income: 0, expenses: 0 };
    });

    transactions.forEach(tx => {
      const code = tx.currency;
      if (!totals[code]) {
        totals[code] = { balance: 0, income: 0, expenses: 0 };
      }

      const amount = parseFloat(tx.amount) || 0;
      if (tx.type === 'Ingreso') {
        totals[code].income += amount;
        totals[code].balance += amount;
      } else {
        totals[code].expenses += amount;
        totals[code].balance -= amount;
      }
    });

    return totals;
  },

  // Total en USD equivalente
  totalInUSD(totals) {
    let totalUSD = 0;
    Object.entries(totals).forEach(([code, data]) => {
      const inCOP = this.toCOP(data.balance, code);
      totalUSD += this.fromCOP(inCOP, 'USD');
    });
    return totalUSD;
  },

  // Resumen mensual
  monthlySummary(transactions, year, month) {
    const filtered = transactions.filter(tx => {
      const date = new Date(tx.date);
      return date.getFullYear() === year && date.getMonth() + 1 === month;
    });

    const byCurrency = {};
    const currencies = this.getAll();

    currencies.forEach(c => {
      byCurrency[c.code] = {
        income: 0,
        expenseCompany: 0,
        expensePersonal: 0,
        net: 0
      };
    });

    filtered.forEach(tx => {
      const code = tx.currency;
      if (!byCurrency[code]) {
        byCurrency[code] = { income: 0, expenseCompany: 0, expensePersonal: 0, net: 0 };
      }

      const amount = parseFloat(tx.amount) || 0;
      if (tx.type === 'Ingreso') {
        byCurrency[code].income += amount;
        byCurrency[code].net += amount;
      } else {
        const pct = parseFloat(tx.percentage) || 100;
        if (tx.classification === 'Empresa') {
          byCurrency[code].expenseCompany += amount;
        } else if (tx.classification === 'Personal') {
          byCurrency[code].expensePersonal += amount;
        } else if (tx.classification === 'Mixto') {
          byCurrency[code].expenseCompany += amount * (pct / 100);
          byCurrency[code].expensePersonal += amount * ((100 - pct) / 100);
        }
        byCurrency[code].net -= amount;
      }
    });

    return byCurrency;
  },

  // Gastos por categoría (en COP equivalente)
  expensesByCategory(transactions, year, month) {
    const filtered = transactions.filter(tx => {
      if (tx.type !== 'Gasto') return false;
      if (!year || !month) return true;
      const date = new Date(tx.date);
      return date.getFullYear() === year && date.getMonth() + 1 === month;
    });

    const byCategory = {};
    CATEGORIES.forEach(cat => { byCategory[cat] = 0; });

    filtered.forEach(tx => {
      const cat = tx.category || 'Otro';
      const amountCOP = this.toCOP(parseFloat(tx.amount) || 0, tx.currency);
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += amountCOP;
    });

    return byCategory;
  }
};

window.Currency = Currency;
