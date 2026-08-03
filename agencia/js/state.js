// Estado compartido en memoria + utilidades comunes (toasts, fechas, ids).
const State = {
  material: [],
  kanban: [],
  cxc: [],
  empleadosOutput: [],
  tarifas: [],
  tareaEtapas: [],
  pizarras: [],
  pizarraElementos: [],
};

async function refreshMaterial() {
  State.material = await Api.getSheet("material_disponible");
  return State.material;
}
async function refreshKanban() {
  State.kanban = await Api.getSheet("kanban_tareas");
  return State.kanban;
}
async function refreshCxc() {
  State.cxc = await Api.getSheet("cuentas_por_cobrar");
  return State.cxc;
}
async function refreshEmpleadosOutput() {
  State.empleadosOutput = await Api.getSheet("empleados_output");
  return State.empleadosOutput;
}
async function refreshTarifas() {
  State.tarifas = await Api.getSheet("tarifas");
  return State.tarifas;
}
async function refreshTareaEtapas() {
  State.tareaEtapas = await Api.getSheet("tareas_etapas");
  return State.tareaEtapas;
}
async function refreshPizarras() {
  State.pizarras = await Api.getSheet("pizarras");
  return State.pizarras;
}
async function refreshPizarraElementos() {
  State.pizarraElementos = await Api.getSheet("pizarra_elementos");
  return State.pizarraElementos;
}

function clientesConocidos() {
  const set = new Set();
  State.tarifas.forEach((t) => t.Cliente && set.add(t.Cliente));
  State.material.forEach((m) => m.Cliente && set.add(m.Cliente));
  State.kanban.forEach((k) => k.Cliente && set.add(k.Cliente));
  return Array.from(set).sort();
}

function buscarTarifa(cliente, entregable) {
  const row = State.tarifas.find(
    (t) =>
      (t.Cliente || "").trim().toLowerCase() === (cliente || "").trim().toLowerCase() &&
      (t.Entregable || "").trim().toLowerCase() === (entregable || "").trim().toLowerCase()
  );
  return row ? Number(row.Precio_USD) : null;
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById("agencia-toast-container").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function fmtMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// Fila de tareas_etapas que representa la etapa activa de una tarea, ya sea
// corriendo ("en_curso") o pausada ("pausada"). Usado por kanban.js y
// rendimiento.js para mostrar/calcular el tiempo de la etapa en curso.
function filaEtapaActiva(taskId) {
  return State.tareaEtapas.find(
    (r) => String(r.Tarea_ID) === String(taskId) && (r.Estado === "en_curso" || r.Estado === "pausada")
  );
}

// Minutos totales transcurridos en la etapa actual de una tarea, sumando lo
// acumulado en tramos previos (si se pauso y reanudo) con el tramo en vivo
// si esta corriendo. Si esta pausada, devuelve el acumulado congelado.
function elapsedEtapaMin(tarea) {
  const fila = filaEtapaActiva(tarea.ID);
  if (!fila) return 0;
  const acumulado = Number(fila.Acumulado_min || 0);
  if (fila.Estado === "en_curso" && tarea.Etapa_inicio) {
    return acumulado + (Date.now() - new Date(tarea.Etapa_inicio).getTime()) / 60000;
  }
  return acumulado;
}

// Hora local sin timezone (formato compatible con datetime.fromisoformat en
// Python) — NO usar toISOString() aca, que produce UTC con sufijo "Z" y
// rompe la comparacion con datetime.now() naive del lado del scheduler.
function nowDateTimeISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuracion(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
