var ClaudeAPI = {

  analyzeImage: function(imageBase64, mimeType) {
    var apiKey = CONFIG.CLAUDE_API_KEY;
    if (!apiKey) {
      return Promise.reject(new Error('Claude API key no configurada.'));
    }

    var today = new Date().toISOString().split('T')[0];

    var prompt = 'Analiza esta imagen financiera y extrae TODOS los movimientos que encuentres.\n\n' +
      'Puede ser una sola transaccion o multiples (extracto bancario, lista de movimientos, etc).\n\n' +
      'Para CADA movimiento identifica el tipo:\n\n' +
      'TIPO conversion: Binance P2P, compra/venta USDT, cambio entre divisas propias\n' +
      'TIPO payment: Binance Pay a otro usuario, transferencia a tercero\n' +
      'TIPO income: Pago recibido, ingreso, abono\n' +
      'TIPO expense: Compra, pago de servicio, debito, cargo\n\n' +
      'REGLA DE COMISIONES: Para conversiones, el to_amount debe ser el monto NETO.\n' +
      'Si hay Fee o comision, restarlo: Receive 358.92 - Fee 1.25 = to_amount 357.67\n\n' +
      'Responde UNICAMENTE con un array JSON valido, sin texto adicional:\n\n' +
      '[\n' +
      '  {\n' +
      '    "transaction_kind": "expense",\n' +
      '    "amount": 49900,\n' +
      '    "currency": "COP",\n' +
      '    "date": "2026-04-15",\n' +
      '    "concept": "PPRO*MICROSOFT",\n' +
      '    "category": "Software",\n' +
      '    "confidence": 0.97,\n' +
      '    "uncertain_fields": [],\n' +
      '    "notes": ""\n' +
      '  },\n' +
      '  {\n' +
      '    "transaction_kind": "expense",\n' +
      '    "amount": 9900,\n' +
      '    "currency": "COP",\n' +
      '    "date": "2026-04-15",\n' +
      '    "concept": "APPLE.COM/BILL",\n' +
      '    "category": "Software",\n' +
      '    "confidence": 0.95,\n' +
      '    "uncertain_fields": [],\n' +
      '    "notes": ""\n' +
      '  }\n' +
      ']\n\n' +
      'Para conversiones usar:\n' +
      '{"transaction_kind":"conversion","from_amount":379.01,"from_currency":"USD","to_amount":357.67,"to_currency":"USDT","date":"2026-04-14","description":"Compra USDT Binance P2P","platform":"Binance P2P","confidence":0.97,"uncertain_fields":[],"notes":""}\n\n' +
      'IMPORTANTE:\n' +
      '- Devuelve SIEMPRE un array, aunque sea de un solo elemento\n' +
      '- Mantén el orden en que aparecen en la imagen (de arriba hacia abajo)\n' +
      '- Si no puedes determinar un campo, agrégalo a uncertain_fields\n' +
      '- Para gastos en COP de extracto bancario, los montos negativos son gastos\n' +
      '- Para ingresos/abonos, los montos positivos son ingresos\n' +
      '- Hoy es: ' + today;

    return fetch(CONFIG.CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    }).then(function(response) {
      if (!response.ok) {
        return response.json().then(function(error) {
          throw new Error(error.error ? error.error.message : 'Error API: ' + response.status);
        });
      }
      return response.json();
    }).then(function(data) {
      var text = data.content[0] ? data.content[0].text : '';
      // Buscar array JSON
      var jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        // Si no hay array, intentar objeto único y envolverlo
        var objMatch = text.match(/\{[\s\S]*\}/);
        if (!objMatch) throw new Error('No se pudo extraer informacion de la imagen');
        return [JSON.parse(objMatch[0])];
      }
      var result = JSON.parse(jsonMatch[0]);
      // Asegurar que siempre sea array
      return Array.isArray(result) ? result : [result];
    });
  },

  fileToBase64: function(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  getMimeType: function(file) { return file.type || 'image/jpeg'; },
  isConfigured: function() { return !!(CONFIG.CLAUDE_API_KEY); }
};

window.ClaudeAPI = ClaudeAPI;
