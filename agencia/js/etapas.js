// Etapas de produccion sugeridas por tipo de entregable (editables por el
// usuario antes de empezar a trackear). La mayoria de los entregables no
// llevan grabacion propia (se edita material ya existente); en reels el
// orden invierte subtitulos antes que B-roll respecto a un video largo.
const ETAPAS_DEFAULT = {
  reel: ["Corte", "Subtitulos", "B-roll", "Musica"],
  video: ["Corte", "B-roll", "Musica", "Motion graphics"],
  carousel: ["Diseño", "Revision", "Entrega"],
  post: ["Diseño", "Revision", "Entrega"],
  reel_extracto: ["Seleccion de clip", "Subtitulos", "Musica"],
};

function etapasPorDefecto(entregable) {
  return (ETAPAS_DEFAULT[entregable] || ["En progreso", "Revision", "Entrega"]).slice();
}

// Tiempo estimado (minutos) por nombre de etapa, independiente del promedio
// historico -- sirve para avisar aunque todavia no haya historial (ej. la
// primera vez que se usa esa etapa). Solo cubre las etapas del pipeline de
// edicion; etapas sin tiempo definido aqui (Revision, Entrega, Diseño,
// Seleccion de clip) siguen dependiendo unicamente del promedio historico.
const TIEMPO_ESTIMADO_MIN = {
  corte: 30,
  "b-roll": 40,
  subtitulos: 20,
  musica: 15,
  "motion graphics": 45,
};

function tiempoEstimadoEtapa(nombreEtapa) {
  const key = (nombreEtapa || "").trim().toLowerCase();
  return TIEMPO_ESTIMADO_MIN[key] ?? null;
}
