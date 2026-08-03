// Vista: Recibo de cobro (RealContent) - genera un HTML imprimible como PDF
const Recibo = (() => {
  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  function fechaHoy() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")} de ${MESES[d.getMonth()]}, ${d.getFullYear()}`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Patron de fondo tipo "lineas topograficas", como SVG tileable en data URI.
  const BG_PATTERN =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E" +
    "%3Cg fill='none' stroke='%23e5e5e5' stroke-width='1.5'%3E" +
    "%3Ccircle cx='40' cy='40' r='20'/%3E%3Ccircle cx='40' cy='40' r='36'/%3E%3Ccircle cx='40' cy='40' r='52'/%3E" +
    "%3Ccircle cx='180' cy='170' r='18'/%3E%3Ccircle cx='180' cy='170' r='34'/%3E%3Ccircle cx='180' cy='170' r='50'/%3E" +
    "%3C/g%3E%3C/svg%3E";

  function construirHtml(cliente, items, total) {
    const filas = items
      .map(
        (i) => `
          <tr>
            <td>${escapeHtml(i.Entregable || "")}</td>
            <td class="monto">${fmtMoney(i.Monto_USD)}</td>
          </tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Recibo - ${escapeHtml(cliente)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 64px 56px;
    font-family: "Segoe UI", Verdana, Arial, sans-serif;
    color: #1a1a1a;
    background-image: url("${BG_PATTERN}");
    background-repeat: repeat;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
  .brand { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
  .fecha { font-size: 15px; padding-top: 8px; }
  .bill-to { margin-bottom: 24px; }
  .bill-to .label { font-size: 14px; color: #555; }
  .bill-to .cliente { font-size: 20px; font-weight: 700; }
  table.items { width: 100%; border-collapse: collapse; border: 1px solid #1a1a1a; margin-bottom: 24px; }
  table.items thead th {
    text-align: left; font-size: 15px; font-weight: 700;
    padding: 12px 16px; border-bottom: 1px solid #1a1a1a;
  }
  table.items td { padding: 12px 16px; font-size: 15px; }
  table.items td.monto { text-align: right; }
  .total-bar {
    display: flex; justify-content: space-between; align-items: center;
    background: #4a4a4a; color: #fff; font-weight: 700;
    padding: 14px 16px; border-radius: 4px; margin-bottom: 40px;
  }
  .pago-label { font-size: 15px; margin-bottom: 12px; }
  .pago-row { display: flex; gap: 16px; }
  .pago-row .pago-col .k { font-size: 12px; color: #555; margin-bottom: 4px; }
  .pill {
    display: inline-block; padding: 8px 18px; border: 1px solid #1a1a1a;
    border-radius: 20px; font-size: 14px; font-weight: 600;
  }
  @media print {
    body { padding: 40px; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">RealContent</div>
    <div class="fecha">${fechaHoy()}</div>
  </div>

  <div class="bill-to">
    <div class="label">Bill to:</div>
    <div class="cliente">${escapeHtml(cliente)}</div>
  </div>

  <table class="items">
    <thead><tr><th>Items</th><th></th></tr></thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="total-bar">
    <span>Total</span>
    <span>${fmtMoney(total)}</span>
  </div>

  <div class="pago-label">Datos de pago:</div>
  <div class="pago-row">
    <div class="pago-col">
      <div class="k">Metodo</div>
      <span class="pill">Zelle</span>
    </div>
    <div class="pago-col">
      <div class="k">Cuenta</div>
      <span class="pill">jfernando2000@gmail.com</span>
    </div>
  </div>
</body>
</html>`;
  }

  function generar(cliente, items, total) {
    const ventana = window.open("", "_blank");
    if (!ventana) {
      toast("Habilita las ventanas emergentes para generar el recibo", "error");
      return;
    }
    ventana.document.write(construirHtml(cliente, items, total));
    ventana.document.close();
    ventana.onload = () => ventana.print();
  }

  return { generar };
})();
