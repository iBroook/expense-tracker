// Vista: Cuentas por Cobrar
const Cobrar = (() => {
  function render() {
    const container = document.getElementById("cxc-content");
    container.innerHTML = "";

    if (State.cxc.length === 0) {
      container.innerHTML = '<div class="empty-hint">No hay cuentas por cobrar registradas.</div>';
      return;
    }

    const porCliente = {};
    State.cxc.forEach((c) => {
      const key = c.Cliente || "Sin cliente";
      (porCliente[key] = porCliente[key] || []).push(c);
    });

    let totalGeneral = 0;

    Object.keys(porCliente)
      .sort()
      .forEach((cliente) => {
        const items = porCliente[cliente];
        const totalCliente = items.reduce((s, i) => s + Number(i.Monto_USD || 0), 0);
        totalGeneral += totalCliente;

        const block = document.createElement("div");
        block.className = "cxc-client-block";

        const header = document.createElement("h3");
        header.innerHTML = `<span>${cliente}</span><span>${fmtMoney(totalCliente)}</span>`;
        block.appendChild(header);

        const table = document.createElement("table");
        table.className = "data-table";
        table.innerHTML =
          "<thead><tr><th>Entregable</th><th>Monto</th><th>Fecha</th><th>Estado</th></tr></thead>";
        const tbody = document.createElement("tbody");
        items.forEach((i) => {
          const tr = document.createElement("tr");
          const tdEntregable = document.createElement("td");
          tdEntregable.textContent = i.Entregable || "";
          const tdMonto = document.createElement("td");
          tdMonto.textContent = fmtMoney(i.Monto_USD);
          const tdFecha = document.createElement("td");
          tdFecha.textContent = i.Fecha || "";
          const tdEstado = document.createElement("td");
          const btn = document.createElement("button");
          const pagado = (i.Estado_pago || "pendiente") === "pagado";
          btn.className = `pago-toggle ${pagado ? "pago-pagado" : "pago-pendiente"}`;
          btn.textContent = pagado ? "Pagado" : "Pendiente";
          btn.addEventListener("click", async () => {
            const nuevo = pagado ? "pendiente" : "pagado";
            await Api.updateRow("cuentas_por_cobrar", i.ID, { Estado_pago: nuevo });
            await refreshCxc();
            render();
          });
          tdEstado.appendChild(btn);
          tr.append(tdEntregable, tdMonto, tdFecha, tdEstado);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        block.appendChild(table);

        const btnExport = document.createElement("button");
        btnExport.className = "btn-ghost btn-small";
        btnExport.textContent = "Exportar cobro (texto)";
        btnExport.addEventListener("click", () => exportarCliente(cliente, items, totalCliente));
        block.appendChild(btnExport);

        const btnRecibo = document.createElement("button");
        btnRecibo.className = "btn-ghost btn-small";
        btnRecibo.textContent = "Generar recibo";
        btnRecibo.addEventListener("click", () => Recibo.generar(cliente, items, totalCliente));
        block.appendChild(btnRecibo);

        container.appendChild(block);
      });

    const totalDiv = document.createElement("div");
    totalDiv.className = "cxc-total-general";
    totalDiv.textContent = `Total general: ${fmtMoney(totalGeneral)}`;
    container.appendChild(totalDiv);
  }

  function exportarCliente(cliente, items, total) {
    let texto = `*Cuenta por cobrar - ${cliente}*\n\n`;
    items.forEach((i) => {
      texto += `- ${i.Entregable || ""}: ${fmtMoney(i.Monto_USD)} (${i.Fecha || ""}) [${i.Estado_pago || "pendiente"}]\n`;
    });
    texto += `\nTotal: ${fmtMoney(total)}`;

    navigator.clipboard
      .writeText(texto)
      .then(() => toast(`Cobro de ${cliente} copiado al portapapeles`, "success"))
      .catch(() => {
        prompt("Copia manualmente el texto de cobro:", texto);
      });
  }

  function bindEvents() {
    document.getElementById("btn-refresh-cxc").addEventListener("click", async () => {
      await refreshCxc();
      render();
    });
  }

  return { render, bindEvents };
})();
