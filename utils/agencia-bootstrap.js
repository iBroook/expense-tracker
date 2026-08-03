// Creacion de hojas y encabezados faltantes en el spreadsheet de Agencia.
// Porta ensure_spreadsheet_structure() de server/sheets_client.py, que corria
// al arrancar el servidor Python; ese servidor ya no existe, asi que la app
// tiene que asegurar la estructura por su cuenta antes de leer/escribir datos.
// Depende de AgenciaSheets (schema, helpers, cache de sheetIds) y de
// GoogleSheets para el token OAuth.

var AgenciaBootstrap = {

  // Promesa en curso: asegurarEstructura() puede dispararse desde varios
  // puntos del arranque; sin esto dos llamadas simultaneas podrian mandar dos
  // addSheet con el mismo titulo y duplicar hojas.
  _promesa: null,

  // ---- API publica ----

  // Idempotente. Crea las hojas que falten, escribe encabezados en las hojas
  // vacias y completa columnas nuevas al final. Resuelve con el resumen.
  asegurarEstructura: function() {
    var self = this;
    if (self._promesa) return self._promesa;
    self._promesa = Promise.resolve().then(function() {
      return self._ejecutar();
    }).then(function(resumen) {
      self._promesa = null;
      return resumen;
    }, function(err) {
      // No se cachea el fallo: un reintento posterior debe poder ejecutarse.
      self._promesa = null;
      throw err;
    });
    return self._promesa;
  },

  // Solo lectura: informa que haria asegurarEstructura() sin tocar nada.
  revisar: function() {
    var self = this;
    return Promise.resolve().then(function() {
      self._verificarEntorno();
      return self._leerTitulos();
    }).then(function(titulos) {
      var faltantes = self._hojasFaltantes(titulos);
      var existentes = self._nombresSchema().filter(function(n) {
        return faltantes.indexOf(n) === -1;
      });
      return self._leerEncabezados(existentes).then(function(encabezados) {
        var plan = self._planificar(existentes, encabezados);
        return {
          hojasCreadas: [],
          hojasFaltantes: faltantes,
          encabezadosEscritos: plan.encabezadosEscritos,
          columnasAgregadas: plan.columnasAgregadas,
          encabezadosDivergentes: plan.encabezadosDivergentes,
          sinCambios: !faltantes.length && !plan.escrituras.length,
          soloLectura: true
        };
      });
    });
  },

  // Resumen legible para mostrar en la UI o en consola.
  resumenTexto: function(resumen) {
    if (!resumen) return 'Sin resumen';
    var divergentes = resumen.encabezadosDivergentes || [];
    if (resumen.sinCambios && !divergentes.length) {
      return 'Estructura del spreadsheet de Agencia ya correcta';
    }
    var partes = [];
    if (resumen.hojasCreadas && resumen.hojasCreadas.length) {
      partes.push('hojas creadas: ' + resumen.hojasCreadas.join(', '));
    }
    if (resumen.encabezadosEscritos && resumen.encabezadosEscritos.length) {
      partes.push('encabezados escritos: ' + resumen.encabezadosEscritos.join(', '));
    }
    if (resumen.columnasAgregadas && resumen.columnasAgregadas.length) {
      partes.push('columnas agregadas: ' + resumen.columnasAgregadas.map(function(c) {
        return c.hoja + ' (' + c.columnas.join(', ') + ')';
      }).join('; '));
    }
    if (divergentes.length) {
      partes.push('encabezados sin tocar por diferir del schema: ' +
        divergentes.map(function(d) { return d.hoja; }).join(', '));
    }
    return partes.length ? partes.join(' | ') : 'Sin cambios';
  },

  // ---- internos ----

  _ejecutar: function() {
    var self = this;
    var resumen = {
      hojasCreadas: [],
      encabezadosEscritos: [],
      columnasAgregadas: [],
      encabezadosDivergentes: [],
      sinCambios: true
    };
    return Promise.resolve().then(function() {
      self._verificarEntorno();
      return self._leerTitulos();
    }).then(function(titulos) {
      var faltantes = self._hojasFaltantes(titulos);
      if (!faltantes.length) return null;
      // Un unico batchUpdate con todos los addSheet en vez de una llamada por
      // hoja, igual que hacia el Python.
      var requests = faltantes.map(function(nombre) {
        return { addSheet: { properties: { title: nombre } } };
      });
      return AgenciaSheets._batchUpdate(requests).then(function() {
        resumen.hojasCreadas = faltantes;
        // Las hojas nuevas traen sheetIds que la cache de AgenciaSheets no
        // conoce; si no se invalida, deleteRow sobre una hoja recien creada
        // fallaria con "Hoja X no encontrada".
        AgenciaSheets._sheetIds = null;
        return null;
      });
    }).then(function() {
      // Tras crear las faltantes, todas las hojas del schema existen.
      var nombres = self._nombresSchema();
      return self._leerEncabezados(nombres).then(function(encabezados) {
        var plan = self._planificar(nombres, encabezados);
        resumen.encabezadosEscritos = plan.encabezadosEscritos;
        resumen.columnasAgregadas = plan.columnasAgregadas;
        resumen.encabezadosDivergentes = plan.encabezadosDivergentes;
        if (!plan.escrituras.length) return null;
        return self._valuesBatchUpdate(plan.escrituras);
      });
    }).then(function() {
      resumen.sinCambios = !resumen.hojasCreadas.length &&
        !resumen.encabezadosEscritos.length &&
        !resumen.columnasAgregadas.length;
      return resumen;
    });
  },

  _verificarEntorno: function() {
    if (typeof AgenciaSheets === 'undefined' || !AgenciaSheets.SHEETS) {
      throw new Error('AgenciaSheets no esta cargado');
    }
    if (!GoogleSheets.getToken()) throw new Error('No autenticado');
    // Lanza en espaniol si falta CONFIG.AGENCIA_SPREADSHEET_ID.
    AgenciaSheets._spreadsheetId();
  },

  _nombresSchema: function() {
    return Object.keys(AgenciaSheets.SHEETS);
  },

  _hojasFaltantes: function(titulos) {
    return this._nombresSchema().filter(function(nombre) {
      return titulos.indexOf(nombre) === -1;
    });
  },

  // Reutiliza el lector de metadatos de AgenciaSheets (una sola llamada) y de
  // paso deja su cache nombre->sheetId caliente.
  _leerTitulos: function() {
    return AgenciaSheets._loadSheetIds().then(function(map) {
      return Object.keys(map);
    });
  },

  // Decide que escribir comparando encabezado real contra el schema. No hace
  // ninguna llamada: devuelve las escrituras para mandarlas agrupadas.
  _planificar: function(nombres, encabezados) {
    var plan = {
      escrituras: [],
      encabezadosEscritos: [],
      columnasAgregadas: [],
      encabezadosDivergentes: []
    };
    for (var i = 0; i < nombres.length; i++) {
      var nombre = nombres[i];
      var cols = AgenciaSheets.SHEETS[nombre];
      var actual = encabezados[nombre] || [];

      if (!actual.length) {
        plan.escrituras.push({
          range: AgenciaSheets._range(nombre, 'A1'),
          values: [cols]
        });
        plan.encabezadosEscritos.push(nombre);
        continue;
      }

      if (this._esPrefijo(actual, cols) && actual.length < cols.length) {
        // Unico caso de migracion soportado: el encabezado actual coincide
        // celda por celda con el principio del schema, o sea que solo se
        // agregaron columnas al final. Se escriben nada mas las que faltan, en
        // su rango exacto, sin reescribir las existentes.
        //
        // Cualquier otra diferencia (orden distinto, columna renombrada,
        // encabezado mas ancho que el schema) NO se toca a proposito: los
        // datos ya escritos estan posicionados segun ese encabezado y
        // reordenarlo o recortarlo los desalinearia de forma irreversible.
        var faltantes = cols.slice(actual.length);
        var desde = AgenciaSheets._colLetter(actual.length + 1);
        var hasta = AgenciaSheets._colLetter(cols.length);
        plan.escrituras.push({
          range: AgenciaSheets._range(nombre, desde + '1:' + hasta + '1'),
          values: [faltantes]
        });
        plan.columnasAgregadas.push({ hoja: nombre, columnas: faltantes });
        continue;
      }

      if (!this._mismoEncabezado(actual, cols)) {
        // Se reporta para que quede registro, pero no se escribe.
        plan.encabezadosDivergentes.push({
          hoja: nombre,
          actual: actual.slice(),
          esperado: cols.slice()
        });
      }
    }
    return plan;
  },

  _esPrefijo: function(actual, cols) {
    if (actual.length > cols.length) return false;
    for (var i = 0; i < actual.length; i++) {
      // Comparacion exacta, sin trim ni normalizacion: un encabezado que
      // "casi" coincide es justo el caso en el que no queremos escribir.
      if (String(actual[i]) !== String(cols[i])) return false;
    }
    return true;
  },

  _mismoEncabezado: function(actual, cols) {
    return actual.length === cols.length && this._esPrefijo(actual, cols);
  },

  // Lee la fila 1 de todas las hojas en una sola llamada. A1:Z1 basta: la hoja
  // mas ancha del schema tiene 15 columnas.
  _leerEncabezados: function(nombres) {
    var self = this;
    if (!nombres.length) return Promise.resolve({});
    var ranges = nombres.map(function(nombre) {
      return AgenciaSheets._range(nombre, 'A1:Z1');
    });
    return self._valuesBatchGet(ranges).then(function(data) {
      var valueRanges = data.valueRanges || [];
      if (valueRanges.length !== nombres.length) {
        // Sin correspondencia 1:1 no se puede saber que encabezado es de que
        // hoja; se aborta antes de escribir nada.
        throw new Error('Respuesta inesperada al leer los encabezados de Agencia');
      }
      var out = {};
      for (var i = 0; i < nombres.length; i++) {
        var filas = valueRanges[i].values || [];
        out[nombres[i]] = filas.length ? filas[0] : [];
      }
      return out;
    });
  },

  _valuesBatchGet: function(ranges) {
    var token = GoogleSheets.getToken();
    if (!token) return Promise.reject(new Error('No autenticado'));
    var qs = ranges.map(function(r) {
      return 'ranges=' + encodeURIComponent(r);
    }).join('&');
    var url = CONFIG.GOOGLE_SHEETS_API + '/' + AgenciaSheets._spreadsheetId() +
      '/values:batchGet?' + qs + '&majorDimension=ROWS';
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(e) {
          throw new Error(e.error ? e.error.message : 'Error leyendo los encabezados de Agencia');
        });
      }
      return r.json();
    });
  },

  // Todas las escrituras de encabezado en una sola llamada. RAW igual que el
  // Python: un nombre de columna nunca debe interpretarse como formula.
  _valuesBatchUpdate: function(data) {
    var token = GoogleSheets.getToken();
    if (!token) return Promise.reject(new Error('No autenticado'));
    var url = CONFIG.GOOGLE_SHEETS_API + '/' + AgenciaSheets._spreadsheetId() +
      '/values:batchUpdate';
    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data: data })
    }).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(e) {
          throw new Error(e.error ? e.error.message : 'Error escribiendo los encabezados de Agencia');
        });
      }
      return r.json();
    });
  }
};

window.AgenciaBootstrap = AgenciaBootstrap;
