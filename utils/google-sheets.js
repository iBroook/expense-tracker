// ============================================================
// GOOGLE-SHEETS.JS - Integración con Google Sheets API v4
// ============================================================

const GoogleSheets = {
  // ---- AUTH ----
  accessToken: null,

  getToken() {
    const tokenData = Storage.getToken();
    if (!tokenData) return null;

    // Verificar expiración
    if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
      Storage.clearToken();
      return null;
    }

    this.accessToken = tokenData.access_token;
    return tokenData.access_token;
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  // Iniciar flujo OAuth con Google
  startOAuth() {
    const clientId = CONFIG.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('Google Client ID no configurado. Revisa los GitHub Secrets.');
    }

    const redirectUri = window.location.origin + window.location.pathname;
    const state = Math.random().toString(36).substring(2);
    Storage.set('oauth_state', state);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: CONFIG.GOOGLE_SCOPES,
      state: state,
      include_granted_scopes: 'true',
      prompt: 'consent'
    });

    window.location.href = `${CONFIG.GOOGLE_OAUTH_URL}?${params.toString()}`;
  },

  // Procesar respuesta OAuth (hash fragment)
  handleOAuthCallback() {
    const hash = window.location.hash.substring(1);
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');
    const state = params.get('state');

    if (!accessToken) return false;

    // Verificar state
    const savedState = Storage.get('oauth_state');
    if (state !== savedState) {
      console.error('OAuth state mismatch');
      return false;
    }

    // Guardar token
    const tokenData = {
      access_token: accessToken,
      expires_at: Date.now() + (parseInt(expiresIn) * 1000) - 60000
    };

    Storage.setToken(tokenData);
    Storage.remove('oauth_state');
    this.accessToken = accessToken;

    // Limpiar hash de la URL
    window.history.replaceState(null, '', window.location.pathname);

    return true;
  },

  // Logout
  logout() {
    this.accessToken = null;
    Storage.clearToken();
  },

  // Obtener info del usuario
async getUserInfo() {
    const token = this.getToken();
    if (!token) throw new Error('No autenticado');

    try {
      const response = await fetch(CONFIG.GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        // Si falla userinfo, crear usuario básico con el token
        const info = { name: 'Usuario', email: '', picture: '' };
        Storage.setUserInfo(info);
        return info;
      }

      const info = await response.json();
      Storage.setUserInfo(info);
      return info;
    } catch (e) {
      const info = { name: 'Usuario', email: '', picture: '' };
      Storage.setUserInfo(info);
      return info;
    }
  },
    const info = await response.json();
    Storage.setUserInfo(info);
    return info;
  },

  // ---- SPREADSHEET ----

  // Listar spreadsheets del usuario
  async listSpreadsheets() {
    const token = this.getToken();
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&fields=files(id%2Cname%2CmodifiedTime)&orderBy=modifiedTime+desc&pageSize=20',
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) throw new Error('Error listando spreadsheets');
    const data = await response.json();
    return data.files || [];
  },

  // Crear nueva spreadsheet
  async createSpreadsheet() {
    const token = this.getToken();

    const response = await fetch(CONFIG.GOOGLE_SHEETS_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title: CONFIG.SPREADSHEET_NAME },
        sheets: [
          { properties: { title: 'Transacciones', index: 0 } },
          { properties: { title: 'Resumen', index: 1 } }
        ]
      })
    });

    if (!response.ok) throw new Error('Error creando spreadsheet');
    const data = await response.json();

    // Agregar encabezados
    await this.addHeaders(data.spreadsheetId);

    return data;
  },

  // Agregar encabezados a la hoja
  async addHeaders(spreadsheetId) {
    await this.updateRange(
      spreadsheetId,
      'Transacciones!A1:L1',
      [CONFIG.SHEET_HEADER]
    );

    // Formatear encabezado (negrita)
    await this.formatHeaders(spreadsheetId);
  },

  // Formatear encabezados
  async formatHeaders(spreadsheetId) {
    const token = this.getToken();
    await fetch(`${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.11, green: 0.11, blue: 0.18 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }]
      })
    });
  },

  // Verificar si la hoja tiene encabezados
  async hasHeaders(spreadsheetId) {
    try {
      const data = await this.readRange(spreadsheetId, 'Transacciones!A1:L1');
      const rows = data.values || [];
      return rows.length > 0 && rows[0][0] === 'Fecha';
    } catch {
      return false;
    }
  },

  // ---- OPERACIONES CRUD ----

  // Leer todas las transacciones
  async readTransactions(spreadsheetId) {
    const data = await this.readRange(spreadsheetId, 'Transacciones!A2:L');
    const rows = data.values || [];

    return rows.map(row => this._rowToTransaction(row)).filter(tx => tx.id);
  },

  // Agregar transacción
  async addTransaction(spreadsheetId, transaction) {
    const row = this._transactionToRow(transaction);
    await this.appendRow(spreadsheetId, 'Transacciones!A:L', [row]);
    return transaction;
  },

  // Actualizar transacción por ID
  async updateTransaction(spreadsheetId, transaction) {
    const allData = await this.readRange(spreadsheetId, 'Transacciones!A2:L');
    const rows = allData.values || [];

    const rowIndex = rows.findIndex(row => row[11] === transaction.id);
    if (rowIndex === -1) throw new Error('Transacción no encontrada');

    const sheetRow = rowIndex + 2; // +2 porque empieza en A2
    const row = this._transactionToRow(transaction);

    await this.updateRange(
      spreadsheetId,
      `Transacciones!A${sheetRow}:L${sheetRow}`,
      [row]
    );
  },

  // Eliminar transacción por ID
  async deleteTransaction(spreadsheetId, transactionId) {
    const allData = await this.readRange(spreadsheetId, 'Transacciones!A2:L');
    const rows = allData.values || [];

    const rowIndex = rows.findIndex(row => row[11] === transactionId);
    if (rowIndex === -1) throw new Error('Transacción no encontrada');

    const sheetRow = rowIndex + 1; // índice base 0 (sin header)

    // Eliminar fila via batchUpdate
    const token = this.getToken();
    const sheetIdRes = await fetch(`${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sheetData = await sheetIdRes.json();
    const sheetId = sheetData.sheets[0].properties.sheetId;

    await fetch(`${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: sheetRow,
              endIndex: sheetRow + 1
            }
          }
        }]
      })
    });
  },

  // ---- HELPERS API ----

  async readRange(spreadsheetId, range) {
    const token = this.getToken();
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodedRange}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Error leyendo Sheets');
    }
    return response.json();
  },

  async updateRange(spreadsheetId, range, values) {
    const token = this.getToken();
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );
    if (!response.ok) throw new Error('Error actualizando Sheets');
    return response.json();
  },

  async appendRow(spreadsheetId, range, values) {
    const token = this.getToken();
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `${CONFIG.GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values })
      }
    );
    if (!response.ok) throw new Error('Error agregando fila');
    return response.json();
  },

  // ---- CONVERSIONES ----

  _transactionToRow(tx) {
    return [
      tx.date,
      tx.type,
      tx.classification || '',
      tx.amount,
      tx.currency,
      tx.category || '',
      tx.description || '',
      tx.percentage || '',
      tx.originalAmount || '',
      tx.originalCurrency || '',
      tx.exchangeRate || '',
      tx.id
    ];
  },

  _rowToTransaction(row) {
    return {
      date: row[0] || '',
      type: row[1] || '',
      classification: row[2] || '',
      amount: parseFloat(row[3]) || 0,
      currency: row[4] || '',
      category: row[5] || '',
      description: row[6] || '',
      percentage: row[7] || '',
      originalAmount: row[8] || '',
      originalCurrency: row[9] || '',
      exchangeRate: row[10] || '',
      id: row[11] || ''
    };
  }
};

window.GoogleSheets = GoogleSheets;
