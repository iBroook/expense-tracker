// Proxy a la API de Anthropic, como Cloudflare Pages Function.
//
// Sustituye al Worker independiente `fintrack-proxy`. Ventajas de tenerlo aqui
// en vez de en un Worker aparte:
//
//   - Mismo origen que la app: no hay CORS que mantener ni preflight que
//     responder. El Worker tenia el origen clavado a github.io y habria que
//     tocarlo en cada cambio de dominio.
//   - Cloudflare Access protege el dominio entero, esta ruta incluida. El
//     navegador manda la cookie de Access sola por ser mismo-origen, asi que
//     deja de ser un proxy abierto sin escribir una linea de autenticacion.
//   - Se despliega con el sitio: una pieza menos que versionar por separado.
//
// La API key vive como variable de entorno del proyecto de Pages (Settings ->
// Environment variables, marcada como Secret). Nunca llega al navegador.

// Se acepta solo lo que la app necesita. Sin esto, quien alcance la ruta puede
// pedir cualquier modelo con cualquier presupuesto de tokens y lo paga el
// dueño de la key.
var MODELOS_PERMITIDOS = [
  'claude-opus-4-6',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5'
];

var MAX_TOKENS_TOPE = 4096;
var CUERPO_MAXIMO_BYTES = 12 * 1024 * 1024; // una imagen en base64 abulta ~33% mas

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;

  if (!env.CLAUDE_API_KEY) {
    return json({ error: { message: 'CLAUDE_API_KEY no configurada en el proyecto de Pages' } }, 500);
  }

  var crudo = await request.text();
  if (crudo.length > CUERPO_MAXIMO_BYTES) {
    return json({ error: { message: 'La imagen es demasiado grande' } }, 413);
  }

  var peticion;
  try {
    peticion = JSON.parse(crudo);
  } catch (e) {
    return json({ error: { message: 'Cuerpo JSON invalido' } }, 400);
  }

  if (MODELOS_PERMITIDOS.indexOf(peticion.model) === -1) {
    return json({ error: { message: 'Modelo no permitido: ' + peticion.model } }, 400);
  }

  // Se recorta en vez de rechazar: un tope excedido es casi siempre un error de
  // configuracion del cliente, no un abuso, y fallar aqui romperia el analisis
  // de recibos por algo que tiene arreglo evidente.
  if (!peticion.max_tokens || peticion.max_tokens > MAX_TOKENS_TOPE) {
    peticion.max_tokens = MAX_TOKENS_TOPE;
  }

  var respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(peticion)
  });

  // Se devuelve el cuerpo tal cual para que el cliente pueda leer los mensajes
  // de error de Anthropic, pero sin reenviar cabeceras de la respuesta
  // original: podrian filtrar detalles de la cuenta.
  var datos = await respuesta.text();
  return new Response(datos, {
    status: respuesta.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// Cualquier otro metodo sobre esta ruta.
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: { message: 'Metodo no permitido' } }, 405);
}
