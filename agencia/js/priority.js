// Calculo de prioridad para Material Disponible.
// Regla general: mas cerca la fecha de entrega, mas urgente.
// Regla especial: Romar entrega video los jueves y domingos; el dia
// anterior (miercoles / sabado) cualquier material de Romar sube a Alta.

function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const target = new Date(fechaISO + "T00:00:00");
  return Math.round((target - hoy) / 86400000);
}

function esVisperaCadenciaRomar() {
  const dow = new Date().getDay(); // 0=domingo, 3=miercoles, 6=sabado
  return dow === 3 || dow === 6; // miercoles (previo a jueves) o sabado (previo a domingo)
}

function calcPriority(item) {
  const cliente = (item.Cliente || "").trim().toLowerCase();
  const tipo = (item.Tipo || "").trim().toLowerCase();

  if (cliente === "romar" && tipo === "video" && esVisperaCadenciaRomar()) {
    return "Alta";
  }

  const dias = diasHasta(item.Fecha_entrega);
  if (dias === null) return "Baja";
  if (dias <= 1) return "Alta";
  if (dias <= 3) return "Media";
  return "Baja";
}

function prioridadOrden(p) {
  return { Alta: 0, Media: 1, Baja: 2 }[p] ?? 3;
}
