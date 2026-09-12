// Capa de acceso a datos de la app Agencia contra Google Sheets.
// Sustituye al servidor Python local (server/sheets_client.py + api_handler.py):
// misma semantica de CRUD generico por nombre de hoja, con la fila 1 como
// encabezado. Reutiliza la autenticacion OAuth de GoogleSheets (utils/google-sheets.js).
// El spreadsheet de Agencia es distinto al de finanzas: CONFIG.AGENCIA_SPREADSHEET_ID.

// Definicion de hojas: nombre -> columnas en orden (portado de server/schemas.py).
var AGENCIA_SHEETS = {
  material_disponible: [
    'ID', 'Cliente', 'Tipo', 'Descripcion', 'Fecha_subida',
    'Fecha_entrega', 'Prioridad', 'Estado', 'Notas', 'Foto'
  ],
  kanban_tareas: [
    'ID', 'Titulo', 'Tipo', 'Cliente', 'Entregable', 'Monto_USD',
    'Estado', 'Fecha_creacion', 'Fecha_completado', 'Asignado_a',
    'Fecha_limite', 'Notas',
    'Etapas_plan', 'Etapa_actual', 'Etapa_inicio'
  ],
  cuentas_por_cobrar: [
    'ID', 'Cliente', 'Entregable', 'Monto_USD', 'Fecha', 'Tarea_ID',
    'Estado_pago'
  ],
  empleados_output: [
    'Semana', 'Empleado', 'Tipo_tarea', 'Cliente', 'Cantidad',
    'Descripcion', 'Fecha'
  ],
  tarifas: [
    'Cliente', 'Entregable', 'Precio_USD'
  ],
  tareas_etapas: [
    'ID', 'Tarea_ID', 'Cliente', 'Entregable', 'Etapa', 'Orden',
    'Estado', 'Fecha_inicio', 'Fecha_fin', 'Duracion_min',
    // Acumulado_min guarda los minutos ya transcurridos de tramos previos
    // cuando la etapa se pausa y se reanuda.
    'Acumulado_min'
  ],
  pizarras: [
    'ID', 'Nombre', 'Fecha_creacion'
  ],
  pizarra_elementos: [
    'ID', 'Pizarra_ID', 'Tipo', 'X', 'Y', 'Ancho', 'Alto',
    'Contenido', 'Nombre_archivo', 'Color', 'Grosor', 'Z_index',
    'Fecha_creacion',
    // Origen_ID/Destino_ID solo se usan en Tipo="conexion".
    'Origen_ID', 'Destino_ID',
    // Forma solo se usa en Tipo="forma": rect | redondeado | elipse |
    // rombo | triangulo. Las filas viejas no la traen y caen en "rect".
    // Va al final a proposito: el bootstrap solo sabe AGREGAR columnas.
    'Forma'
  ]
};

var ENTREGABLES_VALIDOS = ['reel', 'video', 'carousel', 'post', 'reel_extracto'];

var AgenciaSheets = {

  SHEETS: AGENCIA_SHEETS,
  ENTREGABLES_VALIDOS: ENTREGABLES_VALIDOS,

  // Cache nombre de hoja -> sheetId numerico. Solo hace falta para borrar
  // filas (deleteDimension), y el spreadsheet tiene 8 hojas: pedir los
  // metadatos en cada borrado seria una llamada extra evitable.
  _sheetIds: null,

  // ---- API publica ----

  getSheet: function(sheetName) {
    var self = this;
    return Promise.resolve().then(function() {
      return self._readRaw(sheetName);
    }).then(function(rows) {
      return rows.map(function(row) { return self._clean(row); });
    });
  },

  createRow: function(sheetName, data) {
    var self = this;
    return Promise.resolve().then(function() {
      var cols = self._cols(sheetName);
      var row = self._copy(data || {});
      // El servidor asignaba el ID cuando la hoja tiene columna ID y el
      // cliente la manda vacia; hojas como tarifas no la tienen.
      var needsId = cols.indexOf('ID') !== -1 && !row.ID;
      var idPromise = needsId ? self._nextId(sheetName) : Promise.resolve(null);
      return idPromise.then(function(newId) {
        if (newId !== null) row.ID = newId;
        var values = self._toRow(cols, row);
        return GoogleSheets.appendRow(
          self._spreadsheetId(), self._range(sheetName), [values]
        ).then(function() {
          return row;
        });
      });
    });
  },

  updateRow: function(sheetName, id, updates) {
    var self = this;
    return Promise.resolve().then(function() {
      var cols = self._cols(sheetName);
      return self._findById(sheetName, id).then(function(target) {
        var merged = self._copy(target);
        var patch = updates || {};
        for (var k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
        }
        var rowNum = target._row;
        var a1 = 'A' + rowNum + ':' + self._colLetter(cols.length) + rowNum;
        return GoogleSheets.updateRange(
          self._spreadsheetId(), self._range(sheetName, a1), [self._toRow(cols, merged)]
        ).then(function() {
          return self._clean(merged);
        });
      });
    });
  },

  deleteRow: function(sheetName, id) {
    var self = this;
    return Promise.resolve().then(function() {
      self._cols(sheetName);
      return Promise.all([self._findById(sheetName, id), self._getSheetId(sheetName)]);
    }).then(function(res) {
      var rowNum = res[0]._row;
      return self._batchUpdate([{
        deleteDimension: {
          range: {
            sheetId: res[1],
            dimension: 'ROWS',
            startIndex: rowNum - 1,
            endIndex: rowNum
          }
        }
      }]);
    }).then(function() {
      return null;
    });
  },

  // ---- internos ----

  _spreadsheetId: function() {
    var id = CONFIG.AGENCIA_SPREADSHEET_ID;
    if (!id) throw new Error('CONFIG.AGENCIA_SPREADSHEET_ID no configurado');
    return id;
  },

  _cols: function(sheetName) {
    var cols = AGENCIA_SHEETS[sheetName];
    if (!cols) throw new Error('Hoja desconocida: ' + sheetName);
    return cols;
  },

  // Indice de columna 1-based -> letra A1 (A..Z, AA, AB...). El Python usaba
  // chr(64 + n), que produce basura a partir de la columna 27.
  _colLetter: function(index) {
    var letters = '';
    var n = index;
    while (n > 0) {
      var rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  },

  // Comillas simples alrededor del nombre por si lleva espacios; las comillas
  // internas se escriben duplicadas segun la notacion A1.
  _range: function(sheetName, a1) {
    return "'" + String(sheetName).replace(/'/g, "''") + "'!" + (a1 || 'A:Z');
  },

  _copy: function(obj) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    }
    return out;
  },

  // _row es interno: nunca se expone al llamador.
  _clean: function(row) {
    var out = {};
    for (var k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k) && k !== '_row') out[k] = row[k];
    }
    return out;
  },

  _toRow: function(cols, data) {
    return cols.map(function(c) {
      var v = data[c];
      return (v === undefined || v === null) ? '' : v;
    });
  },

  // Lee la hoja completa conservando el numero de fila real, para poder
  // actualizarla o borrarla despues.
  _readRaw: function(sheetName) {
    var self = this;
    self._cols(sheetName);
    return GoogleSheets.readRange(
      self._spreadsheetId(), self._range(sheetName)
    ).then(function(data) {
      var values = data.values || [];
      if (!values.length) return [];
      var header = values[0];
      var rows = [];
      for (var i = 1; i < values.length; i++) {
        var raw = values[i] || [];
        var row = {};
        // Las celdas vacias al final de una fila no llegan en la respuesta:
        // se rellenan con "" hasta cubrir el encabezado.
        for (var c = 0; c < header.length; c++) {
          row[header[c]] = raw[c] === undefined ? '' : raw[c];
        }
        row._row = i + 1;
        rows.push(row);
      }
      return rows;
    });
  },

  _findById: function(sheetName, idValue) {
    return this._readRaw(sheetName).then(function(rows) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].ID) === String(idValue)) return rows[i];
      }
      throw new Error('ID ' + idValue + ' no encontrado en ' + sheetName);
    });
  },

  _nextId: function(sheetName) {
    var self = this;
    return self._readRaw(sheetName).then(function(rows) {
      var max = 0;
      for (var i = 0; i < rows.length; i++) {
        var n = self._toInt(rows[i].ID);
        if (n !== null && n > max) max = n;
      }
      return max + 1;
    });
  },

  // Equivale al int(...) del Python con su except: los valores que no son
  // enteros (texto, "12.5") se ignoran en vez de romper el calculo del ID.
  _toInt: function(value) {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'number') {
      return isFinite(value) ? Math.trunc(value) : null;
    }
    var s = String(value).trim();
    if (!/^[+-]?\d+$/.test(s)) return null;
    return parseInt(s, 10);
  },

  _getSheetId: function(sheetName) {
    var self = this;
    if (self._sheetIds && self._sheetIds[sheetName] !== undefined) {
      return Promise.resolve(self._sheetIds[sheetName]);
    }
    return self._loadSheetIds().then(function(map) {
      if (map[sheetName] === undefined) {
        throw new Error('Hoja ' + sheetName + ' no encontrada');
      }
      return map[sheetName];
    });
  },

  _loadSheetIds: function() {
    var self = this;
    var token = GoogleSheets.getToken();
    if (!token) return Promise.reject(new Error('No autenticado'));
    var url = CONFIG.GOOGLE_SHEETS_API + '/' + self._spreadsheetId() + '?fields=sheets.properties';
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(e) {
          throw new Error(e.error ? e.error.message : 'Error leyendo el spreadsheet de Agencia');
        });
      }
      return r.json();
    }).then(function(meta) {
      var map = {};
      var sheets = meta.sheets || [];
      for (var i = 0; i < sheets.length; i++) {
        var props = sheets[i].properties;
        if (props) map[props.title] = props.sheetId;
      }
      self._sheetIds = map;
      return map;
    });
  },

  _batchUpdate: function(requests) {
    var token = GoogleSheets.getToken();
    if (!token) return Promise.reject(new Error('No autenticado'));
    return fetch(CONFIG.GOOGLE_SHEETS_API + '/' + this._spreadsheetId() + ':batchUpdate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: requests })
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(e) {
          throw new Error(e.error ? e.error.message : 'Error modificando el spreadsheet de Agencia');
        });
      }
      return r.json();
    });
  }
};

window.AGENCIA_SHEETS = AGENCIA_SHEETS;
window.ENTREGABLES_VALIDOS = ENTREGABLES_VALIDOS;
window.AgenciaSheets = AgenciaSheets;
