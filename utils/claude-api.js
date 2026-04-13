// ============================================================
// CLAUDE-API.JS - Integración con Claude Vision API
// ============================================================

const ClaudeAPI = {
  // Analizar imagen de factura/recibo
  async analyzeImage(imageBase64, mimeType = 'image/jpeg') {
    const apiKey = CONFIG.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('Claude API key no configurada. Revisa los GitHub Secrets.');
    }

    const prompt = `Analiza esta imagen de una factura, recibo, captura de pantalla de pago o comprobante de transacción financiera.

Extrae la siguiente información y responde ÚNICAMENTE con un JSON válido (sin texto adicional, sin markdown):

{
  "amount": <número>,
  "currency": "<COP|USD|USDT|VES|MXN|EUR|u otro código de 3 letras>",
  "date": "<YYYY-MM-DD>",
  "concept": "<descripción corta del gasto o ingreso>",
  "type": "<Ingreso|Gasto>",
  "category": "<Software|Comida|Transporte|Mercancía|Luz|Seguro|Seguridad Social|Otro>",
  "confidence": <0.0 a 1.0>,
  "uncertain_fields": ["lista de campos en los que no estás seguro"],
  "notes": "<observaciones adicionales si las hay>"
}

Reglas:
- Si la imagen muestra una transferencia RECIBIDA, type = "Ingreso"
- Si la imagen muestra un pago o compra, type = "Gasto"
- Si ves USDT o Tether, currency = "USDT"
- Si ves una captura de Binance con USDT, currency = "USDT"
- Si no puedes determinar con certeza algún campo, inclúyelo en uncertain_fields
- El monto debe ser el valor total de la transacción
- Si hay múltiples montos, usa el total
- Para la fecha, si no aparece, usa hoy: ${new Date().toISOString().split('T')[0]}
- Si confidence < 0.7, añade todos los campos dudosos a uncertain_fields`;

    try {
      const response = await fetch(CONFIG.CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CONFIG.CLAUDE_MODEL,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mimeType,
                    data: imageBase64
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `Error API: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content[0]?.text || '';

      // Limpiar y parsear JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No se pudo extraer información de la imagen');
      }

      const result = JSON.parse(jsonMatch[0]);

      // Validar campos requeridos
      if (!result.amount || isNaN(result.amount)) {
        result.uncertain_fields = result.uncertain_fields || [];
        if (!result.uncertain_fields.includes('amount')) {
          result.uncertain_fields.push('amount');
        }
      }

      return result;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Error de conexión. Verifica que la API key esté configurada en GitHub Secrets y que la app esté en HTTPS.');
      }
      throw error;
    }
  },

  // Convertir archivo a base64
  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Remover el prefijo "data:image/jpeg;base64,"
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // Obtener tipo MIME del archivo
  getMimeType(file) {
    return file.type || 'image/jpeg';
  },

  // Verificar si la API está configurada
  isConfigured() {
    return !!(CONFIG.CLAUDE_API_KEY);
  }
};

window.ClaudeAPI = ClaudeAPI;
