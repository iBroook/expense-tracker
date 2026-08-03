// Pestaña "Rendimiento": historico de tiempos por etapa y comparacion con
// el promedio (mas lento/mas rapido) para las tareas en curso ahora mismo.
const Rendimiento = (() => {
  function promedioHistorico(cliente, entregable, etapa) {
    const muestras = State.tareaEtapas.filter(
      (r) =>
        r.Estado === "completada" &&
        (r.Cliente || "").trim().toLowerCase() === (cliente || "").trim().toLowerCase() &&
        (r.Entregable || "").trim().toLowerCase() === (entregable || "").trim().toLowerCase() &&
        (r.Etapa || "").trim().toLowerCase() === (etapa || "").trim().toLowerCase()
    );
    if (muestras.length === 0) return null;
    const total = muestras.reduce((s, r) => s + Number(r.Duracion_min || 0), 0);
    return { promedio: total / muestras.length, n: muestras.length };
  }

  function ratioClase(ratio) {
    if (ratio === null || ratio === undefined) return "neutral";
    if (ratio <= 1.0) return "ok";
    if (ratio <= 1.3) return "warn";
    return "danger";
  }

  function poblarFiltros() {
    const selCliente = document.getElementById("filtro-rend-cliente");
    const actual = selCliente.value;
    selCliente.innerHTML = '<option value="">Todos los clientes</option>';
    clientesConocidos().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      selCliente.appendChild(opt);
    });
    selCliente.value = actual;

    const selEtapa = document.getElementById("filtro-rend-etapa");
    const actualEtapa = selEtapa.value;
    const etapas = Array.from(new Set(State.tareaEtapas.map((r) => r.Etapa).filter(Boolean))).sort();
    selEtapa.innerHTML = '<option value="">Todas las etapas</option>';
    etapas.forEach((e) => {
      const opt = document.createElement("option");
      opt.value = e;
      opt.textContent = e;
      selEtapa.appendChild(opt);
    });
    selEtapa.value = actualEtapa;
  }

  function render() {
    poblarFiltros();
    const fCliente = document.getElementById("filtro-rend-cliente").value;
    const fEntregable = document.getElementById("filtro-rend-entregable").value;
    const fEtapa = document.getElementById("filtro-rend-etapa").value;

    let completadas = State.tareaEtapas.filter((r) => r.Estado === "completada");
    if (fCliente) completadas = completadas.filter((r) => r.Cliente === fCliente);
    if (fEntregable) completadas = completadas.filter((r) => (r.Entregable || "").toLowerCase() === fEntregable);
    if (fEtapa) completadas = completadas.filter((r) => r.Etapa === fEtapa);

    const grupos = new Map();
    completadas
      .slice()
      .sort((a, b) => new Date(a.Fecha_fin || 0) - new Date(b.Fecha_fin || 0))
      .forEach((r) => {
        const key = `${r.Cliente}|||${r.Entregable}|||${r.Etapa}`;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(r);
      });

    const tbody = document.querySelector("#tabla-rendimiento tbody");
    tbody.innerHTML = "";
    const filas = Array.from(grupos.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    filas.forEach(([key, muestras]) => {
      const [cliente, entregable, etapa] = key.split("|||");
      const duraciones = muestras.map((m) => Number(m.Duracion_min || 0));
      const promedioTotal = duraciones.reduce((s, d) => s + d, 0) / duraciones.length;
      const ultima = duraciones[duraciones.length - 1];
      const previas = duraciones.slice(0, -1);
      const promedioPrevias = previas.length ? previas.reduce((s, d) => s + d, 0) / previas.length : null;
      const ratio = promedioPrevias ? ultima / promedioPrevias : null;
      const clase = ratioClase(ratio);
      const tendenciaTxt =
        ratio === null ? "sin historial previo" : ratio <= 1 ? "más rápido" : ratio <= 1.3 ? "similar" : "más lento";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${cliente}</td>
        <td>${entregable}</td>
        <td>${etapa}</td>
        <td>${duraciones.length}</td>
        <td>${promedioTotal.toFixed(1)} min</td>
        <td>${ultima.toFixed(1)} min</td>
        <td><span class="etapa-dot ${clase}"></span> ${tendenciaTxt}</td>
      `;
      tbody.appendChild(tr);
    });
    if (filas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-hint">Sin etapas completadas todavia</td></tr>';
    }

    renderEnCurso();
  }

  function renderEnCurso() {
    const cont = document.getElementById("rendimiento-en-curso");
    cont.innerHTML = "";
    const enCurso = State.kanban.filter((t) => t.Etapa_actual);
    if (enCurso.length === 0) {
      cont.innerHTML = '<div class="empty-hint">No hay etapas en curso ahora mismo.</div>';
      return;
    }
    enCurso.forEach((t) => {
      const fila = filaEtapaActiva(t.ID);
      const pausada = !!(fila && fila.Estado === "pausada");
      const hist = promedioHistorico(t.Cliente, t.Entregable, t.Etapa_actual);
      const elapsedMin = elapsedEtapaMin(t);
      const ratio = hist ? elapsedMin / hist.promedio : null;
      const clase = ratioClase(ratio);
      const detalle = hist
        ? `promedio ${hist.promedio.toFixed(1)} min (n=${hist.n})`
        : "sin historial todavia";
      const row = document.createElement("div");
      row.className = "material-item";
      row.innerHTML = `
        <span class="etapa-dot ${clase}"></span>
        <span class="desc">${t.Titulo || "(sin titulo)"} — ${t.Cliente || ""}</span>
        <span class="fechas">Etapa: ${t.Etapa_actual}${pausada ? " (pausada)" : ""} · ${formatDuracion(elapsedMin * 60000)} · ${detalle}</span>
      `;
      cont.appendChild(row);
    });
  }

  function bindEvents() {
    document.getElementById("filtro-rend-cliente").addEventListener("change", render);
    document.getElementById("filtro-rend-entregable").addEventListener("change", render);
    document.getElementById("filtro-rend-etapa").addEventListener("change", render);
  }

  return { render, bindEvents, promedioHistorico, ratioClase };
})();
