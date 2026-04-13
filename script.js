// ============================================================
// SCRIPT.JS - Lógica principal de FinTrack
// ============================================================

// Estado global de la app
const App = {
  currentTab: 'dashboard',
  transactions: [],
  spreadsheetId: null,
  user: null,
  charts: {},

  // Filtros activos
  filters: {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    currency: 'all',
    type: 'all',
    category: 'all'
  }
};

// ============================================================
// INICIALIZACIÓN
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Aplicar tema guardado
  document.documentElement.setAttribute('data-theme', Storage.getTheme());

  // Manejar callback OAuth
  if (window.location.hash.includes('access_token')) {
    handleOAuthReturn();
    return;
  }

  // Verificar autenticación
  if (GoogleSheets.isAuthenticated()) {
    initApp();
  } else {
    showLogin();
  }
});

async function handleOAuthReturn() {
  const success = GoogleSheets.handleOAuthCallback();
  if (success) {
    showLoading('Autenticando...');
    try {
      const userInfo = await GoogleSheets.getUserInfo();
      App.user = userInfo;
      hideLoading();
      initApp();
    } catch (err) {
      hideLoading();
      showLogin();
      showToast('Error en autenticación: ' + err.message, 'error');
    }
  } else {
    showLogin();
  }
}

async function initApp() {
  // Cargar info de usuario
  App.user = Storage.getUserInfo() || (await GoogleSheets.getUserInfo().catch(() => null));
  App.spreadsheetId = Storage.getSpreadsheetId();

  if (!App.spreadsheetId) {
    showSheetSelector();
  } else {
    await startApp();
  }
}

async function startApp() {
  showLoading('Cargando datos...');
  try {
    // Cargar transacciones
    App.transactions = await GoogleSheets.readTransactions(App.spreadsheetId);
    Storage.setTransactionsCache(App.transactions);

    hideLoading();
    showApp();
    renderTab('dashboard');
  } catch (err) {
    hideLoading();
    // Si hay error, usar cache
    App.transactions = Storage.getTransactionsCache();
    showApp();
    renderTab('dashboard');
    showToast('Modo offline: usando datos en caché', 'info');
  }
}

// ============================================================
// PANTALLAS
// ============================================================

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const selectorEl = document.getElementById('sheet-selector-screen');
  if (selectorEl) selectorEl.style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  const selectorEl = document.getElementById('sheet-selector-screen');
  if (selectorEl) selectorEl.style.display = 'none';

  // Renderizar info de usuario en sidebar
  renderUserInfo();
}

function showSheetSelector() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';

  let selectorEl = document.getElementById('sheet-selector-screen');
  if (!selectorEl) {
    selectorEl = document.createElement('div');
    selectorEl.id = 'sheet-selector-screen';
    selectorEl.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem;';
    document.body.appendChild(selectorEl);
  }

  selectorEl.style.display = 'flex';
  selectorEl.innerHTML = `
    <div id="sheet-selector">
      <h2>📊 Selecciona tu Google Sheet</h2>
      <p>Elige una hoja existente o crea una nueva para guardar tus transacciones</p>
      <div class="sheet-list" id="sheet-list">
        <div class="empty-state animate-pulse" style="padding:1rem">
          <p>Cargando tus hojas...</p>
        </div>
      </div>
      <div class="divider">o</div>
      <button class="btn btn-primary" style="width:100%" onclick="createNewSheet()">
        ✨ Crear nueva hoja "FinTrack"
      </button>
    </div>
  `;

  loadSheetList();
}

async function loadSheetList() {
  try {
    const sheets = await GoogleSheets.listSpreadsheets();
    const listEl = document.getElementById('sheet-list');

    if (sheets.length === 0) {
      listEl.innerHTML = '<p class="text-muted" style="font-size:0.85rem;padding:0.5rem">No tienes hojas de cálculo aún</p>';
      return;
    }

    listEl.innerHTML = sheets.map(s => `
      <div class="sheet-item" onclick="selectSheet('${s.id}', '${escapeHtml(s.name)}')">
        <span class="sheet-icon">📄</span>
        <span class="sheet-name">${escapeHtml(s.name)}</span>
        <span class="sheet-date">${formatDate(s.modifiedTime)}</span>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('sheet-list').innerHTML =
      `<p class="text-red" style="font-size:0.85rem;padding:0.5rem">Error cargando hojas: ${err.message}</p>`;
  }
}

async function selectSheet(id, name) {
  showLoading('Conectando con la hoja...');
  try {
    Storage.setSpreadsheetId(id);
    App.spreadsheetId = id;

    // Verificar/crear encabezados si no existen
    const hasHeaders = await GoogleSheets.hasHeaders(id);
    if (!hasHeaders) {
      await GoogleSheets.addHeaders(id);
    }

    await startApp();
  } catch (err) {
    hideLoading();
    showToast('Error conectando: ' + err.message, 'error');
  }
}

async function createNewSheet() {
  showLoading('Creando nueva hoja...');
  try {
    const sheet = await GoogleSheets.createSpreadsheet();
    Storage.setSpreadsheetId(sheet.spreadsheetId);
    App.spreadsheetId = sheet.spreadsheetId;
    App.transactions = [];
    hideLoading();
    showToast('Hoja creada exitosamente', 'success');
    showApp();
    renderTab('dashboard');
  } catch (err) {
    hideLoading();
    showToast('Error creando hoja: ' + err.message, 'error');
  }
}

// ============================================================
// NAVEGACIÓN
// ============================================================

function renderUserInfo() {
  const info = App.user;
  if (!info) return;

  const container = document.getElementById('user-info-container');
  if (!container) return;

  const avatar = info.picture
    ? `<img src="${info.picture}" alt="" class="user-avatar">`
    : `<div class="user-avatar-placeholder">${(info.name || 'U')[0].toUpperCase()}</div>`;

  container.innerHTML = `
    <div class="user-info">
      ${avatar}
      <div>
        <div class="user-name">${escapeHtml(info.name || 'Usuario')}</div>
        <div class="user-email">${escapeHtml(info.email || '')}</div>
      </div>
    </div>
  `;
}

function switchTab(tab) {
  App.currentTab = tab;

  // Actualizar nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  renderTab(tab);
  closeSidebar();
}

function renderTab(tab) {
  const content = document.getElementById('tab-content');
  switch (tab) {
    case 'dashboard': renderDashboard(); break;
    case 'register': renderRegister(); break;
    case 'currencies': renderCurrencies(); break;
    case 'history': renderHistory(); break;
    case 'reports': renderReports(); break;
    case 'settings': renderSettings(); break;
  }
}

// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {
  const content = document.getElementById('tab-content');
  const now = new Date();
  const year = App.filters.year;
  const month = App.filters.month;

  const totals = Currency.calculateTotals(App.transactions);
  const totalUSD = Currency.totalInUSD(totals);
  const monthly = Currency.monthlySummary(App.transactions, year, month);
  const byCategory = Currency.expensesByCategory(App.transactions, year, month);

  // Saldos por divisa
  const currencies = Currency.getAll();
  const balanceCards = currencies.map(c => {
    const data = totals[c.code] || { balance: 0, income: 0, expenses: 0 };
    const isNeg = data.balance < 0;
    return `
      <div class="stat-card ${c.code === 'USD' ? 'stat-total-card' : ''}">
        <div class="stat-label">Saldo</div>
        <div class="stat-currency-badge">${c.code}</div>
        <div class="stat-value ${isNeg ? 'negative' : ''}">${Currency.format(data.balance, c.code)}</div>
        <div class="stat-sub">
          <span class="text-accent">↑ ${Currency.format(data.income, c.code)}</span>
          &nbsp;&nbsp;
          <span class="text-red">↓ ${Currency.format(data.expenses, c.code)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Resumen mensual por divisa
  const monthlyRows = currencies.map(c => {
    const data = monthly[c.code] || { income: 0, expenseCompany: 0, expensePersonal: 0, net: 0 };
    if (data.income === 0 && data.expenseCompany === 0 && data.expensePersonal === 0) return '';
    return `
      <tr>
        <td><span class="badge badge-empresa">${c.code}</span></td>
        <td class="positive mono">${Currency.format(data.income, c.code)}</td>
        <td class="negative mono">${Currency.format(data.expenseCompany, c.code)}</td>
        <td class="negative mono">${Currency.format(data.expensePersonal, c.code)}</td>
        <td class="${data.net >= 0 ? 'positive' : 'negative'} mono">${Currency.format(data.net, c.code)}</td>
      </tr>
    `;
  }).join('');

  // Utilidades
  let totalIncomeCOP = 0, totalExpCompCOP = 0;
  Object.entries(monthly).forEach(([code, data]) => {
    totalIncomeCOP += Currency.toCOP(data.income, code);
    totalExpCompCOP += Currency.toCOP(data.expenseCompany, code);
  });
  const utilityCOP = totalIncomeCOP - totalExpCompCOP;

  // Gastos por categoría
  const catEntries = Object.entries(byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totalCatCOP = catEntries.reduce((s, [, v]) => s + v, 0);

  const catBars = catEntries.map(([cat, val]) => {
    const pct = totalCatCOP > 0 ? (val / totalCatCOP * 100).toFixed(1) : 0;
    const color = CHART_COLORS[cat] || '#6b7280';
    return `
      <div style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;font-size:0.82rem">
          <span>${cat}</span>
          <span class="text-mono">${Currency.format(val, 'COP')} (${pct}%)</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.5s ease"></div>
        </div>
      </div>
    `;
  }).join('');

  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  content.innerHTML = `
    <div class="top-bar">
      <div class="page-title">Dashboard</div>
      <div class="top-actions">
        <button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>
        <select class="filter-select" onchange="App.filters.month=+this.value;renderDashboard()">
          ${monthNames.map((m,i) => `<option value="${i+1}" ${i+1===month?'selected':''}>${m}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="App.filters.year=+this.value;renderDashboard()">
          ${[2023,2024,2025,2026].map(y => `<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="switchTab('register')">
          + Registrar
        </button>
      </div>
    </div>

    <!-- Saldos -->
    <div class="section-title">Saldos por divisa</div>
    <div class="stats-grid">
      ${balanceCards}
      <div class="stat-card stat-total-card">
        <div class="stat-label">Total equivalente</div>
        <div class="stat-currency-badge">USD</div>
        <div class="stat-value positive">${Currency.format(totalUSD, 'USD')}</div>
        <div class="stat-sub">Todas las divisas convertidas</div>
      </div>
    </div>

    <!-- Resumen mensual -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Resumen ${monthNames[month-1]} ${year}</span>
        </div>
        ${monthlyRows ? `
        <div class="table-wrapper">
          <table class="summary-table">
            <thead>
              <tr>
                <th>Divisa</th><th>Ingresos</th><th>Gs. Empresa</th><th>Gs. Personal</th><th>Neto</th>
              </tr>
            </thead>
            <tbody>${monthlyRows}</tbody>
          </table>
        </div>
        ` : '<div class="empty-state"><div class="empty-icon">📋</div><p>Sin transacciones este mes</p></div>'}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Totales del mes (COP)</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.75rem">
          <div style="display:flex;justify-content:space-between;padding:0.6rem;background:var(--accent-dim);border-radius:6px">
            <span style="font-size:0.85rem">Total Ingresos</span>
            <span class="text-mono text-accent">${Currency.format(totalIncomeCOP, 'COP')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.6rem;background:var(--red-dim);border-radius:6px">
            <span style="font-size:0.85rem">Gastos Empresa</span>
            <span class="text-mono text-red">${Currency.format(totalExpCompCOP, 'COP')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:0.6rem;background:${utilityCOP>=0?'var(--accent-dim)':'var(--red-dim)'};border-radius:6px;border:1px solid ${utilityCOP>=0?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)'}">
            <span style="font-size:0.85rem;font-weight:600">Utilidad Empresa</span>
            <span class="text-mono" style="color:${utilityCOP>=0?'var(--accent)':'var(--red)'};font-weight:700">${Currency.format(utilityCOP, 'COP')}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Gastos por categoría -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Gastos por categoría (${monthNames[month-1]} ${year}) — en COP</span>
      </div>
      ${catBars || '<div class="empty-state"><div class="empty-icon">📊</div><p>Sin gastos este mes</p></div>'}
    </div>
  `;
}

// ============================================================
// REGISTRO
// ============================================================

function renderRegister() {
  var content = document.getElementById('tab-content');
  var currencies = Currency.getAll();

  content.innerHTML = '<div class="top-bar">' +
    '<div class="page-title">Registrar Transaccion</div>' +
    '<button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>' +
    '</div>' +

    // Tabs de tipo de registro
    '<div style="display:flex;gap:0.5rem;margin-bottom:1.5rem">' +
    '<button class="btn btn-primary" id="tab-photo" onclick="showRegisterTab(\'photo\')">📷 Subir Foto</button>' +
    '<button class="btn btn-secondary" id="tab-manual" onclick="showRegisterTab(\'manual\')">✏️ Manual</button>' +
    '<button class="btn btn-secondary" id="tab-conversion" onclick="showRegisterTab(\'conversion\')">💱 Conversion</button>' +
    '</div>' +

    // Panel foto
    '<div id="panel-photo" style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">' +
      '<div class="card">' +
        '<div class="card-header"><span class="card-title">📷 Subir Foto</span></div>' +
        '<div class="upload-zone" id="upload-zone">' +
          '<span class="upload-icon">🧾</span>' +
          '<div class="upload-text"><strong>Arrastra o clic aqui</strong><br>Factura, Binance, recibo...</div>' +
          '<input type="file" id="photo-input" accept="image/*" onchange="handlePhotoUpload(event)">' +
        '</div>' +
        '<div id="upload-preview" style="display:none" class="upload-preview"></div>' +
        '<div id="analysis-result" style="display:none;margin-top:1rem"></div>' +
        '<button id="analyze-btn" class="btn btn-primary" style="width:100%;margin-top:1rem;display:none" onclick="analyzePhoto()">🔍 Analizar con IA</button>' +
      '</div>' +
      '<div class="card" id="photo-form-panel" style="overflow-y:auto;max-height:80vh">' +
        '<div class="card-header"><span class="card-title">✏️ Confirmar datos</span></div>' +
        '<div id="photo-form-content"><div class="empty-state"><div class="empty-icon">👈</div><p>Sube y analiza una foto para ver los datos aqui</p></div></div>' +
      '</div>' +
    '</div>' +

    // Panel manual
    '<div id="panel-manual" style="display:none">' +
      '<div class="card" style="max-width:600px">' +
        '<div class="card-header"><span class="card-title">✏️ Registro Manual</span></div>' +
        renderTransactionForm(currencies) +
        '<button class="btn btn-primary" style="width:100%" onclick="saveTransaction()">💾 Guardar</button>' +
      '</div>' +
    '</div>' +

    // Panel conversion
    '<div id="panel-conversion" style="display:none">' +
      '<div class="card" style="max-width:600px">' +
        '<div class="card-header">' +
          '<span class="card-title">💱 Registrar Conversion entre Divisas</span>' +
        '</div>' +
        '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.25rem">' +
          'Usa esto cuando conviertas dinero entre divisas: USD→USDT, USDT→COP, USD→COP, etc. ' +
          'Se crean dos transacciones automaticamente (un gasto y un ingreso).' +
        '</p>' +
        '<div class="form-row">' +
          '<div class="form-group">' +
            '<label class="form-label">Divisa que SALE <span class="required">*</span></label>' +
            '<select class="form-control" id="conv-from-currency">' +
              currencies.map(function(c) { return '<option value="' + c.code + '">' + c.code + ' — ' + c.name + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Monto que SALE <span class="required">*</span></label>' +
            '<input type="number" class="form-control" id="conv-from-amount" placeholder="0.00" step="any" min="0">' +
          '</div>' +
        '</div>' +
        '<div style="text-align:center;font-size:1.5rem;margin:0.5rem 0;color:var(--accent)">↓</div>' +
        '<div class="form-row">' +
          '<div class="form-group">' +
            '<label class="form-label">Divisa que ENTRA <span class="required">*</span></label>' +
            '<select class="form-control" id="conv-to-currency">' +
              currencies.map(function(c) { return '<option value="' + c.code + '">' + c.code + ' — ' + c.name + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Monto que ENTRA <span class="required">*</span></label>' +
            '<input type="number" class="form-control" id="conv-to-amount" placeholder="0.00" step="any" min="0">' +
          '</div>' +
        '</div>' +
        '<div class="form-row">' +
          '<div class="form-group">' +
            '<label class="form-label">Fecha <span class="required">*</span></label>' +
            '<input type="date" class="form-control" id="conv-date" value="' + new Date().toISOString().split('T')[0] + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label">Plataforma</label>' +
            '<input type="text" class="form-control" id="conv-platform" placeholder="Binance P2P, Bancolombia...">' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Clasificacion</label>' +
          '<select class="form-control" id="conv-classification">' +
            '<option value="Empresa">Empresa</option>' +
            '<option value="Personal">Personal</option>' +
            '<option value="Mixto">Mixto</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Descripcion</label>' +
          '<input type="text" class="form-control" id="conv-description" placeholder="Ej: Venta USDT P2P Binance">' +
        '</div>' +
        '<div style="background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-bottom:1.25rem;font-size:0.85rem;color:var(--text-secondary)">' +
          '💡 Se crearan 2 transacciones: un <span style="color:var(--red)">Gasto</span> en la divisa que sale y un <span style="color:var(--accent)">Ingreso</span> en la divisa que entra.' +
        '</div>' +
        '<button class="btn btn-primary" style="width:100%" onclick="saveConversion()">💾 Registrar Conversion</button>' +
      '</div>' +
    '</div>';
}

function showRegisterTab(tab) {
  document.getElementById('panel-photo').style.display = tab === 'photo' ? 'grid' : 'none';
  document.getElementById('panel-manual').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('panel-conversion').style.display = tab === 'conversion' ? 'block' : 'none';

  document.getElementById('tab-photo').className = 'btn ' + (tab === 'photo' ? 'btn-primary' : 'btn-secondary');
  document.getElementById('tab-manual').className = 'btn ' + (tab === 'manual' ? 'btn-primary' : 'btn-secondary');
  document.getElementById('tab-conversion').className = 'btn ' + (tab === 'conversion' ? 'btn-primary' : 'btn-secondary');
}

function renderTransactionForm(currencies) {
  return '<div class="form-group">' +
    '<label class="form-label">Tipo <span class="required">*</span></label>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">' +
    '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer">' +
    '<input type="radio" name="tx-type" value="Gasto" checked onchange="onTypeChange()"> Gasto</label>' +
    '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer">' +
    '<input type="radio" name="tx-type" value="Ingreso" onchange="onTypeChange()"> Ingreso</label>' +
    '</div></div>' +
    '<div id="classification-group" class="form-group">' +
    '<label class="form-label">Clasificacion</label>' +
    '<select class="form-control" id="tx-classification" onchange="onClassificationChange()">' +
    '<option value="Empresa">Empresa</option><option value="Personal">Personal</option><option value="Mixto">Mixto</option>' +
    '</select></div>' +
    '<div id="percentage-group" class="form-group" style="display:none">' +
    '<label class="form-label">% Empresa</label>' +
    '<input type="number" class="form-control" id="tx-percentage" min="1" max="99" value="50">' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Monto <span class="required">*</span></label>' +
    '<input type="number" class="form-control" id="tx-amount" placeholder="0.00" step="any" min="0"></div>' +
    '<div class="form-group"><label class="form-label">Divisa <span class="required">*</span></label>' +
    '<select class="form-control" id="tx-currency">' +
    currencies.map(function(c) { return '<option value="' + c.code + '">' + c.code + '</option>'; }).join('') +
    '</select></div></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Fecha <span class="required">*</span></label>' +
    '<input type="date" class="form-control" id="tx-date" value="' + new Date().toISOString().split('T')[0] + '"></div>' +
    '<div class="form-group" id="category-group"><label class="form-label">Categoria</label>' +
    '<select class="form-control" id="tx-category">' +
    CATEGORIES.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
    '</select></div></div>' +
    '<div class="form-group"><label class="form-label">Descripcion</label>' +
    '<input type="text" class="form-control" id="tx-description" placeholder="Descripcion opcional..."></div>';
}

function onTypeChange() {
  var type = document.querySelector('input[name="tx-type"]:checked');
  type = type ? type.value : 'Gasto';
  var classGroup = document.getElementById('classification-group');
  if (classGroup) classGroup.style.display = type === 'Ingreso' ? 'none' : 'block';
  if (type === 'Ingreso') {
    var pctGroup = document.getElementById('percentage-group');
    if (pctGroup) pctGroup.style.display = 'none';
  } else {
    onClassificationChange();
  }
}

function onClassificationChange() {
  var cls = document.getElementById('tx-classification');
  cls = cls ? cls.value : 'Empresa';
  var pctGroup = document.getElementById('percentage-group');
  if (pctGroup) pctGroup.style.display = cls === 'Mixto' ? 'block' : 'none';
}

let photoFile = null;
let photoData = null;

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  photoFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('upload-preview');
    preview.style.display = 'flex';
    preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;

    document.getElementById('analyze-btn').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function analyzePhoto() {
  if (!photoFile) return;
  if (!ClaudeAPI.isConfigured()) {
    showToast('Claude API key no configurada.', 'error');
    return;
  }
  var btn = document.getElementById('analyze-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Analizando...';
  try {
    var base64 = await ClaudeAPI.fileToBase64(photoFile);
    var mimeType = ClaudeAPI.getMimeType(photoFile);
    var result = await ClaudeAPI.analyzeImage(base64, mimeType);
    photoData = result;
    displayAnalysisResult(result);
    showToast('Imagen analizada con éxito', 'success');
  } catch(err) {
    showToast('Error analizando imagen: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Analizar con IA';
  }
}

function displayAnalysisResult(result) {
  var container = document.getElementById('analysis-result');
  if (!container) return;
  var confidence = Math.round((result.confidence || 0) * 100);
  var hasUncertain = result.uncertain_fields && result.uncertain_fields.length > 0;
  container.style.display = 'block';
  container.innerHTML = '<div class="analysis-card">' +
    '<div class="analysis-header">✨ Análisis IA — Confianza: ' + confidence + '%</div>' +
    '<div class="confidence-bar"><div class="confidence-fill" style="width:' + confidence + '%"></div></div>' +
    (hasUncertain ? '<div style="margin-top:0.75rem;padding:0.6rem;background:var(--yellow-dim);border-radius:6px;font-size:0.8rem;color:var(--yellow)">⚠️ Verifica: ' + result.uncertain_fields.join(', ') + '</div>' : '') +
    (result.notes ? '<div style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted)">' + escapeHtml(result.notes) + '</div>' : '') +
    '</div>';
  if (result.transaction_kind === 'unknown') {
    showUnknownForm(result);
  } else if (result.transaction_kind === 'conversion') {
    showConversionConfirm(result);
  } else {
    showSimpleConfirm(result);
  }
}

function showConversionConfirm(result) {
  var el = document.getElementById('photo-form-content');
  if (!el) return;
  var currencies = Currency.getAll();
  el.innerHTML = '<div style="background:var(--blue-dim);border:1px solid rgba(96,165,250,0.3);border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.82rem;color:var(--blue)">🔄 Conversión detectada via ' + escapeHtml(result.platform || 'plataforma') + '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Monto que SALE</label><input type="number" class="form-control" id="cf-from-amount" value="' + (result.from_amount || '') + '" step="any"></div>' +
    '<div class="form-group"><label class="form-label">Divisa que SALE</label><select class="form-control" id="cf-from-currency">' + currencies.map(function(c){ return '<option value="'+c.code+'" '+(c.code===result.from_currency?'selected':'')+'>'+c.code+'</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<div style="text-align:center;font-size:1.5rem;color:var(--accent)">↓</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Monto que ENTRA</label><input type="number" class="form-control" id="cf-to-amount" value="' + (result.to_amount || '') + '" step="any"></div>' +
    '<div class="form-group"><label class="form-label">Divisa que ENTRA</label><select class="form-control" id="cf-to-currency">' + currencies.map(function(c){ return '<option value="'+c.code+'" '+(c.code===result.to_currency?'selected':'')+'>'+c.code+'</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cf-date" value="' + (result.date || new Date().toISOString().split('T')[0]) + '"></div>' +
    '<div class="form-group"><label class="form-label">Clasificacion</label><select class="form-control" id="cf-classification"><option value="Empresa">Empresa</option><option value="Personal">Personal</option><option value="Mixto">Mixto</option></select></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Descripcion</label><input type="text" class="form-control" id="cf-description" value="' + escapeHtml(result.description || '') + '"></div>' +
    '<button class="btn btn-primary" style="width:100%" onclick="saveConversionFromPhoto()">💾 Guardar Conversión</button>';
}

function showSimpleConfirm(result) {
  var el = document.getElementById('photo-form-content');
  if (!el) return;
  var currencies = Currency.getAll();
  var isIncome = result.transaction_kind === 'income';
  var amount = result.amount || '';
  var currency = result.currency || 'COP';
  var date = result.date || new Date().toISOString().split('T')[0];
  var concept = result.concept || '';
  var category = result.category || 'Otro';
  el.innerHTML = '<div style="background:' + (isIncome ? 'var(--accent-dim)' : 'var(--red-dim)') + ';border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.82rem">' + (isIncome ? '💚 Ingreso detectado' : '🔴 Gasto detectado') + (result.platform ? ' via ' + escapeHtml(result.platform) : '') + '</div>' +
    '<div class="form-group"><label class="form-label">Tipo</label>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">' +
    '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer"><input type="radio" name="cf-type" value="Gasto" ' + (!isIncome ? 'checked' : '') + '> Gasto</label>' +
    '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer"><input type="radio" name="cf-type" value="Ingreso" ' + (isIncome ? 'checked' : '') + '> Ingreso</label>' +
    '</div></div>' +
    '<div class="form-group"><label class="form-label">Clasificacion</label><select class="form-control" id="cf-simple-classification"><option value="Empresa">Empresa</option><option value="Personal">Personal</option><option value="Mixto">Mixto</option></select></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Monto</label><input type="number" class="form-control" id="cf-simple-amount" value="' + amount + '" step="any"></div>' +
    '<div class="form-group"><label class="form-label">Divisa</label><select class="form-control" id="cf-simple-currency">' + currencies.map(function(c){ return '<option value="'+c.code+'" '+(c.code===currency?'selected':'')+'>'+c.code+'</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Fecha</label><input type="date" class="form-control" id="cf-simple-date" value="' + date + '"></div>' +
    '<div class="form-group"><label class="form-label">Categoria</label><select class="form-control" id="cf-simple-category">' + CATEGORIES.map(function(c){ return '<option value="'+c+'" '+(c===category?'selected':'')+'>'+c+'</option>'; }).join('') + '</select></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Descripcion</label><input type="text" class="form-control" id="cf-simple-description" value="' + escapeHtml(concept) + '"></div>' +
    '<button class="btn btn-primary" style="width:100%" onclick="saveSimpleFromPhoto()">💾 Guardar</button>';
}

function showUnknownForm(result) {
  var el = document.getElementById('photo-form-content');
  if (!el) return;
  el.innerHTML = '<div style="background:var(--yellow-dim);border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.85rem;color:var(--yellow)">⚠️ ' + escapeHtml(result.notes || 'No pude determinar el tipo. Selecciona manualmente:') + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:0.75rem">' +
    '<button class="btn btn-secondary" onclick="showRegisterTab(\'conversion\')">💱 Es una Conversión entre divisas</button>' +
    '<button class="btn btn-secondary" onclick="showRegisterTab(\'manual\')">✏️ Es un Ingreso o Gasto simple</button>' +
    '</div>';
}

async function saveConversionFromPhoto() {
  var fromAmount = parseFloat(document.getElementById('cf-from-amount').value);
  var fromCurrency = document.getElementById('cf-from-currency').value;
  var toAmount = parseFloat(document.getElementById('cf-to-amount').value);
  var toCurrency = document.getElementById('cf-to-currency').value;
  var date = document.getElementById('cf-date').value;
  var classification = document.getElementById('cf-classification').value;
  var description = document.getElementById('cf-description').value;
  if (!fromAmount || !toAmount || !date) { showToast('Completa todos los campos', 'error'); return; }
  var rate = toAmount / fromAmount;
  var desc = description || ('Conversion ' + fromCurrency + ' a ' + toCurrency);
  var txOut = { id: generateId(), date: date, type: 'Gasto', classification: classification, amount: fromAmount, currency: fromCurrency, category: 'Conversion', description: desc + ' [SALIDA]', percentage: '', originalAmount: fromAmount, originalCurrency: fromCurrency, exchangeRate: rate };
  var txIn = { id: generateId(), date: date, type: 'Ingreso', classification: classification, amount: toAmount, currency: toCurrency, category: 'Conversion', description: desc + ' [ENTRADA]', percentage: '', originalAmount: fromAmount, originalCurrency: fromCurrency, exchangeRate: rate };
  showLoading('Guardando...');
  try {
    await GoogleSheets.addTransaction(App.spreadsheetId, txOut);
    await GoogleSheets.addTransaction(App.spreadsheetId, txIn);
    App.transactions.push(txOut);
    App.transactions.push(txIn);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Conversion guardada ✓', 'success');
    renderRegister();
  } catch(err) { hideLoading(); showToast('Error: ' + err.message, 'error'); }
}

async function saveSimpleFromPhoto() {
  var typeEl = document.querySelector('input[name="cf-type"]:checked');
  var type = typeEl ? typeEl.value : 'Gasto';
  var amount = parseFloat(document.getElementById('cf-simple-amount').value);
  var currency = document.getElementById('cf-simple-currency').value;
  var date = document.getElementById('cf-simple-date').value;
  var classification = document.getElementById('cf-simple-classification').value;
  var category = document.getElementById('cf-simple-category').value;
  var description = document.getElementById('cf-simple-description').value;
  if (!amount || !date) { showToast('Completa los campos requeridos', 'error'); return; }
  var tx = { id: generateId(), date: date, type: type, classification: type === 'Ingreso' ? '' : classification, amount: amount, currency: currency, category: type === 'Gasto' ? category : '', description: description, percentage: '', originalAmount: '', originalCurrency: '', exchangeRate: '' };
  showLoading('Guardando...');
  try {
    await GoogleSheets.addTransaction(App.spreadsheetId, tx);
    App.transactions.push(tx);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Guardado ✓', 'success');
    renderRegister();
  } catch(err) { hideLoading(); showToast('Error: ' + err.message, 'error'); }
}

async function saveConversion() {
  var fromCurrency = document.getElementById('conv-from-currency').value;
  var fromAmount = parseFloat(document.getElementById('conv-from-amount').value);
  var toCurrency = document.getElementById('conv-to-currency').value;
  var toAmount = parseFloat(document.getElementById('conv-to-amount').value);
  var date = document.getElementById('conv-date').value;
  var platform = document.getElementById('conv-platform').value;
  var classification = document.getElementById('conv-classification').value;
  var description = document.getElementById('conv-description').value;

  if (!fromAmount || isNaN(fromAmount) || !toAmount || isNaN(toAmount) || !date) {
    showToast('Completa todos los campos requeridos', 'error');
    return;
  }
  if (fromCurrency === toCurrency) {
    showToast('Las divisas de origen y destino deben ser diferentes', 'error');
    return;
  }

  var desc = description || ('Conversion ' + fromCurrency + ' a ' + toCurrency + (platform ? ' via ' + platform : ''));
  var rate = toAmount / fromAmount;

  var txOut = {
    id: generateId(),
    date: date,
    type: 'Gasto',
    classification: classification,
    amount: fromAmount,
    currency: fromCurrency,
    category: 'Conversion',
    description: desc + ' [SALIDA]',
    percentage: '',
    originalAmount: fromAmount,
    originalCurrency: fromCurrency,
    exchangeRate: rate
  };

  var txIn = {
    id: generateId(),
    date: date,
    type: 'Ingreso',
    classification: classification,
    amount: toAmount,
    currency: toCurrency,
    category: 'Conversion',
    description: desc + ' [ENTRADA]',
    percentage: '',
    originalAmount: fromAmount,
    originalCurrency: fromCurrency,
    exchangeRate: rate
  };

  showLoading('Guardando conversion...');
  try {
    await GoogleSheets.addTransaction(App.spreadsheetId, txOut);
    await GoogleSheets.addTransaction(App.spreadsheetId, txIn);
    App.transactions.push(txOut);
    App.transactions.push(txIn);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Conversion registrada: -' + fromAmount + ' ' + fromCurrency + ' / +' + toAmount + ' ' + toCurrency, 'success');
    renderRegister();
  } catch(err) {
    App.transactions.push(txOut);
    App.transactions.push(txIn);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Guardado localmente', 'info');
    renderRegister();
  }
}

async function saveTransaction() {
  const type = document.querySelector('input[name="tx-type"]:checked')?.value;
  const amount = parseFloat(document.getElementById('tx-amount')?.value);
  const currency = document.getElementById('tx-currency')?.value;
  const date = document.getElementById('tx-date')?.value;
  const description = document.getElementById('tx-description')?.value;
  const category = document.getElementById('tx-category')?.value;
  const classification = type === 'Gasto' ? document.getElementById('tx-classification')?.value : '';
  const percentage = classification === 'Mixto' ? document.getElementById('tx-percentage')?.value : '';

  // Validación
  if (!type || !amount || isNaN(amount) || amount <= 0 || !currency || !date) {
    showToast('Completa los campos requeridos (Tipo, Monto, Divisa, Fecha)', 'error');
    return;
  }

  const transaction = {
    id: generateId(),
    date,
    type,
    classification,
    amount,
    currency,
    category: type === 'Gasto' ? category : '',
    description,
    percentage,
    originalAmount: '',
    originalCurrency: '',
    exchangeRate: ''
  };

  // Si la divisa no es permanente, guardar tasa de cambio
  const currencyObj = Currency.getByCode(currency);
  if (currencyObj && !currencyObj.isPermanent) {
    transaction.originalAmount = amount;
    transaction.originalCurrency = currency;
    transaction.exchangeRate = currencyObj.rate;
  }

  showLoading('Guardando...');
  try {
    await GoogleSheets.addTransaction(App.spreadsheetId, transaction);
    App.transactions.push(transaction);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Transacción guardada ✓', 'success');

    // Limpiar formulario
    renderRegister();
  } catch (err) {
    // Guardar en cache offline
    App.transactions.push(transaction);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Guardado localmente (sin conexión)', 'info');
    renderRegister();
  }
}

// ============================================================
// HISTORIAL
// ============================================================

function renderHistory() {
  const content = document.getElementById('tab-content');
  const currencies = Currency.getAll();

  content.innerHTML = `
    <div class="top-bar">
      <div class="page-title">Historial</div>
      <button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>
    </div>

    <div class="filters-bar">
      <div class="filter-group">
        <span class="filter-label">Tipo</span>
        <select class="filter-select" id="filter-type" onchange="applyHistoryFilters()">
          <option value="all">Todos</option>
          <option value="Ingreso">Ingresos</option>
          <option value="Gasto">Gastos</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">Divisa</span>
        <select class="filter-select" id="filter-currency" onchange="applyHistoryFilters()">
          <option value="all">Todas</option>
          ${currencies.map(c => `<option value="${c.code}">${c.code}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">Categoría</span>
        <select class="filter-select" id="filter-category" onchange="applyHistoryFilters()">
          <option value="all">Todas</option>
          ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <span class="filter-label">Mes</span>
        <select class="filter-select" id="filter-month-h" onchange="applyHistoryFilters()">
          <option value="all">Todos</option>
          ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((m,i) =>
            `<option value="${i+1}" ${i+1===App.filters.month?'selected':''}>${m}</option>`
          ).join('')}
        </select>
      </div>
      <input type="text" class="filter-select" id="filter-search" placeholder="Buscar..." oninput="applyHistoryFilters()" style="min-width:150px">
    </div>

    <div class="card" style="padding:0">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Clasificación</th>
              <th>Monto</th>
              <th>Divisa</th>
              <th>Categoría</th>
              <th>Descripción</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="history-tbody">
          </tbody>
        </table>
      </div>
    </div>
  `;

  applyHistoryFilters();
}

function applyHistoryFilters() {
  const type = document.getElementById('filter-type')?.value || 'all';
  const currency = document.getElementById('filter-currency')?.value || 'all';
  const category = document.getElementById('filter-category')?.value || 'all';
  const month = document.getElementById('filter-month-h')?.value || 'all';
  const search = document.getElementById('filter-search')?.value?.toLowerCase() || '';

  let filtered = [...App.transactions];

  if (type !== 'all') filtered = filtered.filter(tx => tx.type === type);
  if (currency !== 'all') filtered = filtered.filter(tx => tx.currency === currency);
  if (category !== 'all') filtered = filtered.filter(tx => tx.category === category);
  if (month !== 'all') {
    filtered = filtered.filter(tx => {
      const d = new Date(tx.date);
      return d.getMonth() + 1 === parseInt(month);
    });
  }
  if (search) {
    filtered = filtered.filter(tx =>
      (tx.description || '').toLowerCase().includes(search) ||
      (tx.category || '').toLowerCase().includes(search) ||
      (tx.type || '').toLowerCase().includes(search)
    );
  }

  // Ordenar por fecha desc
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>Sin resultados</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(tx => `
    <tr>
      <td style="white-space:nowrap">${formatDateShort(tx.date)}</td>
      <td><span class="badge ${tx.type === 'Ingreso' ? 'badge-income' : 'badge-expense'}">${tx.type}</span></td>
      <td>
        ${tx.classification ? `<span class="badge badge-${(tx.classification||'').toLowerCase()}">${tx.classification}${tx.classification === 'Mixto' ? ` (${tx.percentage}%)` : ''}</span>` : '—'}
      </td>
      <td class="td-amount ${tx.type === 'Ingreso' ? 'income' : 'expense'}">
        ${tx.type === 'Ingreso' ? '+' : '-'}${Currency.format(tx.amount, tx.currency)}
      </td>
      <td><span class="badge badge-empresa">${tx.currency}</span></td>
      <td>${tx.category || '—'}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(tx.description || '')}">${escapeHtml(tx.description || '—')}</td>
      <td>
        <div style="display:flex;gap:0.4rem">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="editTransaction('${tx.id}')" title="Editar">✏️</button>
          <button class="btn btn-danger btn-icon btn-sm" onclick="deleteTransaction('${tx.id}')" title="Eliminar">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function editTransaction(id) {
  const tx = App.transactions.find(t => t.id === id);
  if (!tx) return;

  const currencies = Currency.getAll();

  const modal = createModal('Editar Transacción', `
    <div class="form-group">
      <label class="form-label">Tipo</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <input type="radio" name="edit-type" value="Gasto" ${tx.type==='Gasto'?'checked':''} onchange="onEditTypeChange()"> Gasto
        </label>
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <input type="radio" name="edit-type" value="Ingreso" ${tx.type==='Ingreso'?'checked':''} onchange="onEditTypeChange()"> Ingreso
        </label>
      </div>
    </div>
    <div id="edit-classification-group" class="form-group" style="${tx.type==='Ingreso'?'display:none':''}">
      <label class="form-label">Clasificación</label>
      <select class="form-control" id="edit-classification" onchange="onEditClassChange()">
        <option value="Empresa" ${tx.classification==='Empresa'?'selected':''}>Empresa</option>
        <option value="Personal" ${tx.classification==='Personal'?'selected':''}>Personal</option>
        <option value="Mixto" ${tx.classification==='Mixto'?'selected':''}>Mixto</option>
      </select>
    </div>
    <div id="edit-percentage-group" class="form-group" style="${tx.classification!=='Mixto'?'display:none':''}">
      <label class="form-label">% Empresa</label>
      <input type="number" class="form-control" id="edit-percentage" value="${tx.percentage||50}" min="1" max="99">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Monto</label>
        <input type="number" class="form-control" id="edit-amount" value="${tx.amount}" step="any" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Divisa</label>
        <select class="form-control" id="edit-currency">
          ${currencies.map(c => `<option value="${c.code}" ${tx.currency===c.code?'selected':''}>${c.code}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha</label>
        <input type="date" class="form-control" id="edit-date" value="${tx.date}">
      </div>
      <div class="form-group" id="edit-category-group">
        <label class="form-label">Categoría</label>
        <select class="form-control" id="edit-category">
          ${CATEGORIES.map(c => `<option value="${c}" ${tx.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Descripción</label>
      <input type="text" class="form-control" id="edit-description" value="${escapeHtml(tx.description||'')}">
    </div>
  `, async () => {
    const updated = {
      ...tx,
      type: document.querySelector('input[name="edit-type"]:checked')?.value,
      classification: document.getElementById('edit-classification')?.value || '',
      percentage: document.getElementById('edit-percentage')?.value || '',
      amount: parseFloat(document.getElementById('edit-amount')?.value),
      currency: document.getElementById('edit-currency')?.value,
      date: document.getElementById('edit-date')?.value,
      category: document.getElementById('edit-category')?.value,
      description: document.getElementById('edit-description')?.value
    };

    if (updated.type === 'Ingreso') updated.classification = '';

    showLoading('Actualizando...');
    try {
      await GoogleSheets.updateTransaction(App.spreadsheetId, updated);
      const idx = App.transactions.findIndex(t => t.id === id);
      if (idx !== -1) App.transactions[idx] = updated;
      Storage.setTransactionsCache(App.transactions);
      hideLoading();
      closeModal();
      showToast('Transacción actualizada', 'success');
      renderHistory();
    } catch (err) {
      hideLoading();
      showToast('Error: ' + err.message, 'error');
    }
  });
}

function onEditTypeChange() {
  const type = document.querySelector('input[name="edit-type"]:checked')?.value;
  const clsGroup = document.getElementById('edit-classification-group');
  if (clsGroup) clsGroup.style.display = type === 'Ingreso' ? 'none' : 'block';
  if (type === 'Ingreso') {
    const pctGroup = document.getElementById('edit-percentage-group');
    if (pctGroup) pctGroup.style.display = 'none';
  }
}

function onEditClassChange() {
  const cls = document.getElementById('edit-classification')?.value;
  const pctGroup = document.getElementById('edit-percentage-group');
  if (pctGroup) pctGroup.style.display = cls === 'Mixto' ? 'block' : 'none';
}

async function deleteTransaction(id) {
  if (!confirm('¿Seguro que deseas eliminar esta transacción? Esta acción no se puede deshacer.')) return;

  showLoading('Eliminando...');
  try {
    await GoogleSheets.deleteTransaction(App.spreadsheetId, id);
    App.transactions = App.transactions.filter(t => t.id !== id);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Transacción eliminada', 'success');
    renderHistory();
  } catch (err) {
    hideLoading();
    showToast('Error: ' + err.message, 'error');
  }
}

// ============================================================
// DIVISAS
// ============================================================

function renderCurrencies() {
  const content = document.getElementById('tab-content');
  const currencies = Currency.getAll();

  content.innerHTML = `
    <div class="top-bar">
      <div class="page-title">Gestión de Divisas</div>
      <div class="top-actions">
        <button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>
        <button class="btn btn-primary btn-sm" onclick="showAddCurrencyModal()">+ Agregar divisa</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.5rem;padding:1rem 1.5rem">
      <p style="font-size:0.85rem;color:var(--text-secondary)">
        💡 Las tasas de cambio se usan para convertir a COP equivalente. Actualiza regularmente para mayor precisión.
        Las divisas permanentes (COP, USD, USDT, VES) no se pueden eliminar.
      </p>
    </div>

    <div class="currency-grid" id="currency-grid">
      ${currencies.map(c => renderCurrencyCard(c)).join('')}
    </div>
  `;
}

function renderCurrencyCard(c) {
  return `
    <div class="currency-card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem">
        <div>
          <div class="currency-code">${c.code}</div>
          <div class="currency-name">${c.name}</div>
        </div>
        ${c.isPermanent
          ? '<span class="currency-permanent-badge">Permanente</span>'
          : `<button class="btn btn-danger btn-icon btn-sm" onclick="removeCurrency('${c.code}')" title="Eliminar">✕</button>`
        }
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.4rem">
        1 ${c.code} = ? COP
      </div>
      <div class="currency-rate-row">
        <input
          type="number"
          class="currency-rate-input"
          value="${c.rate}"
          step="any"
          min="0"
          id="rate-${c.code}"
          placeholder="Tasa en COP"
        >
        <button class="btn btn-secondary btn-sm" onclick="updateCurrencyRate('${c.code}')">✓</button>
      </div>
    </div>
  `;
}

function updateCurrencyRate(code) {
  const input = document.getElementById(`rate-${code}`);
  const newRate = parseFloat(input?.value);

  if (isNaN(newRate) || newRate <= 0) {
    showToast('Ingresa una tasa válida', 'error');
    return;
  }

  if (Currency.updateRate(code, newRate)) {
    showToast(`Tasa ${code} actualizada a ${newRate}`, 'success');
  }
}

function showAddCurrencyModal() {
  createModal('Agregar Divisa Temporal', `
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.25rem">
      Las divisas temporales son útiles para viajes o gastos ocasionales. Puedes eliminarlas cuando ya no las necesites.
    </p>
    <div class="form-group">
      <label class="form-label">Código <span class="required">*</span></label>
      <input type="text" class="form-control" id="new-currency-code" placeholder="MXN, EUR, BRL..." maxlength="5" style="text-transform:uppercase">
      <div class="form-hint">3-5 letras (ej: MXN, EUR, GBP)</div>
    </div>
    <div class="form-group">
      <label class="form-label">Nombre <span class="required">*</span></label>
      <input type="text" class="form-control" id="new-currency-name" placeholder="Peso Mexicano">
    </div>
    <div class="form-group">
      <label class="form-label">Tasa a COP <span class="required">*</span></label>
      <input type="number" class="form-control" id="new-currency-rate" placeholder="0.00" step="any" min="0">
      <div class="form-hint">Cuántos COP equivale 1 unidad de esta divisa</div>
    </div>
  `, () => {
    const code = document.getElementById('new-currency-code')?.value.toUpperCase().trim();
    const name = document.getElementById('new-currency-name')?.value.trim();
    const rate = parseFloat(document.getElementById('new-currency-rate')?.value);

    if (!code || !name || isNaN(rate) || rate <= 0) {
      showToast('Completa todos los campos', 'error');
      return false; // No cerrar modal
    }

    if (Currency.addTemporary(code, name, rate)) {
      showToast(`Divisa ${code} agregada`, 'success');
      closeModal();
      renderCurrencies();
    } else {
      showToast(`La divisa ${code} ya existe`, 'error');
    }
  });
}

function removeCurrency(code) {
  if (!confirm(`¿Eliminar la divisa ${code}? Las transacciones existentes mantendrán sus valores.`)) return;

  if (Currency.removeTemporary(code)) {
    showToast(`Divisa ${code} eliminada`, 'success');
    renderCurrencies();
  } else {
    showToast('No se puede eliminar esta divisa', 'error');
  }
}

// ============================================================
// REPORTES
// ============================================================

function renderReports() {
  const content = document.getElementById('tab-content');
  const now = new Date();
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  content.innerHTML = `
    <div class="top-bar">
      <div class="page-title">Reportes & Exportar</div>
      <button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
      <div class="card">
        <div class="card-header">
          <span class="card-title">📥 Exportar a Excel</span>
        </div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1.25rem">
          Descarga tus transacciones en formato CSV (compatible con Excel, Google Sheets, etc.)
        </p>
        <div style="display:flex;flex-direction:column;gap:0.75rem">
          <button class="btn btn-secondary" onclick="exportCSV('month')">
            📅 Solo mes actual (${monthNames[now.getMonth()]} ${now.getFullYear()})
          </button>
          <button class="btn btn-secondary" onclick="exportCSV('all')">
            📚 Historial completo
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">📊 Estadísticas generales</span>
        </div>
        <div id="stats-general"></div>
      </div>
    </div>

    <div class="card" style="margin-top:1.5rem">
      <div class="card-header">
        <span class="card-title">Evolución mensual (últimos 6 meses)</span>
      </div>
      <div id="monthly-evolution"></div>
    </div>
  `;

  renderGeneralStats();
  renderMonthlyEvolution();
}

function renderGeneralStats() {
  const container = document.getElementById('stats-general');
  if (!container) return;

  const total = App.transactions.length;
  const incomes = App.transactions.filter(t => t.type === 'Ingreso').length;
  const expenses = App.transactions.filter(t => t.type === 'Gasto').length;

  const totalIncomeCOP = App.transactions
    .filter(t => t.type === 'Ingreso')
    .reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);

  const totalExpCOP = App.transactions
    .filter(t => t.type === 'Gasto')
    .reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.6rem">
      <div style="display:flex;justify-content:space-between;font-size:0.85rem">
        <span class="text-muted">Total transacciones</span>
        <span class="text-mono">${total}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem">
        <span class="text-muted">Ingresos</span>
        <span class="text-mono text-accent">${incomes}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem">
        <span class="text-muted">Gastos</span>
        <span class="text-mono text-red">${expenses}</span>
      </div>
      <div class="divider-h"></div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem">
        <span class="text-muted">Total ingresos (COP)</span>
        <span class="text-mono text-accent">${Currency.format(totalIncomeCOP, 'COP')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem">
        <span class="text-muted">Total gastos (COP)</span>
        <span class="text-mono text-red">${Currency.format(totalExpCOP, 'COP')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;font-weight:600">
        <span>Balance neto (COP)</span>
        <span class="text-mono" style="color:${totalIncomeCOP-totalExpCOP>=0?'var(--accent)':'var(--red)'}">${Currency.format(totalIncomeCOP - totalExpCOP, 'COP')}</span>
      </div>
    </div>
  `;
}

function renderMonthlyEvolution() {
  const container = document.getElementById('monthly-evolution');
  if (!container) return;

  const now = new Date();
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const data = months.map(({ year, month }) => {
    const txs = App.transactions.filter(tx => {
      const d = new Date(tx.date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    const income = txs.filter(t => t.type === 'Ingreso').reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);
    const expense = txs.filter(t => t.type === 'Gasto').reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);
    return { label: monthNames[month - 1], income, expense };
  });

  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);

  container.innerHTML = `
    <div style="display:flex;align-items:flex-end;gap:1rem;height:160px;padding:0 0.5rem">
      ${data.map(d => {
        const incPct = (d.income / maxVal * 100).toFixed(1);
        const expPct = (d.expense / maxVal * 100).toFixed(1);
        return `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0.3rem;height:100%">
            <div style="flex:1;width:100%;display:flex;align-items:flex-end;gap:2px">
              <div style="flex:1;background:var(--accent);border-radius:3px 3px 0 0;height:${incPct}%;min-height:${d.income>0?'3px':'0'};opacity:0.8"></div>
              <div style="flex:1;background:var(--red);border-radius:3px 3px 0 0;height:${expPct}%;min-height:${d.expense>0?'3px':'0'};opacity:0.8"></div>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted)">${d.label}</div>
          </div>
        `;
      }).join('')}
    </div>
    <div style="display:flex;gap:1.5rem;margin-top:0.75rem;justify-content:center">
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.78rem">
        <div style="width:10px;height:10px;background:var(--accent);border-radius:2px"></div>
        Ingresos
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.78rem">
        <div style="width:10px;height:10px;background:var(--red);border-radius:2px"></div>
        Gastos
      </div>
    </div>
  `;
}

function exportCSV(mode) {
  let data = [...App.transactions];

  if (mode === 'month') {
    const now = new Date();
    data = data.filter(tx => {
      const d = new Date(tx.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
  }

  data.sort((a, b) => new Date(a.date) - new Date(b.date));

  const headers = ['Fecha', 'Tipo', 'Clasificacion', 'Monto', 'Divisa', 'Categoria', 'Descripcion', '% Mixto', 'Monto COP Equiv'];

  const rows = data.map(tx => [
    tx.date,
    tx.type,
    tx.classification || '',
    tx.amount,
    tx.currency,
    tx.category || '',
    (tx.description || '').replace(/,/g, ';'),
    tx.percentage || '',
    Currency.toCOP(tx.amount, tx.currency).toFixed(0)
  ]);

  // Totales
  rows.push([]);
  const totalIncome = data.filter(t => t.type === 'Ingreso').reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);
  const totalExp = data.filter(t => t.type === 'Gasto').reduce((s, t) => s + Currency.toCOP(t.amount, t.currency), 0);
  rows.push(['TOTAL INGRESOS (COP)', '', '', '', '', '', '', '', totalIncome.toFixed(0)]);
  rows.push(['TOTAL GASTOS (COP)', '', '', '', '', '', '', '', totalExp.toFixed(0)]);
  rows.push(['NETO (COP)', '', '', '', '', '', '', '', (totalIncome - totalExp).toFixed(0)]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fintrack-${mode === 'month' ? 'mes-actual' : 'historico'}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Archivo exportado', 'success');
}

// ============================================================
// CONFIGURACIÓN
// ============================================================

function renderSettings() {
  const content = document.getElementById('tab-content');
  const theme = Storage.getTheme();
  const sheetId = App.spreadsheetId;

  content.innerHTML = `
    <div class="top-bar">
      <div class="page-title">Configuración</div>
      <button class="btn btn-ghost btn-sm hamburger" onclick="toggleSidebar()">☰</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:1.5rem;max-width:600px">
      <div class="card">
        <div class="card-header"><span class="card-title">Apariencia</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:0.9rem;font-weight:500">Tema</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Elige entre modo oscuro o claro</div>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn ${theme==='dark'?'btn-primary':'btn-secondary'} btn-sm" onclick="setTheme('dark')">🌙 Oscuro</button>
            <button class="btn ${theme==='light'?'btn-primary':'btn-secondary'} btn-sm" onclick="setTheme('light')">☀️ Claro</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Google Sheets</span></div>
        <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem">
          Hoja conectada: <code style="font-family:var(--font-mono);color:var(--text-primary)">${sheetId || 'Ninguna'}</code>
        </div>
        <div style="display:flex;gap:0.75rem">
          <button class="btn btn-secondary btn-sm" onclick="changeSheet()">🔄 Cambiar hoja</button>
          ${sheetId ? `
            <a href="https://docs.google.com/spreadsheets/d/${sheetId}" target="_blank" class="btn btn-secondary btn-sm">📊 Abrir en Sheets</a>
          ` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Datos</span></div>
        <div style="display:flex;flex-direction:column;gap:0.75rem">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:0.9rem;font-weight:500">Sincronizar</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">Recargar datos desde Google Sheets</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="syncData()">🔄 Sincronizar</button>
          </div>
          <div class="divider-h"></div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:0.9rem;font-weight:500">Borrar caché local</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">Limpia datos guardados en el navegador</div>
            </div>
            <button class="btn btn-danger btn-sm" onclick="clearCache()">🗑️ Borrar caché</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Sesión</span></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:0.9rem;font-weight:500">Cerrar sesión</div>
            <div style="font-size:0.8rem;color:var(--text-muted)">Se eliminarán los tokens guardados</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="logout()">👋 Cerrar sesión</button>
        </div>
      </div>
    </div>
  `;
}

function setTheme(theme) {
  Storage.setTheme(theme);
  document.documentElement.setAttribute('data-theme', theme);
  renderSettings();
}

function changeSheet() {
  Storage.remove('spreadsheet_id');
  App.spreadsheetId = null;
  showSheetSelector();
}

async function syncData() {
  if (!App.spreadsheetId) return;
  showLoading('Sincronizando...');
  try {
    App.transactions = await GoogleSheets.readTransactions(App.spreadsheetId);
    Storage.setTransactionsCache(App.transactions);
    hideLoading();
    showToast('Datos sincronizados ✓', 'success');
  } catch (err) {
    hideLoading();
    showToast('Error sincronizando: ' + err.message, 'error');
  }
}

function clearCache() {
  if (!confirm('¿Borrar caché local? Los datos en Google Sheets no se verán afectados.')) return;
  Storage.remove('transactions_cache');
  showToast('Caché borrada', 'success');
}

function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  GoogleSheets.logout();
  Storage.clearToken();
  App.transactions = [];
  App.user = null;
  App.spreadsheetId = null;
  showLogin();
}

// ============================================================
// UI HELPERS
// ============================================================

function showLoading(text = 'Cargando...') {
  let overlay = document.getElementById('loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <div class="loading-text" id="loading-text">${text}</div>
      </div>
    `;
    document.body.appendChild(overlay);
  } else {
    document.getElementById('loading-text').textContent = text;
    overlay.style.display = 'flex';
  }
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';
}

let toastTimeout;
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createModal(title, body, onConfirm) {
  closeModal();

  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="modal-confirm-btn">Confirmar</button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.getElementById('modal-confirm-btn', overlay)?.addEventListener('click', () => {
    if (onConfirm && onConfirm() !== false) {
      // onConfirm handles closing
    }
  });

  // Fix: attach listener after append
  document.body.appendChild(overlay);
  const confirmBtn = overlay.querySelector('#modal-confirm-btn');
  if (confirmBtn && onConfirm) {
    confirmBtn.addEventListener('click', () => {
      const result = onConfirm();
      if (result !== false) closeModal();
    });
  }

  return overlay;
}

function closeModal() {
  const modal = document.getElementById('modal-overlay');
  if (modal) modal.remove();
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-overlay');
  sidebar?.classList.toggle('open');
  overlay?.classList.toggle('show');
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-overlay');
  sidebar?.classList.remove('open');
  overlay?.classList.remove('show');
}

// ============================================================
// UTILS
// ============================================================

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Drag & drop para upload zone
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const zone = document.getElementById('upload-zone');
    if (zone) zone.classList.add('dragover');
  });

  document.addEventListener('dragleave', (e) => {
    const zone = document.getElementById('upload-zone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const zone = document.getElementById('upload-zone');
    if (zone) zone.classList.remove('dragover');

    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      const input = document.getElementById('photo-input');
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        handlePhotoUpload({ target: input });
      }
    }
  });
});
