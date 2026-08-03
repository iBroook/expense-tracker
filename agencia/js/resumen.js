// Pestaña 3: Resumen Semanal Empleados
const Resumen = (() => {
  function semanaSeleccionada() {
    const input = document.getElementById("selector-semana");
    return input.value || isoWeek();
  }

  function setDefaultWeek() {
    const input = document.getElementById("selector-semana");
    if (!input.value) input.value = isoWeek();
  }

  function render() {
    setDefaultWeek();
    const semana = semanaSeleccionada();
    const filas = State.empleadosOutput.filter((r) => r.Semana === semana);

    const ibrk = filas.filter((r) => r.Empleado === "iBrk");
    const cm = filas.filter((r) => r.Empleado === "CM");
    const ads = filas.filter((r) => r.Empleado === "Ads");

    const ibrkBody = document.querySelector("#tabla-ibrk tbody");
    ibrkBody.innerHTML = "";
    ibrk.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.Cliente || ""}</td><td>${r.Tipo_tarea || ""}</td><td>${r.Descripcion || ""}</td><td>${r.Fecha || ""}</td>`;
      ibrkBody.appendChild(tr);
    });
    if (ibrk.length === 0) ibrkBody.innerHTML = '<tr><td colspan="4" class="empty-hint">Sin actividad esta semana</td></tr>';

    const cmBody = document.querySelector("#tabla-cm tbody");
    cmBody.innerHTML = "";
    cm.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.Cliente || ""}</td><td>${r.Tipo_tarea || ""}</td><td>${r.Cantidad || 1}</td><td>${r.Fecha || ""}</td>`;
      cmBody.appendChild(tr);
    });
    if (cm.length === 0) cmBody.innerHTML = '<tr><td colspan="4" class="empty-hint">Sin actividad esta semana</td></tr>';

    const adsBody = document.querySelector("#tabla-ads tbody");
    adsBody.innerHTML = "";
    ads.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.Cliente || ""}</td><td>${r.Tipo_tarea || ""}</td><td>${r.Descripcion || ""}</td><td>${r.Fecha || ""}</td>`;
      adsBody.appendChild(tr);
    });
    if (ads.length === 0) adsBody.innerHTML = '<tr><td colspan="4" class="empty-hint">Sin actividad esta semana</td></tr>';

    const totalIbrk = ibrk.reduce((s, r) => s + Number(r.Cantidad || 1), 0);
    const totalCm = cm.reduce((s, r) => s + Number(r.Cantidad || 1), 0);
    const totalAds = ads.reduce((s, r) => s + Number(r.Cantidad || 1), 0);
    document.getElementById("totales-semana").innerHTML =
      `<span>Total iBrk: ${totalIbrk} tareas</span><span>Total CM: ${totalCm} piezas</span><span>Total Ads: ${totalAds} tareas</span>`;
  }

  function exportarTexto() {
    const semana = semanaSeleccionada();
    const filas = State.empleadosOutput.filter((r) => r.Semana === semana);
    const ibrk = filas.filter((r) => r.Empleado === "iBrk");
    const cm = filas.filter((r) => r.Empleado === "CM");
    const ads = filas.filter((r) => r.Empleado === "Ads");

    let texto = `*Resumen semana ${semana}*\n\n`;
    texto += `*iBrk*\n`;
    if (ibrk.length === 0) texto += "- Sin actividad\n";
    ibrk.forEach((r) => {
      texto += `- ${r.Cliente || ""}: ${r.Tipo_tarea || ""} (${r.Fecha || ""})\n`;
    });
    texto += `\n*Community Manager*\n`;
    if (cm.length === 0) texto += "- Sin actividad\n";
    cm.forEach((r) => {
      texto += `- ${r.Cliente || ""}: ${r.Tipo_tarea || ""} (${r.Fecha || ""})\n`;
    });
    texto += `\n*Ads Manager*\n`;
    if (ads.length === 0) texto += "- Sin actividad\n";
    ads.forEach((r) => {
      texto += `- ${r.Cliente || ""}: ${r.Tipo_tarea || ""} - ${r.Descripcion || ""} (${r.Fecha || ""})\n`;
    });

    navigator.clipboard
      .writeText(texto)
      .then(() => toast("Resumen copiado al portapapeles", "success"))
      .catch(() => {
        prompt("Copia manualmente el resumen:", texto);
      });
  }

  // ---- Entregable directo CM/Ads (sin pasar por Kanban) ----
  function openModalEntrega() {
    document.getElementById("entrega-empleado").value = "CM";
    document.getElementById("entrega-cliente").value = "";
    document.getElementById("entrega-tipo").value = "";
    document.getElementById("entrega-cantidad").value = 1;
    document.getElementById("entrega-descripcion").value = "";
    document.getElementById("entrega-facturable").checked = false;
    document.getElementById("modal-entrega").classList.remove("hidden");
  }
  function closeModalEntrega() {
    document.getElementById("modal-entrega").classList.add("hidden");
  }

  async function confirmarEntregaDirecta() {
    const empleado = document.getElementById("entrega-empleado").value;
    const cliente = document.getElementById("entrega-cliente").value.trim();
    const tipo = document.getElementById("entrega-tipo").value.trim();
    const cantidad = Number(document.getElementById("entrega-cantidad").value) || 1;
    const descripcion = document.getElementById("entrega-descripcion").value.trim();
    const facturable = document.getElementById("entrega-facturable").checked;

    if (!cliente || !tipo) {
      toast("Cliente y tipo de entregable son obligatorios", "error");
      return;
    }

    const hoy = todayISO();
    await Api.createRow("empleados_output", {
      Semana: isoWeek(),
      Empleado: empleado,
      Tipo_tarea: tipo,
      Cliente: cliente,
      Cantidad: cantidad,
      Descripcion: descripcion,
      Fecha: hoy,
    });

    if (facturable) {
      let monto = buscarTarifa(cliente, tipo);
      if (monto === null || monto === undefined || isNaN(monto)) {
        try {
          const resp = await PromptModal.pedirPrecio(cliente, tipo);
          monto = resp.monto;
          // El modal solo pide el dato; la fila de tarifas la escribe el
          // llamador (antes lo hacía el backend antes de responder).
          if (resp.guardado) {
            await Api.createRow("tarifas", {
              Cliente: cliente,
              Entregable: tipo,
              Precio_USD: resp.monto,
            });
            await refreshTarifas();
          }
        } catch (e) {
          // Sin precio no se crea la fila de cuentas por cobrar, pero el
          // output del empleado ya quedó registrado igual.
          if (e.cancelado) toast("Sin precio: no se registró el cobro", "");
          else toast(`Error pidiendo precio: ${e.message}`, "error");
          monto = null;
        }
      }
      if (monto !== null && monto !== undefined && !isNaN(monto)) {
        await Api.createRow("cuentas_por_cobrar", {
          Cliente: cliente,
          Entregable: tipo,
          Monto_USD: monto * cantidad,
          Fecha: hoy,
          Tarea_ID: "",
          Estado_pago: "pendiente",
        });
        await refreshCxc();
        Cobrar.render();
      }
    }

    await refreshEmpleadosOutput();
    render();
    closeModalEntrega();
    toast(`Entregable registrado: ${cliente} - ${tipo}`, "success");
  }

  function bindEvents() {
    document.getElementById("selector-semana").addEventListener("change", render);
    document.getElementById("btn-export-resumen").addEventListener("click", exportarTexto);
    document.getElementById("btn-entrega-directa").addEventListener("click", openModalEntrega);
    document.getElementById("btn-entrega-cancelar").addEventListener("click", closeModalEntrega);
    document.getElementById("btn-entrega-confirmar").addEventListener("click", confirmarEntregaDirecta);
  }

  return { render, bindEvents };
})();
