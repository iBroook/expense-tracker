var GoogleSheets = {

  accessToken: null,

  getToken: function() {
    var tokenData = Storage.getToken();
    if (!tokenData) return null;
    if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
      Storage.clearToken();
      return null;
    }
    this.accessToken = tokenData.access_token;
    return tokenData.access_token;
  },

  isAuthenticated: function() {
    return !!this.getToken();
  },

  startOAuth: function() {
    var clientId = CONFIG.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('Google Client ID no configurado. Revisa los GitHub Secrets.');
    }
    var redirectUri = window.location.origin + window.location.pathname;
    var state = Math.random().toString(36).substring(2);
    Storage.set('oauth_state', state);
    var params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: CONFIG.GOOGLE_SCOPES,
      state: state,
      include_granted_scopes: 'true',
      prompt: 'consent'
    });
    window.location.href = CONFIG.GOOGLE_OAUTH_URL + '?' + params.toString();
  },

  handleOAuthCallback: function() {
    var hash = window.location.hash.substring(1);
    if (!hash) return false;
    var params = new URLSearchParams(hash);
    var accessToken = params.get('access_token');
    var expiresIn = params.get('expires_in');
    var state = params.get('state');
    if (!accessToken) return false;
    var savedState = Storage.get('oauth_state');
    if (state !== savedState) return false;
    var tokenData = {
      access_token: accessToken,
      expires_at: Date.now() + (parseInt(expiresIn) * 1000) - 60000
    };
    Storage.setToken(tokenData);
    Storage.remove('oauth_state');
    this.accessToken = accessToken;
    window.history.replaceState(null, '', window.location.pathname);
    return true;
  },

  logout: function() {
    this.accessToken = null;
    Storage.clearToken();
  },

  getUserInfo: function() {
    var token = this.getToken();
    if (!token) return Promise.reject(new Error('No autenticado'));
    return fetch(CONFIG.GOOGLE_USERINFO_URL, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(response) {
      if (!response.ok) {
        var info = { name: 'Usuario', email: '', picture: '' };
        Storage.setUserInfo(info);
        return info;
      }
      return response.json().then(function(info) {
        Storage.setUserInfo(info);
        return info;
      });
    }).catch(function() {
      var info = { name: 'Usuario', email: '', picture: '' };
      Storage.setUserInfo(info);
      return info;
    });
  },

  listSpreadsheets: function() {
    var token = this.getToken();
    return fetch(
      'https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&fields=files(id%2Cname%2CmodifiedTime)&orderBy=modifiedTime+desc&pageSize=20',
      { headers: { 'Authorization': 'Bearer ' + token } }
    ).then(function(r) {
      if (!r.ok) throw new Error('Error listando spreadsheets');
      return r.json();
    }).then(function(data) {
      return data.files || [];
    });
  },

  createSpreadsheet: function() {
    var self = this;
    var token = this.getToken();
    return fetch(CONFIG.GOOGLE_SHEETS_API, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: CONFIG.SPREADSHEET_NAME },
        sheets: [
          { properties: { title: 'Transacciones', index: 0 } },
          { properties: { title: 'Resumen', index: 1 } }
        ]
      })
    }).then(function(r) {
      if (!r.ok) throw new Error('Error creando spreadsheet');
      return r.json();
    }).then(function(data) {
      return self.addHeaders(data.spreadsheetId).then(function() { return data; });
    });
  },

  addHeaders: function(spreadsheetId) {
    return this.updateRange(spreadsheetId, 'Transacciones!A1:M1', [CONFIG.SHEET_HEADER]);
  },

  hasHeaders: function(spreadsheetId) {
    return this.readRange(spreadsheetId, 'Transacciones!A1:M1').then(function(data) {
      var rows = data.values || [];
      return rows.length > 0 && rows[0][0] === 'Fecha';
    }).catch(function() { return false; });
  },

  readTransactions: function(spreadsheetId) {
    var self = this;
    return this.readRange(spreadsheetId, 'Transacciones!A2:M').then(function(data) {
      var rows = data.values || [];
      return rows.map(function(row) {
        return self._rowToTransaction(row);
      }).filter(function(tx) { return tx.id; });
    });
  },

  addTransaction: function(spreadsheetId, transaction) {
    var row = this._transactionToRow(transaction);
    return this.appendRow(spreadsheetId, 'Transacciones!A:M', [row]).then(function() {
      return transaction;
    });
  },

  updateTransaction: function(spreadsheetId, transaction) {
    var self = this;
    return this.readRange(spreadsheetId, 'Transacciones!A2:M').then(function(allData) {
      var rows = allData.values || [];
      var rowIndex = -1;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][11] === transaction.id) { rowIndex = i; break; }
      }
      if (rowIndex === -1) throw new Error('Transaccion no encontrada');
      var sheetRow = rowIndex + 2;
      var row = self._transactionToRow(transaction);
      return self.updateRange(spreadsheetId, 'Transacciones!A' + sheetRow + ':L' + sheetRow, [row]);
    });
  },

  deleteTransaction: function(spreadsheetId, transactionId) {
    var token = this.getToken();
    return this.readRange(spreadsheetId, 'Transacciones!A2:M').then(function(allData) {
      var rows = allData.values || [];
      var rowIndex = -1;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][11] === transactionId) { rowIndex = i; break; }
      }
      if (rowIndex === -1) throw new Error('Transaccion no encontrada');
      var sheetRow = rowIndex + 1;
      return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '?fields=sheets.properties', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) { return r.json(); }).then(function(sheetData) {
        var sheetId = sheetData.sheets[0].properties.sheetId;
        return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + ':batchUpdate', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: sheetRow, endIndex: sheetRow + 1 } } }]
          })
        });
      });
    });
  },

  readRange: function(spreadsheetId, range) {
    var token = this.getToken();
    return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '/values/' + encodeURIComponent(range), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error ? e.error.message : 'Error leyendo Sheets'); });
      return r.json();
    });
  },

  updateRange: function(spreadsheetId, range, values) {
    var token = this.getToken();
    return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: values })
    }).then(function(r) {
      if (!r.ok) throw new Error('Error actualizando Sheets');
      return r.json();
    });
  },

  appendRow: function(spreadsheetId, range, values) {
    var token = this.getToken();
    return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: values })
    }).then(function(r) {
      if (!r.ok) throw new Error('Error agregando fila');
      return r.json();
    });
  },

_transactionToRow: function(tx) {
    return [tx.date, tx.type, tx.classification || '', tx.amount, tx.currency,
      tx.category || '', tx.description || '', tx.percentage || '',
      tx.originalAmount || '', tx.originalCurrency || '', tx.exchangeRate || '', tx.id,
      tx.debtId || ''];
  },

_rowToTransaction: function(row) {
    return {
      date: row[0] || '', type: row[1] || '', classification: row[2] || '',
      amount: parseFloat(row[3]) || 0, currency: row[4] || '', category: row[5] || '',
      description: row[6] || '', percentage: row[7] || '', originalAmount: row[8] || '',
      originalCurrency: row[9] || '', exchangeRate: row[10] || '', id: row[11] || '',
      debtId: row[12] || ''
    };
  },

  ensureDebtsSheet: function(spreadsheetId) {
    var self = this;
    var token = this.getToken();
    return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '?fields=sheets.properties', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) { return r.json(); }).then(function(data) {
      var hasDebts = false;
      if (data.sheets) {
        for (var i = 0; i < data.sheets.length; i++) {
          if (data.sheets[i].properties.title === 'Deudas') { hasDebts = true; break; }
        }
      }
      if (hasDebts) return Promise.resolve();
      return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + ':batchUpdate', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Deudas' } } }] })
      }).then(function() {
        return self.updateRange(spreadsheetId, 'Deudas!A1:I1',
          [['ID', 'Nombre', 'Tipo', 'Monto Original', 'Divisa', 'Cuotas Total', 'Cuotas Pagadas', 'Fecha Inicio', 'Estado']]);
      });
    });
  },

  readDebts: function(spreadsheetId) {
    var self = this;
    return self.ensureDebtsSheet(spreadsheetId).then(function() {
      return self.readRange(spreadsheetId, 'Deudas!A2:I1000');
    }).then(function(data) {
      var rows = data.values || [];
      return rows.map(function(row) {
        return {
          id: row[0] || '',
          name: row[1] || '',
          type: row[2] || 'Credito',
          originalAmount: parseFloat(row[3]) || 0,
          currency: row[4] || 'COP',
          totalInstallments: parseInt(row[5]) || 0,
          paidInstallments: parseInt(row[6]) || 0,
          startDate: row[7] || '',
          status: row[8] || 'Activo'
        };
      }).filter(function(d) { return d.id; });
    });
  },

  addDebt: function(spreadsheetId, debt) {
    var self = this;
    return self.ensureDebtsSheet(spreadsheetId).then(function() {
      return self.appendRow(spreadsheetId, 'Deudas!A:I', [[
        debt.id, debt.name, debt.type, debt.originalAmount, debt.currency,
        debt.totalInstallments, debt.paidInstallments || 0, debt.startDate, debt.status || 'Activo'
      ]]);
    });
  },

  updateDebt: function(spreadsheetId, debt) {
    var self = this;
    return self.readDebts(spreadsheetId).then(function(debts) {
      var rowIndex = -1;
      for (var i = 0; i < debts.length; i++) {
        if (debts[i].id === debt.id) { rowIndex = i + 2; break; }
      }
      if (rowIndex === -1) throw new Error('Deuda no encontrada');
      return self.updateRange(spreadsheetId, 'Deudas!A' + rowIndex + ':I' + rowIndex, [[
        debt.id, debt.name, debt.type, debt.originalAmount, debt.currency,
        debt.totalInstallments, debt.paidInstallments, debt.startDate, debt.status
      ]]);
    });
  },

  deleteDebt: function(spreadsheetId, debtId) {
    var self = this;
    var token = this.getToken();
    return self.readDebts(spreadsheetId).then(function(debts) {
      var rowIndex = -1;
      for (var i = 0; i < debts.length; i++) {
        if (debts[i].id === debtId) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return;
      return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + '?fields=sheets.properties', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) { return r.json(); }).then(function(meta) {
        var sheetId = null;
        for (var j = 0; j < meta.sheets.length; j++) {
          if (meta.sheets[j].properties.title === 'Deudas') { sheetId = meta.sheets[j].properties.sheetId; break; }
        }
        if (sheetId === null) return;
        return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + spreadsheetId + ':batchUpdate', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }]
          })
        });
      });
    });
  }
};

window.GoogleSheets = GoogleSheets;
