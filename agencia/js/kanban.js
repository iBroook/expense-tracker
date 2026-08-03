// Pestaña 2: Kanban Diario
const Kanban = (() => {
  const ESTADOS = ["Por hacer", "En progreso", "En revision", "Listo para entregar", "Completado"];
  const NO_FACTURABLES_HINT = ["llamada", "reunion", "gestion", "estrategia"];
  const DIAS_OCULTAR_COMPLETADO = 2;

  // Los completados se ocultan de la vista a los 2 dias, pero siguen en el Sheet
  // (Rendimiento y el resumen semanal los siguen viendo).
  function completadoVencido(t) {
    if (t.Estado !== "Completado" || !t.Fecha_completado) return false;
    // Las filas viejas guardan solo la fecha ("2026-07-20"); sin la hora, JS la
    // parsea como UTC y desfasa el corte. Se fuerza medianoche local.
    const raw = String(t.Fecha_completado);
    const fin = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
    if (isNaN(fin.getTime())) return false;
    return Date.now() - fin.getTime() >= DIAS_OCULTAR_COMPLETADO * 86400000;
  }

  function filtros() {
    return {
      cliente: document.getElementById("filtro-cliente").value,
      asignado: document.getElementById("filtro-asignado").value,
      tipo: document.getElementById("filtro-tipo").value,
    };
  }

  function poblarFiltroClientes() {
    const sel = document.getElementById("filtro-cliente");
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los clientes</option>';
    clientesConocidos().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.value = actual;

    const datalist = document.getElementById("lista-clientes");
    datalist.innerHTML = "";
    clientesConocidos().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      datalist.appendChild(opt);
    });
  }

  function render() {
    poblarFiltroClientes();
    const f = filtros();
    ESTADOS.forEach((estado) => {
      const col = document.querySelector(`.kanban-cards[data-estado="${estado}"]`);
      col.innerHTML = "";
    });

    let tareas = State.kanban.filter((t) => !completadoVencido(t));
    if (f.cliente) tareas = tareas.filter((t) => t.Cliente === f.cliente);
    if (f.asignado) tareas = tareas.filter((t) => t.Asignado_a === f.asignado);
    if (f.tipo) tareas = tareas.filter((t) => (t.Tipo || "").toLowerCase() === f.tipo);

    tareas.forEach((t) => {
      const col = document.querySelector(`.kanban-cards[data-estado="${t.Estado}"]`);
      if (col) col.appendChild(renderCard(t));
    });
  }

  // ---- Etapas de produccion: helpers ----
  function parseEtapasPlan(json) {
    try {
      const arr = JSON.parse(json || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function claseEtapaRatio(t, hist) {
    if (!t.Etapa_actual) return "neutral";
    const elapsedMin = elapsedEtapaMin(t);
    if (hist) return Rendimiento.ratioClase(elapsedMin / hist.promedio);
    // Sin historial todavia (ej. primera vez con esta etapa): usar el
    // tiempo estimado fijo como referencia en vez de quedar siempre neutral.
    const objetivo = tiempoEstimadoEtapa(t.Etapa_actual);
    if (objetivo) return Rendimiento.ratioClase(elapsedMin / objetivo);
    return "neutral";
  }

  function renderEtapaBlock(t) {
    if (!t.Etapas_plan) return null;
    const bloque = document.createElement("div");
    bloque.className = "card-etapa";

    const fila = filaEtapaActiva(t.ID);
    const pausada = !!(fila && fila.Estado === "pausada");
    const hist = t.Etapa_actual ? Rendimiento.promedioHistorico(t.Cliente, t.Entregable, t.Etapa_actual) : null;
    const dot = document.createElement("span");
    dot.className = `etapa-dot ${claseEtapaRatio(t, hist)}`;
    bloque.appendChild(dot);

    const nombre = document.createElement("span");
    nombre.className = `etapa-nombre${pausada ? " pausada" : ""}`;
    nombre.textContent = t.Etapa_actual
      ? `${t.Etapa_actual}${pausada ? " (pausada)" : ""}`
      : "Etapas completadas";
    bloque.appendChild(nombre);

    const tiempo = document.createElement("span");
    tiempo.className = "etapa-tiempo";
    if (t.Etapa_actual) {
      const acumulado = fila ? Number(fila.Acumulado_min || 0) : 0;
      if (!pausada && t.Etapa_inicio) {
        tiempo.dataset.start = t.Etapa_inicio;
        tiempo.dataset.offset = acumulado;
        tiempo.textContent = formatDuracion(Date.now() - new Date(t.Etapa_inicio).getTime() + acumulado * 60000);
      } else {
        tiempo.textContent = formatDuracion(acumulado * 60000);
      }
    } else {
      tiempo.textContent = "--:--";
    }
    bloque.appendChild(tiempo);

    if (t.Etapa_actual) {
      const acciones = document.createElement("div");
      acciones.className = "etapa-acciones";

      const btnPausa = document.createElement("button");
      btnPausa.className = "btn-ghost btn-small";
      btnPausa.textContent = pausada ? "Reanudar" : "Pausar";
      btnPausa.addEventListener("mousedown", (e) => e.stopPropagation());
      btnPausa.addEventListener("click", (e) => {
        e.stopPropagation();
        pausada ? reanudarEtapa(t.ID) : pausarEtapa(t.ID);
      });
      acciones.appendChild(btnPausa);

      if (!pausada) {
        const plan = parseEtapasPlan(t.Etapas_plan);
        const idx = plan.indexOf(t.Etapa_actual);
        const esUltima = idx === -1 || idx === plan.length - 1;
        const btn = document.createElement("button");
        btn.className = "btn-ghost btn-small";
        btn.textContent = esUltima ? "Finalizar" : "Siguiente etapa";
        btn.addEventListener("mousedown", (e) => e.stopPropagation());
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          avanzarEtapa(t.ID);
        });
        acciones.appendChild(btn);
      }

      bloque.appendChild(acciones);
    }

    return bloque;
  }

  function renderCard(t) {
    const card = document.createElement("div");
    card.className = "kanban-card";
    card.draggable = true;
    card.dataset.id = t.ID;

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = t.Titulo || "(sin titulo)";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const tipoBadge = document.createElement("span");
    tipoBadge.className = `badge ${t.Tipo === "facturable" ? "facturable" : "no-facturable"}`;
    tipoBadge.textContent = t.Tipo || "";
    meta.appendChild(tipoBadge);

    if (t.Cliente) {
      const c = document.createElement("span");
      c.className = "badge";
      c.textContent = t.Cliente;
      meta.appendChild(c);
    }
    const asignado = document.createElement("span");
    asignado.className = "badge";
    asignado.textContent = t.Asignado_a || "";
    meta.appendChild(asignado);

    if (t.Fecha_limite) {
      const fl = document.createElement("span");
      const vencida = new Date(t.Fecha_limite) < new Date() && t.Estado !== "Completado";
      fl.className = `badge ${vencida ? "vencida" : ""}`;
      fl.textContent = t.Fecha_limite.replace("T", " ");
      if (t.Estado !== "Completado") fl.dataset.limite = t.Fecha_limite;
      meta.appendChild(fl);
    }

    card.appendChild(meta);

    const etapaBlock = renderEtapaBlock(t);
    if (etapaBlock) card.appendChild(etapaBlock);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btnEditar = document.createElement("button");
    btnEditar.className = "btn-ghost btn-small";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("mousedown", (e) => e.stopPropagation());
    btnEditar.addEventListener("click", (e) => {
      e.stopPropagation();
      openModal(t);
    });
    actions.appendChild(btnEditar);

    const btnBorrar = document.createElement("button");
    btnBorrar.className = "btn-ghost btn-small btn-danger";
    btnBorrar.textContent = "Borrar";
    btnBorrar.addEventListener("mousedown", (e) => e.stopPropagation());
    btnBorrar.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Borrar la tarea "${t.Titulo || "(sin titulo)"}"?`)) return;
      await Api.deleteRow("kanban_tareas", t.ID);
      await refreshKanban();
      render();
      toast("Tarea borrada", "success");
    });
    actions.appendChild(btnBorrar);

    const nota = (t.Notas || "").trim();
    const notaWrap = document.createElement("div");
    notaWrap.className = "card-nota-wrap";

    const btnNota = document.createElement("button");
    btnNota.className = `btn-ghost btn-small btn-nota${nota ? " tiene-nota" : ""}`;
    const notaLabel = nota ? "Ver / editar nota" : "Agregar nota";
    // Con nota, el tooltip nativo se superpondria a la burbuja .nota-tooltip:
    // solo se usa title cuando no hay burbuja que mostrar.
    if (!nota) btnNota.title = notaLabel;
    btnNota.setAttribute("aria-label", notaLabel);
    btnNota.innerHTML =
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
      '<path fill="currentColor" d="M2.5 2h11a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H6.2L3.4 13.6A.5.5 0 0 1 2.5 13.2V11h-.5a.5.5 0 0 1-.5-.5v-8A.5.5 0 0 1 2.5 2Z"/>' +
      "</svg>";
    btnNota.addEventListener("mousedown", (e) => e.stopPropagation());
    btnNota.addEventListener("click", (e) => {
      e.stopPropagation();
      openModalNota(t);
    });
    notaWrap.appendChild(btnNota);

    if (nota) {
      const burbuja = document.createElement("span");
      burbuja.className = "nota-tooltip";
      burbuja.textContent = nota;
      notaWrap.appendChild(burbuja);
    }

    actions.appendChild(notaWrap);

    card.appendChild(actions);

    card.addEventListener("dragstart", () => {
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });

    return card;
  }

  function bindDragDrop() {
    document.querySelectorAll(".kanban-cards").forEach((col) => {
      col.addEventListener("dragover", (e) => {
        e.preventDefault();
        col.classList.add("drag-over");
      });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        const dragging = document.querySelector(".kanban-card.dragging");
        if (!dragging) return;
        const taskId = dragging.dataset.id;
        const nuevoEstado = col.dataset.estado;
        await moveCard(taskId, nuevoEstado);
      });
    });
  }

  async function moveCard(taskId, nuevoEstado) {
    const tarea = State.kanban.find((t) => String(t.ID) === String(taskId));
    if (!tarea || tarea.Estado === nuevoEstado) return;

    if (nuevoEstado === "En progreso" && tarea.Entregable && !tarea.Etapas_plan) {
      openModalEtapas(tarea);
      return;
    }

    await aplicarMovimiento(tarea, nuevoEstado);
  }

  async function cerrarEtapaEnCurso(tarea) {
    const fila = State.tareaEtapas.find(
      (r) => String(r.Tarea_ID) === String(tarea.ID) && (r.Estado === "en_curso" || r.Estado === "pausada")
    );
    if (!fila) return false;
    const ahora = nowDateTimeISO();
    const acumulado = Number(fila.Acumulado_min || 0);
    const transcurrido = fila.Estado === "en_curso"
      ? (Date.now() - new Date(fila.Fecha_inicio).getTime()) / 60000
      : 0;
    await Api.updateRow("tareas_etapas", fila.ID, {
      Estado: "completada",
      Fecha_fin: ahora,
      Duracion_min: Math.round(acumulado + transcurrido),
    });
    await refreshTareaEtapas();
    return true;
  }

  async function aplicarMovimiento(tarea, nuevoEstado, extraUpdates = {}) {
    const taskId = tarea.ID;
    const updates = { Estado: nuevoEstado, ...extraUpdates };

    if (nuevoEstado === "Completado") {
      updates.Fecha_completado = nowDateTimeISO();

      if ((tarea.Tipo || "").toLowerCase() === "facturable") {
        let monto = tarea.Monto_USD && Number(tarea.Monto_USD) > 0
          ? Number(tarea.Monto_USD)
          : buscarTarifa(tarea.Cliente, tarea.Entregable);
        if (monto === null || monto === undefined || isNaN(monto)) {
          try {
            const resp = await PromptModal.pedirPrecio(tarea.Cliente, tarea.Entregable);
            monto = resp.monto;
            // El modal solo pide el dato; la fila de tarifas la escribe el
            // llamador (antes lo hacía el backend antes de responder).
            if (resp.guardado) {
              await Api.createRow("tarifas", {
                Cliente: tarea.Cliente || "",
                Entregable: tarea.Entregable || "",
                Precio_USD: resp.monto,
              });
              await refreshTarifas();
            }
          } catch (e) {
            if (e.cancelado) toast("Movimiento cancelado: falta el precio", "");
            else toast(`Error pidiendo precio: ${e.message}`, "error");
            return;
          }
        }
        updates.Monto_USD = monto;
        await Api.createRow("cuentas_por_cobrar", {
          Cliente: tarea.Cliente || "",
          Entregable: tarea.Entregable || "",
          Monto_USD: monto,
          Fecha: todayISO(),
          Tarea_ID: tarea.ID,
          Estado_pago: "pendiente",
        });
      }

      if (["iBrk", "CM", "Ads"].includes(tarea.Asignado_a)) {
        await Api.createRow("empleados_output", {
          Semana: isoWeek(),
          Empleado: tarea.Asignado_a,
          Tipo_tarea: tarea.Entregable || tarea.Titulo || "",
          Cliente: tarea.Cliente || "",
          Cantidad: 1,
          Descripcion: tarea.Titulo || tarea.Notas || "",
          Fecha: todayISO(),
        });
        await refreshEmpleadosOutput();
      }

      // Ojo: no filtrar por tarea.Etapa_actual aqui (puede venir de una copia
      // de State.kanban desactualizada si esta funcion se llama justo tras
      // confirmar el modal de etapas, antes de que termine su propio
      // refreshKanban). cerrarEtapaEnCurso consulta State.tareaEtapas
      // directamente, que si esta al dia en ese momento.
      const etapaCerrada = await cerrarEtapaEnCurso(tarea);
      if (etapaCerrada || tarea.Etapa_actual) {
        updates.Etapa_actual = "";
        updates.Etapa_inicio = "";
      }
    }

    await Api.updateRow("kanban_tareas", taskId, updates);
    await refreshKanban();
    render();
    toast(`Tarea movida a "${nuevoEstado}"`, "success");
  }

  // ---- Modal de etapas (al entrar por primera vez a "En progreso") ----
  let etapasPendiente = null;

  function crearEtapaRow(valor) {
    const row = document.createElement("div");
    row.className = "etapa-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = valor;
    row.appendChild(input);
    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-ghost btn-small";
    btnQuitar.textContent = "×";
    btnQuitar.addEventListener("click", () => row.remove());
    row.appendChild(btnQuitar);
    return row;
  }

  function renderEtapasLista(nombres) {
    const cont = document.getElementById("etapas-lista");
    cont.innerHTML = "";
    nombres.forEach((n) => cont.appendChild(crearEtapaRow(n)));
  }

  function leerEtapasDelModal() {
    return Array.from(document.querySelectorAll("#etapas-lista input"))
      .map((el) => el.value.trim())
      .filter(Boolean);
  }

  function openModalEtapas(tarea) {
    etapasPendiente = tarea;
    document.getElementById("etapas-tarea-titulo").textContent = tarea.Titulo || "(sin titulo)";
    renderEtapasLista(etapasPorDefecto(tarea.Entregable));
    document.getElementById("modal-etapas").classList.remove("hidden");
  }

  function closeModalEtapas() {
    etapasPendiente = null;
    document.getElementById("modal-etapas").classList.add("hidden");
  }

  async function confirmarEtapas() {
    const tarea = etapasPendiente;
    if (!tarea) return;
    const nombres = leerEtapasDelModal();
    if (nombres.length === 0) {
      toast("Agrega al menos una etapa o usa 'Mover sin trackear'", "error");
      return;
    }
    const inicio = nowDateTimeISO();
    await Api.createRow("tareas_etapas", {
      Tarea_ID: tarea.ID,
      Cliente: tarea.Cliente || "",
      Entregable: tarea.Entregable || "",
      Etapa: nombres[0],
      Orden: 1,
      Estado: "en_curso",
      Fecha_inicio: inicio,
      Fecha_fin: "",
      Duracion_min: "",
      Acumulado_min: 0,
    });
    await refreshTareaEtapas();
    closeModalEtapas();
    await aplicarMovimiento(tarea, "En progreso", {
      Etapas_plan: JSON.stringify(nombres),
      Etapa_actual: nombres[0],
      Etapa_inicio: inicio,
    });
  }

  async function cancelarEtapasModal() {
    const tarea = etapasPendiente;
    closeModalEtapas();
    if (tarea) await aplicarMovimiento(tarea, "En progreso");
  }

  // ---- Avanzar / finalizar etapas desde la tarjeta ----
  const etapasEnProceso = new Set();

  async function avanzarEtapa(taskId) {
    const key = String(taskId);
    if (etapasEnProceso.has(key)) return; // evita duplicados por doble click mientras la llamada anterior sigue en curso
    etapasEnProceso.add(key);
    try {
      const tarea = State.kanban.find((t) => String(t.ID) === String(taskId));
      if (!tarea || !tarea.Etapa_actual) return;

      const filaActual = State.tareaEtapas.find(
        (r) => String(r.Tarea_ID) === String(taskId) && r.Estado === "en_curso"
      );
      const ahora = nowDateTimeISO();
      if (filaActual) {
        const acumulado = Number(filaActual.Acumulado_min || 0);
        const duracion = Math.round(acumulado + (Date.now() - new Date(filaActual.Fecha_inicio).getTime()) / 60000);
        await Api.updateRow("tareas_etapas", filaActual.ID, {
          Estado: "completada",
          Fecha_fin: ahora,
          Duracion_min: duracion,
        });
      }

      const plan = parseEtapasPlan(tarea.Etapas_plan);
      const idx = plan.indexOf(tarea.Etapa_actual);
      const siguiente = idx >= 0 && idx + 1 < plan.length ? plan[idx + 1] : null;

      if (siguiente) {
        await Api.createRow("tareas_etapas", {
          Tarea_ID: tarea.ID,
          Cliente: tarea.Cliente || "",
          Entregable: tarea.Entregable || "",
          Etapa: siguiente,
          Orden: idx + 2,
          Estado: "en_curso",
          Fecha_inicio: ahora,
          Fecha_fin: "",
          Duracion_min: "",
          Acumulado_min: 0,
        });
        await Api.updateRow("kanban_tareas", taskId, { Etapa_actual: siguiente, Etapa_inicio: ahora });
        toast(`Etapa "${siguiente}" iniciada`, "success");
      } else {
        await Api.updateRow("kanban_tareas", taskId, { Etapa_actual: "", Etapa_inicio: "" });
        toast(`Todas las etapas completadas para "${tarea.Titulo}" — puedes moverla a "Listo para entregar"`, "success");
      }

      await Promise.all([refreshKanban(), refreshTareaEtapas()]);
      render();
    } finally {
      etapasEnProceso.delete(key);
    }
  }

  // ---- Pausar / reanudar la etapa en curso (para cambiar a otra tarea sin
  // perder el tiempo ya invertido) ----
  async function pausarEtapa(taskId) {
    const tarea = State.kanban.find((t) => String(t.ID) === String(taskId));
    if (!tarea || !tarea.Etapa_actual || !tarea.Etapa_inicio) return;
    const fila = State.tareaEtapas.find(
      (r) => String(r.Tarea_ID) === String(taskId) && r.Estado === "en_curso"
    );
    if (!fila) return;
    const transcurrido = (Date.now() - new Date(fila.Fecha_inicio).getTime()) / 60000;
    // Redondeado a minutos enteros: Sheets guarda decimales con coma segun
    // el locale de la hoja ("12,5"), y Number("12,5") da NaN en JS -- igual
    // que Duracion_min, este campo nunca debe llevar fracciones.
    const acumulado = Math.round(Number(fila.Acumulado_min || 0) + transcurrido);
    await Api.updateRow("tareas_etapas", fila.ID, { Estado: "pausada", Acumulado_min: acumulado });
    await Api.updateRow("kanban_tareas", taskId, { Etapa_inicio: "" });
    await Promise.all([refreshKanban(), refreshTareaEtapas()]);
    render();
    toast(`Etapa "${tarea.Etapa_actual}" pausada`, "success");
  }

  async function reanudarEtapa(taskId) {
    const tarea = State.kanban.find((t) => String(t.ID) === String(taskId));
    if (!tarea || !tarea.Etapa_actual) return;
    const fila = State.tareaEtapas.find(
      (r) => String(r.Tarea_ID) === String(taskId) && r.Estado === "pausada"
    );
    if (!fila) return;
    const ahora = nowDateTimeISO();
    await Api.updateRow("tareas_etapas", fila.ID, { Estado: "en_curso", Fecha_inicio: ahora });
    await Api.updateRow("kanban_tareas", taskId, { Etapa_inicio: ahora });
    await Promise.all([refreshKanban(), refreshTareaEtapas()]);
    render();
    toast(`Etapa "${tarea.Etapa_actual}" reanudada`, "success");
  }

  // ---- Cronometro / countdown en vivo (sin llamar al backend) ----
  function evaluarNotificaciones(ahora) {
    State.kanban.forEach((t) => {
      if (t.Estado === "Completado") return;

      if (t.Fecha_limite) {
        const rest = new Date(t.Fecha_limite).getTime() - ahora;
        if (rest > 0 && rest <= 30 * 60000) {
          Notificaciones.notificar(
            `deadline|${t.ID}|${t.Fecha_limite}|30m`,
            "Deadline proximo",
            `"${t.Titulo || "Tarea"}" vence en 30 minutos o menos.`
          );
        } else if (rest > 0 && rest <= 2 * 3600000) {
          Notificaciones.notificar(
            `deadline|${t.ID}|${t.Fecha_limite}|2h`,
            "Deadline proximo",
            `"${t.Titulo || "Tarea"}" vence en menos de 2 horas.`
          );
        }
      }

      if (t.Etapa_actual && t.Etapa_inicio) {
        const elapsedMin = elapsedEtapaMin(t);

        const hist = Rendimiento.promedioHistorico(t.Cliente, t.Entregable, t.Etapa_actual);
        if (hist && elapsedMin > hist.promedio * 1.3) {
          Notificaciones.notificar(
            `etapa_lenta|${t.ID}|${t.Etapa_actual}|${t.Etapa_inicio}`,
            "Etapa mas lenta de lo usual",
            `"${t.Etapa_actual}" de ${t.Cliente || ""} lleva mas tiempo del promedio (${Math.round(hist.promedio)} min).`
          );
        }

        const objetivo = tiempoEstimadoEtapa(t.Etapa_actual);
        if (objetivo && elapsedMin > objetivo) {
          Notificaciones.notificar(
            `tiempo_estimado|${t.ID}|${t.Etapa_actual}|${t.Etapa_inicio}`,
            "Tiempo estimado superado",
            `"${t.Etapa_actual}" de ${t.Cliente || ""} ya superó el tiempo estimado (${objetivo} min). Marca "Siguiente etapa" si ya terminaste.`
          );
        }
      }
    });
  }

  function tickRelojes() {
    const ahora = Date.now();
    document.querySelectorAll(".etapa-tiempo[data-start]").forEach((el) => {
      const offsetMs = Number(el.dataset.offset || 0) * 60000;
      el.textContent = formatDuracion(ahora - new Date(el.dataset.start).getTime() + offsetMs);
    });
    document.querySelectorAll(".badge[data-limite]").forEach((el) => {
      const rest = new Date(el.dataset.limite) - ahora;
      el.classList.toggle("vencida", rest < 0);
      el.classList.toggle("proxima", rest >= 0 && rest <= 2 * 3600000);
    });
    evaluarNotificaciones(ahora);
  }

  // ---- Nota rapida por tarjeta ----
  let notaTaskId = null;

  function openModalNota(tarea) {
    notaTaskId = tarea.ID;
    document.getElementById("nota-tarea-titulo").textContent = tarea.Titulo || "(sin titulo)";
    document.getElementById("nota-texto").value = tarea.Notas || "";
    document.getElementById("modal-nota").classList.remove("hidden");
    document.getElementById("nota-texto").focus();
  }

  function closeModalNota() {
    notaTaskId = null;
    document.getElementById("modal-nota").classList.add("hidden");
  }

  async function guardarNota() {
    if (!notaTaskId) return;
    const texto = document.getElementById("nota-texto").value.trim();
    await Api.updateRow("kanban_tareas", notaTaskId, { Notas: texto });
    closeModalNota();
    await refreshKanban();
    render();
    toast(texto ? "Nota guardada" : "Nota borrada", "success");
  }

  // ---- Nueva tarea / edicion ----
  let editingTaskId = null;

  function openModal(tarea = null) {
    editingTaskId = tarea ? tarea.ID : null;
    document.getElementById("modal-tarea-titulo").textContent = tarea ? "Editar tarea" : "Nueva tarea";
    document.getElementById("btn-tarea-confirmar").textContent = tarea ? "Guardar" : "Crear";
    document.getElementById("tarea-titulo").value = tarea ? tarea.Titulo || "" : "";
    document.getElementById("tarea-cliente").value = tarea ? tarea.Cliente || "" : "";
    document.getElementById("tarea-entregable").value = tarea ? tarea.Entregable || "" : "";
    document.getElementById("tarea-tipo").value = tarea ? tarea.Tipo || "facturable" : "facturable";
    document.getElementById("tarea-asignado").value = tarea ? tarea.Asignado_a || "iBrk" : "iBrk";
    document.getElementById("tarea-fecha").value = tarea ? tarea.Fecha_limite || "" : "";
    document.getElementById("tarea-notas").value = tarea ? tarea.Notas || "" : "";
    document.getElementById("modal-tarea").classList.remove("hidden");
  }
  function closeModal() {
    editingTaskId = null;
    document.getElementById("modal-tarea").classList.add("hidden");
  }
  async function confirmarNuevaTarea() {
    const titulo = document.getElementById("tarea-titulo").value.trim();
    if (!titulo) {
      toast("El titulo es obligatorio", "error");
      return;
    }
    const payload = {
      Titulo: titulo,
      Tipo: document.getElementById("tarea-tipo").value,
      Cliente: document.getElementById("tarea-cliente").value.trim(),
      Entregable: document.getElementById("tarea-entregable").value,
      Asignado_a: document.getElementById("tarea-asignado").value,
      Fecha_limite: document.getElementById("tarea-fecha").value,
      Notas: document.getElementById("tarea-notas").value.trim(),
    };
    if (editingTaskId) {
      await Api.updateRow("kanban_tareas", editingTaskId, payload);
      toast("Tarea actualizada", "success");
    } else {
      await Api.createRow("kanban_tareas", {
        ...payload,
        Monto_USD: "",
        Estado: "Por hacer",
        Fecha_creacion: todayISO(),
        Fecha_completado: "",
        Etapas_plan: "",
        Etapa_actual: "",
        Etapa_inicio: "",
      });
      toast("Tarea creada", "success");
    }
    await refreshKanban();
    render();
    closeModal();
  }

  function bindEvents() {
    bindDragDrop();
    document.getElementById("btn-nueva-tarea").addEventListener("click", () => openModal());
    document.getElementById("btn-tarea-cancelar").addEventListener("click", closeModal);
    document.getElementById("btn-tarea-confirmar").addEventListener("click", confirmarNuevaTarea);
    document.getElementById("filtro-cliente").addEventListener("change", render);
    document.getElementById("filtro-asignado").addEventListener("change", render);
    document.getElementById("filtro-tipo").addEventListener("change", render);
    document.getElementById("btn-refresh-kanban").addEventListener("click", async () => {
      await refreshKanban();
      render();
    });

    document.querySelectorAll(".btn-deadline").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mins = Number(btn.dataset.mins);
        document.getElementById("tarea-fecha").value = toDatetimeLocalValue(new Date(Date.now() + mins * 60000));
      });
    });

    document.getElementById("btn-etapa-agregar").addEventListener("click", () => {
      document.getElementById("etapas-lista").appendChild(crearEtapaRow(""));
    });
    document.getElementById("btn-etapas-confirmar").addEventListener("click", confirmarEtapas);
    document.getElementById("btn-etapas-cancelar").addEventListener("click", cancelarEtapasModal);

    document.getElementById("btn-nota-cancelar").addEventListener("click", closeModalNota);
    document.getElementById("btn-nota-guardar").addEventListener("click", guardarNota);

    setInterval(tickRelojes, 1000);
  }

  return { render, bindEvents, moveCard };
})();
