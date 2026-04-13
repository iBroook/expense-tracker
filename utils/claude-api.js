var ClaudeAPI = {

  analyzeImage: function(imageBase64, mimeType) {
    var apiKey = CONFIG.CLAUDE_API_KEY;
    if (!apiKey) {
      return Promise.reject(new Error('Claude API key no configurada.'));
    }

    var today = new Date().toISOString().split('T')[0];

    var prompt = 'Analiza esta imagen financiera con mucho detalle.\n\n' +
      'PRIMERO identifica el tipo de transaccion:\n\n' +
      'TIPO A - CONVERSION entre divisas propias:\n' +
      '- Compra de USDT con USD\n' +
      '- Venta de USDT por COP (P2P Binance)\n' +
      '- Cualquier intercambio donde el dinero sigue siendo tuyo\n' +
      '- En Binance P2P: cuando TU eres el que compra o vende\n\n' +
      'TIPO B - PAGO a otra persona:\n' +
      '- Binance Pay enviado a otro usuario\n' +
      '- Transferencia a cuenta de otra persona\n\n' +
      'TIPO C - INGRESO simple (una divisa entra)\n\n' +
      'TIPO D - GASTO simple (una divisa sale)\n\n' +
      'Responde UNICAMENTE con JSON valido sin texto adicional.\n\n' +
      'Para TIPO A usa:\n' +
      '{"transaction_kind":"conversion","from_amount":<numero>,"from_currency":"<divisa que pierdes>","to_amount":<numero>,"to_currency":"<divisa que ganas>","date":"<YYYY-MM-DD>","description":"<texto>","platform":"<Binance P2P|Binance Convert|etc>","confidence":<0-1>,"uncertain_fields":[],"notes":""}\n\n' +
      'Para TIPO B usa:\n' +
      '{"transaction_kind":"payment","amount":<numero>,"currency":"<divisa>","date":"<YYYY-MM-DD>","concept":"<a quien>","platform":"<Binance Pay|etc>","confidence":<0-1>,"uncertain_fields":[],"notes":""}\n\n' +
      'Para TIPO C usa:\n' +
      '{"transaction_kind":"income","amount":<numero>,"currency":"<divisa>","date":"<YYYY-MM-DD>","concept":"<descripcion>","confidence":<0-1>,"uncertain_fields":[],"notes":""}\n\n' +
      'Para TIPO D usa:\n' +
      '{"transaction_kind":"expense","amount":<numero>,"currency":"<divisa>","date":"<YYYY-MM-DD>","concept":"<descripcion>","category":"<Software|Comida|Transporte|Mercancia|Luz|Seguro|Seguridad Social|Otro>","confidence":<0-1>,"uncertain_fields":[],"notes":""}\n\n' +
      'Si no puedes determinar el tipo usa: {"transaction_kind":"unknown","notes":"<razon>"}\n' +
      'Hoy es: ' + today;

    return fetch(CONFIG.CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 1024,
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
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No se pudo extraer informacion de la imagen');
      return JSON.parse(jsonMatch[0]);
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
