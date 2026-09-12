// Pestaña 1: Material Disponible
const Material = (() => {
  let pendingParsed = null; // resultado de parseMensaje mientras se resuelve la pregunta
  let editingId = null; // ID del item actualmente en modo edicion

  const TIPOS = ["reel", "video", "carousel", "post", "reel_extracto"];

  // GIF transparente de 1x1: se usa como placeholder mientras baja la foto de
  // Drive, para no mostrar el ícono de imagen rota del navegador.
  const PLACEHOLDER_FOTO =
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  // Las fotos ya no son rutas servidas por el backend: son referencias
  // "drive:<id>" que hay que descargar con el token y convertir a blob URL.
  // Los registros viejos guardan rutas "uploads/..." que ya no existen en
  // ningún lado; idDeRef() devuelve null para ellas.
  function pintarThumb(thumb, ref) {
    thumb.src = PLACEHOLDER_FOTO;
    if (!DriveFiles.idDeRef(ref)) {
      thumb.alt = "archivo no migrado";
      thumb.title = "archivo no migrado";
      return false;
    }
    thumb.alt = "Cargando foto...";
    DriveFiles.asignarSrc(thumb, ref).then(() => {
      thumb.alt = "Foto del material";
    }).catch((e) => {
      thumb.src = PLACEHOLDER_FOTO;
      thumb.alt = `No se pudo cargar la foto: ${e.message}`;
      thumb.title = thumb.alt;
    });
    return true;
  }

  // Borra el archivo de Drive asociado a una foto que deja de estar
  // referenciada, para no acumular huérfanos. Nunca aborta la operación
  // principal: si el borrado falla, solo se avisa.
  // A la papelera, no borrado permanente: se puede recuperar desde Drive si
  // hizo falta. Nunca aborta la accion que lo llama; si falla, solo avisa.
  async function borrarFotoDeDrive(ref) {
    if (!DriveFiles.idDeRef(ref)) return;
    try {
      await DriveFiles.moverAPapelera(ref);
    } catch (e) {
      toast(`No se pudo mover la foto a la papelera de Drive: ${e.message}`, "error");
    }
  }

  function poblarFiltroCliente() {
    const sel = document.getElementById("filtro-cliente-material");
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los clientes</option>';
    clientesConocidos().forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.value = actual;
  }

  function render() {
    poblarFiltroCliente();
    const filtroCliente = document.getElementById("filtro-cliente-material").value;

    const container = document.getElementById("material-list");
    container.innerHTML = "";
    let activos = State.material.filter((m) => m.Estado !== "Completado");
    if (filtroCliente) activos = activos.filter((m) => m.Cliente === filtroCliente);

    if (activos.length === 0) {
      container.innerHTML = '<div class="empty-hint">No hay material pendiente.</div>';
      return;
    }

    activos.forEach((m) => (m._prioridadCalc = calcPriority(m)));
    activos.sort((a, b) => prioridadOrden(a._prioridadCalc) - prioridadOrden(b._prioridadCalc));

    const grupos = {};
    activos.forEach((m) => {
      const key = m.Cliente || "Sin cliente";
      (grupos[key] = grupos[key] || []).push(m);
    });

    Object.keys(grupos)
      .sort()
      .forEach((cliente) => {
        const group = document.createElement("div");
        group.className = "material-client-group";
        const title = document.createElement("h3");
        title.textContent = `${cliente} (${grupos[cliente].length})`;
        group.appendChild(title);
        grupos[cliente].forEach((m) =>
          group.appendChild(m.ID === editingId ? renderEditItem(m) : renderItem(m))
        );
        container.appendChild(group);
      });
  }

  function renderItem(m) {
    const row = document.createElement("div");
    row.className = "material-item";

    const tipoBadge = document.createElement("span");
    tipoBadge.className = "tipo-badge";
    tipoBadge.textContent = m.Tipo || "?";
    row.appendChild(tipoBadge);

    if (m.Foto) {
      const thumb = document.createElement("img");
      thumb.className = "material-foto-thumb";
      const migrada = pintarThumb(thumb, m.Foto);
      if (migrada) thumb.title = "Ver foto completa";
      thumb.addEventListener("click", () => {
        if (!migrada) return;
        DriveFiles.abrirEnPestana(m.Foto).catch((e) => {
          toast(`No se pudo abrir la foto: ${e.message}`, "error");
        });
      });
      row.appendChild(thumb);
    }

    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = m.Descripcion || "";
    row.appendChild(desc);

    const fechas = document.createElement("span");
    fechas.className = "fechas";
    fechas.textContent = `Subido: ${m.Fecha_subida || "-"}`;
    row.appendChild(fechas);

    const fechaEntregaInput = document.createElement("input");
    fechaEntregaInput.type = "date";
    fechaEntregaInput.value = m.Fecha_entrega || "";
    fechaEntregaInput.title = "Fecha de entrega";
    fechaEntregaInput.addEventListener("change", async () => {
      const nuevaPrioridad = calcPriority({ ...m, Fecha_entrega: fechaEntregaInput.value });
      await Api.updateRow("material_disponible", m.ID, {
        Fecha_entrega: fechaEntregaInput.value,
        Prioridad: nuevaPrioridad,
      });
      await refreshMaterial();
      render();
    });
    row.appendChild(fechaEntregaInput);

    const prio = document.createElement("span");
    prio.className = `prioridad-badge prioridad-${m._prioridadCalc.toLowerCase()}`;
    prio.textContent = m._prioridadCalc;
    row.appendChild(prio);

    const actions = document.createElement("span");
    actions.className = "item-actions";

    const btnEditar = document.createElement("button");
    btnEditar.className = "btn-ghost btn-small";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => {
      editingId = m.ID;
      render();
    });
    actions.appendChild(btnEditar);

    const btnKanban = document.createElement("button");
    btnKanban.className = "btn-ghost btn-small";
    btnKanban.textContent = "Enviar a Kanban";
    btnKanban.addEventListener("click", () => enviarAKanban(m));
    actions.appendChild(btnKanban);

    const btnCompletar = document.createElement("button");
    btnCompletar.className = "btn-primary btn-small";
    btnCompletar.textContent = "Completar";
    btnCompletar.addEventListener("click", () => completarMaterial(m));
    actions.appendChild(btnCompletar);

    row.appendChild(actions);
    return row;
  }

  function renderEditItem(m) {
    const row = document.createElement("div");
    row.className = "material-item material-item-edit";

    const clienteInput = document.createElement("input");
    clienteInput.type = "text";
    clienteInput.value = m.Cliente || "";
    clienteInput.setAttribute("list", "lista-clientes");
    clienteInput.title = "Cliente";

    const tipoSelect = document.createElement("select");
    TIPOS.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === m.Tipo) opt.selected = true;
      tipoSelect.appendChild(opt);
    });

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.value = m.Descripcion || "";
    descInput.className = "desc";
    descInput.title = "Descripcion";

    const fechaSubidaInput = document.createElement("input");
    fechaSubidaInput.type = "date";
    fechaSubidaInput.value = m.Fecha_subida || "";
    fechaSubidaInput.title = "Fecha de subida";

    const fechaEntregaInput = document.createElement("input");
    fechaEntregaInput.type = "date";
    fechaEntregaInput.value = m.Fecha_entrega || "";
    fechaEntregaInput.title = "Fecha de entrega";

    const notasInput = document.createElement("input");
    notasInput.type = "text";
    notasInput.value = m.Notas || "";
    notasInput.title = "Notas";
    notasInput.placeholder = "Notas";

    const fotoEditInput = document.createElement("input");
    fotoEditInput.type = "file";
    fotoEditInput.accept = "image/png,image/jpeg,image/gif,image/webp";
    fotoEditInput.title = m.Foto ? "Reemplazar foto" : "Adjuntar foto";

    row.append(clienteInput, tipoSelect, descInput, fechaSubidaInput, fechaEntregaInput, notasInput, fotoEditInput);

    let quitarFoto = false;
    if (m.Foto) {
      const thumb = document.createElement("img");
      thumb.className = "material-foto-thumb";
      pintarThumb(thumb, m.Foto);
      thumb.title = "Quitar foto";
      thumb.addEventListener("click", () => {
        quitarFoto = !quitarFoto;
        thumb.style.opacity = quitarFoto ? 0.3 : 1;
      });
      row.appendChild(thumb);
    }

    const actions = document.createElement("span");
    actions.className = "item-actions";

    const btnGuardar = document.createElement("button");
    btnGuardar.className = "btn-primary btn-small";
    btnGuardar.textContent = "Guardar";
    btnGuardar.addEventListener("click", async () => {
      const updates = {
        Cliente: clienteInput.value.trim(),
        Tipo: tipoSelect.value,
        Descripcion: descInput.value.trim(),
        Fecha_subida: fechaSubidaInput.value,
        Fecha_entrega: fechaEntregaInput.value,
        Notas: notasInput.value.trim(),
      };
      updates.Prioridad = calcPriority({ Cliente: updates.Cliente, Tipo: updates.Tipo, Fecha_entrega: updates.Fecha_entrega });
      // Se sube el File tal cual a Drive y se guarda su referencia
      // "drive:<id>": ya no hay data URL ni ruta en disco.
      if (fotoEditInput.files[0]) {
        try {
          const resp = await DriveFiles.subirFotoMaterial(fotoEditInput.files[0]);
          updates.Foto = resp.ref;
        } catch (e) {
          toast(`No se pudo subir la foto: ${e.message}`, "error");
          return;
        }
        // La foto anterior queda sin referencias: se borra de Drive.
        if (m.Foto) await borrarFotoDeDrive(m.Foto);
      } else if (quitarFoto) {
        updates.Foto = "";
        await borrarFotoDeDrive(m.Foto);
      }
      await Api.updateRow("material_disponible", m.ID, updates);
      editingId = null;
      await refreshMaterial();
      render();
      toast("Item actualizado", "success");
    });
    actions.appendChild(btnGuardar);

    const btnCancelar = document.createElement("button");
    btnCancelar.className = "btn-ghost btn-small";
    btnCancelar.textContent = "Cancelar";
    btnCancelar.addEventListener("click", () => {
      editingId = null;
      render();
    });
    actions.appendChild(btnCancelar);

    const btnBorrar = document.createElement("button");
    btnBorrar.className = "btn-ghost btn-small btn-danger";
    btnBorrar.textContent = "Borrar";
    btnBorrar.addEventListener("click", async () => {
      if (!confirm(`Borrar este item de ${m.Cliente || "cliente sin nombre"} (${m.Tipo || "?"})?`)) return;
      await Api.deleteRow("material_disponible", m.ID);
      if (m.Foto) await borrarFotoDeDrive(m.Foto);
      editingId = null;
      await refreshMaterial();
      render();
      toast("Item borrado", "success");
    });
    actions.appendChild(btnBorrar);

    row.appendChild(actions);
    return row;
  }

  async function enviarAKanban(m) {
    const titulo = [m.Tipo || "Entregable", m.Cliente, m.Descripcion]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(" - ");
    await Api.createRow("kanban_tareas", {
      Titulo: titulo,
      Tipo: "facturable",
      Cliente: m.Cliente || "",
      Entregable: m.Tipo || "",
      Monto_USD: "",
      Estado: "Por hacer",
      Fecha_creacion: todayISO(),
      Fecha_completado: "",
      Asignado_a: "iBrk",
      Fecha_limite: "",
      Notas: "",
    });
    await Api.deleteRow("material_disponible", m.ID);
    // La tarea del kanban no guarda la foto: sin esto quedaba huerfana en Drive.
    await borrarFotoDeDrive(m.Foto);
    await Promise.all([refreshMaterial(), refreshKanban()]);
    render();
    Kanban.render();
    toast(`${m.Cliente} enviado al Kanban`, "success");
  }

  async function completarMaterial(m) {
    let monto = buscarTarifa(m.Cliente, m.Tipo);
    if (monto === null) {
      try {
        const resp = await PromptModal.pedirPrecio(m.Cliente, m.Tipo);
        monto = resp.monto;
        // El modal solo pide el dato; la fila de tarifas la escribe el
        // llamador (antes lo hacía el backend antes de responder).
        if (resp.guardado) {
          await Api.createRow("tarifas", {
            Cliente: m.Cliente || "",
            Entregable: m.Tipo || "",
            Precio_USD: resp.monto,
          });
          await refreshTarifas();
        }
      } catch (e) {
        if (e.cancelado) toast("Completado cancelado: falta el precio", "");
        else toast(`Error pidiendo precio: ${e.message}`, "error");
        return;
      }
    }
    await Api.createRow("cuentas_por_cobrar", {
      Cliente: m.Cliente || "",
      Entregable: m.Tipo || "",
      Monto_USD: monto,
      Fecha: todayISO(),
      Tarea_ID: "",
      Estado_pago: "pendiente",
    });
    await Api.deleteRow("material_disponible", m.ID);
    await borrarFotoDeDrive(m.Foto);
    await Promise.all([refreshMaterial(), refreshCxc()]);
    render();
    toast(`Completado: ${m.Cliente} - ${m.Tipo} (${fmtMoney(monto)})`, "success");
  }

  // ---- Modal: Cargar desde mensaje ----
  function openModal() {
    document.getElementById("mensaje-texto").value = "";
    document.getElementById("mensaje-inferencia").textContent = "";
    const fotoInput = document.getElementById("mensaje-foto");
    fotoInput.value = "";
    const preview = document.getElementById("mensaje-foto-preview");
    preview.src = "";
    preview.classList.add("hidden");
    document.getElementById("modal-mensaje").classList.remove("hidden");
    document.getElementById("mensaje-texto").focus();
  }
  function closeModal() {
    document.getElementById("modal-mensaje").classList.add("hidden");
  }

  function mostrarPreviewFoto() {
    const fotoInput = document.getElementById("mensaje-foto");
    const preview = document.getElementById("mensaje-foto-preview");
    const file = fotoInput.files[0];
    if (!file) {
      preview.src = "";
      preview.classList.add("hidden");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }

  // Sube la foto elegida (si hay una) y devuelve la referencia "drive:<id>"
  // guardada, o "" si no se adjuntó ninguna.
  async function subirFotoAdjunta() {
    const fotoInput = document.getElementById("mensaje-foto");
    const file = fotoInput.files[0];
    if (!file) return "";
    try {
      const resp = await DriveFiles.subirFotoMaterial(file);
      return resp.ref;
    } catch (e) {
      toast(`No se pudo subir la foto: ${e.message}`, "error");
      return "";
    }
  }

  function actualizarInferencia() {
    const texto = document.getElementById("mensaje-texto").value;
    const parsed = parseMensaje(texto, clientesConocidos());
    const box = document.getElementById("mensaje-inferencia");
    if (!texto.trim()) {
      box.textContent = "";
      return;
    }
    const clienteTxt = parsed.cliente
      ? `<span class="ok">Cliente detectado: ${parsed.cliente}</span>`
      : `<span class="warn">Cliente no detectado (se preguntará)</span>`;

    if (parsed.items && parsed.items.length > 1) {
      const lista = parsed.items
        .map((it, i) => `${i + 1}. ${it.tipo || "? (se preguntará)"} — ${it.descripcion}`)
        .join("<br>");
      box.innerHTML = `${clienteTxt}<br><span class="ok">${parsed.items.length} items detectados en la lista:</span><br>${lista}`;
      return;
    }

    const tipoTxt = parsed.tipo
      ? `<span class="ok">Tipo detectado: ${parsed.tipo}</span>`
      : `<span class="warn">Tipo no detectado (se preguntará)</span>`;
    const cantidadTxt =
      parsed.cantidad > 1
        ? `<br><span class="ok">Cantidad detectada: ${parsed.cantidad} items separados</span>`
        : "";
    box.innerHTML = `${clienteTxt}<br>${tipoTxt}${cantidadTxt}`;
  }

  // Un item de la lista sin tipo propio cuenta como "tipo faltante" solo si
  // tampoco hay un tipo global detectado para usar como respaldo.
  function faltaTipo(parsed) {
    if (parsed.items && parsed.items.length > 1) return parsed.items.some((it) => !it.tipo);
    return !parsed.tipo;
  }

  async function confirmarCarga() {
    const texto = document.getElementById("mensaje-texto").value.trim();
    if (!texto) {
      toast("Escribe o pega un mensaje primero", "error");
      return;
    }
    const parsed = parseMensaje(texto, clientesConocidos());
    parsed.foto = await subirFotoAdjunta();
    if (!parsed.cliente || faltaTipo(parsed)) {
      pendingParsed = parsed;
      closeModal();
      abrirPreguntaFaltantes(parsed);
      return;
    }
    await crearMaterial(parsed);
    closeModal();
  }

  function abrirPreguntaFaltantes(parsed) {
    const body = document.getElementById("pregunta-cuerpo");
    body.innerHTML = "";
    if (!parsed.cliente) {
      const label = document.createElement("label");
      label.textContent = "Cliente";
      const input = document.createElement("input");
      input.type = "text";
      input.id = "pregunta-cliente";
      input.setAttribute("list", "lista-clientes");
      label.appendChild(input);
      body.appendChild(label);
    }
    if (faltaTipo(parsed)) {
      const label = document.createElement("label");
      label.textContent =
        parsed.items && parsed.items.length > 1
          ? "Tipo de entregable (para los items sin tipo detectado)"
          : "Tipo de entregable";
      const select = document.createElement("select");
      select.id = "pregunta-tipo";
      TIPOS.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
      });
      label.appendChild(select);
      body.appendChild(label);
    }
    document.getElementById("modal-pregunta").classList.remove("hidden");
  }

  async function confirmarPregunta() {
    const clienteInput = document.getElementById("pregunta-cliente");
    const tipoInput = document.getElementById("pregunta-tipo");
    const cliente = clienteInput ? clienteInput.value.trim() : pendingParsed.cliente;
    const tipo = tipoInput ? tipoInput.value : pendingParsed.tipo;
    if (!cliente || (tipoInput && !tipo)) {
      toast("Completa los campos faltantes", "error");
      return;
    }
    const parsed = { ...pendingParsed, cliente };
    if (tipoInput) {
      parsed.tipo = parsed.tipo || tipo;
      if (parsed.items) {
        parsed.items = parsed.items.map((it) => ({ ...it, tipo: it.tipo || tipo }));
      }
    }
    await crearMaterial(parsed);
    document.getElementById("modal-pregunta").classList.add("hidden");
    pendingParsed = null;
  }

  async function crearMaterial(parsed) {
    let items;
    if (parsed.items && parsed.items.length > 1) {
      items = parsed.items.map((it) => ({ tipo: it.tipo || parsed.tipo, descripcion: it.descripcion }));
    } else {
      const cantidad = parsed.cantidad && parsed.cantidad > 1 ? parsed.cantidad : 1;
      items = [];
      for (let i = 1; i <= cantidad; i++) {
        const descripcion = cantidad > 1 ? `${parsed.descripcion} (${i}/${cantidad})` : parsed.descripcion;
        items.push({ tipo: parsed.tipo, descripcion });
      }
    }

    for (const item of items) {
      const prioridad = calcPriority({ Cliente: parsed.cliente, Tipo: item.tipo, Fecha_entrega: "" });
      await Api.createRow("material_disponible", {
        Cliente: parsed.cliente,
        Tipo: item.tipo,
        Descripcion: item.descripcion,
        Fecha_subida: todayISO(),
        Fecha_entrega: "",
        Prioridad: prioridad,
        Estado: "Disponible",
        Notas: "",
        Foto: parsed.foto || "",
      });
    }
    await refreshMaterial();
    render();
    const detalle = items.length > 1 ? `${items.length} items` : items[0].tipo;
    toast(`Material cargado: ${parsed.cliente} - ${detalle}`, "success");
  }

  function bindEvents() {
    document.getElementById("btn-cargar-mensaje").addEventListener("click", openModal);
    document.getElementById("btn-mensaje-cancelar").addEventListener("click", closeModal);
    document.getElementById("btn-mensaje-confirmar").addEventListener("click", confirmarCarga);
    document.getElementById("mensaje-texto").addEventListener("input", actualizarInferencia);
    document.getElementById("mensaje-foto").addEventListener("change", mostrarPreviewFoto);
    document.getElementById("btn-pregunta-confirmar").addEventListener("click", confirmarPregunta);
    document.getElementById("btn-pregunta-cancelar").addEventListener("click", () => {
      document.getElementById("modal-pregunta").classList.add("hidden");
      pendingParsed = null;
    });
    document.getElementById("filtro-cliente-material").addEventListener("change", render);
    document.getElementById("btn-refresh-material").addEventListener("click", async () => {
      await refreshMaterial();
      render();
    });
  }

  return { render, bindEvents };
})();
