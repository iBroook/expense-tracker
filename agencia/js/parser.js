// Extrae cliente / tipo / descripcion de un mensaje pegado (ej. WhatsApp)
// usando coincidencia de palabras clave. No usa IA, solo heuristicas simples.

const TIPO_KEYWORDS = {
  reel_extracto: ["reel extracto", "extracto de reel", "extracto"],
  reel: ["reel", "reels"],
  video: ["video", "clip", "vod"],
  carousel: ["carousel", "carrusel"],
  post: ["post", "publicacion", "publicación", "flyer", "imagen"],
};

function normalizar(txt) {
  return (txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function inferirTipo(textoNorm) {
  for (const [tipo, keywords] of Object.entries(TIPO_KEYWORDS)) {
    for (const kw of keywords) {
      const idx = textoNorm.indexOf(normalizar(kw));
      if (idx !== -1) return { tipo, idx };
    }
  }
  return { tipo: null, idx: -1 };
}

function inferirCliente(textoNorm, clientesConocidos) {
  for (const cliente of clientesConocidos) {
    if (textoNorm.includes(normalizar(cliente))) return cliente;
  }
  return null;
}

// Busca un numero pegado justo antes del tipo detectado, ej. "2 reels de manuel" -> 2.
// Solo reconoce digitos (no numeros en palabras); si no hay ninguno, asume 1.
function inferirCantidad(textoNorm, idxTipo) {
  if (idxTipo == null || idxTipo < 0) return 1;
  const antes = textoNorm.slice(Math.max(0, idxTipo - 6), idxTipo);
  const match = antes.match(/(\d+)\s*$/);
  if (!match) return 1;
  const n = parseInt(match[1], 10);
  return n > 0 ? n : 1;
}

// Detecta si el mensaje es una LISTA de varios entregables. En vez de tratar
// todo el mensaje como un unico item, cada entrada de la lista se convierte
// en su propio item (con su propia descripcion y, si trae su propia palabra
// clave de tipo, su propio tipo). Cubre dos formatos:
//
// Caso 1: viñetas o numeración clasica, una entrada por linea, ej.:
//   "Manuel:
//   1. Video de la reunion
//   2. Video del evento
//   - video testimonial"
//
// Caso 2: numeración de nombre de archivo, pegada dentro del mismo bloque de
// texto (con o sin saltos de linea reales), ej. tal cual lo pega WhatsApp:
//   "001_ Reel Informativo _ Manuel 002_Reel Informativo COl VS USA _
//   003_Reel Informativo Numeros $ _ 004_Reel Townhomes HH St Cloud_"
const LIST_ITEM_RE = /^\s*(?:[-*•]+|\d{1,4}[.):_-]+)\s*(.+)$/;
// (?!\d) evita que rangos de precio/fecha tipo "20-30" o "01-02-2026" se
// confundan con numeración de archivo: en un nombre de archivo real (001_,
// 002_...) el separador siempre es seguido de texto, nunca de otro digito.
const FILENAME_MARKER_RE = /(?:^|\s)\d{2,4}[_.):-]+(?!\d)\s*/g;

function limpiarItemLista(txt) {
  return txt.trim().replace(/\s*_+$/, "");
}

function extraerItemsLista(texto) {
  // Caso 1: una entrada por linea.
  const porLinea = texto
    .split(/\r?\n/)
    .map((linea) => {
      const m = linea.match(LIST_ITEM_RE);
      return m ? limpiarItemLista(m[1]) : null;
    })
    .filter((linea) => !!linea);
  if (porLinea.length >= 2) return porLinea;

  // Caso 2: numeración de archivo pegada en un solo bloque (sin saltos de
  // linea reales entre entradas, o mezclados con espacios).
  const marcadores = [...texto.matchAll(FILENAME_MARKER_RE)];
  if (marcadores.length < 2) return [];
  const items = marcadores.map((m, i) => {
    const inicio = m.index + m[0].length;
    const fin = i + 1 < marcadores.length ? marcadores[i + 1].index : texto.length;
    return limpiarItemLista(texto.slice(inicio, fin));
  });
  return items.filter((it) => !!it).length >= 2 ? items.filter((it) => !!it) : [];
}

function parseMensaje(texto, clientesConocidos) {
  const textoNorm = normalizar(texto);
  const cliente = inferirCliente(textoNorm, clientesConocidos);
  const { tipo, idx } = inferirTipo(textoNorm);
  const descripcion = texto.trim().slice(0, 300);

  const lineasLista = extraerItemsLista(texto);
  if (lineasLista.length >= 2) {
    const items = lineasLista.map((linea) => ({
      tipo: inferirTipo(normalizar(linea)).tipo || tipo,
      descripcion: linea.slice(0, 300),
    }));
    return { cliente, tipo, cantidad: items.length, descripcion, items };
  }

  const cantidad = inferirCantidad(textoNorm, idx);
  return { cliente, tipo, cantidad, descripcion };
}
