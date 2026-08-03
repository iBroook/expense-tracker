// Bootstrap de la app: pestañas, carga inicial y refresco periódico.
// Ya NO arranca solo en DOMContentLoaded: la interfaz de FinTrack llama a
// Agencia.init() cuando el usuario ya pasó por el login de Google, porque
// sin token OAuth toda la carga contra Sheets fallaría.
(() => {
  // Evita que una segunda llamada a init() duplique listeners y timers.
  let iniciado = false;

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      });
    });
  }

  function setConnStatus(status, text) {
    // Tolera que el elemento no exista: en FinTrack el marcado de Agencia vive
    // embebido y una llamada fuera del try de init() tumbaria el arranque
    // entero por un indicador de estado.
    const el = document.getElementById("conn-status");
    if (!el) return;
    el.className = `conn-status ${status}`;
    el.textContent = text;
  }

  async function loadAll() {
    await Promise.all([
      refreshMaterial(),
      refreshKanban(),
      refreshCxc(),
      refreshEmpleadosOutput(),
      refreshTarifas(),
      refreshTareaEtapas(),
      refreshPizarras(),
      refreshPizarraElementos(),
    ]);
  }

  function renderAll() {
    Material.render();
    Kanban.render();
    Resumen.render();
    Rendimiento.render();
    Cobrar.render();
    Pizarra.render();
  }

  async function init() {
    if (iniciado) return;
    iniciado = true;

    bindTabs();
    Material.bindEvents();
    Kanban.bindEvents();
    Resumen.bindEvents();
    Rendimiento.bindEvents();
    Cobrar.bindEvents();
    Pizarra.bindEvents();

    try {
      const cfg = await Api.getConfig();
      document.getElementById("agencia-nombre").textContent = cfg.agencia_nombre || "Agencia";
      // Ya no se toca document.title: Agencia esta embebida en FinTrack y
      // sobrescribirlo cambiaria el titulo de la pestaña del navegador de toda
      // la app, no solo de esta seccion.
    } catch (e) {
      // no bloquea el arranque si falta el elemento en el DOM
    }

    setConnStatus("", "conectando...");
    try {
      // Crea las hojas y encabezados que falten antes de leer nada: loadAll()
      // falla si alguna hoja no existe todavia. Es idempotente, asi que en el
      // caso normal son dos lecturas y ninguna escritura.
      if (window.AgenciaBootstrap) {
        setConnStatus("", "preparando hojas...");
        const resumen = await AgenciaBootstrap.asegurarEstructura();
        if (!resumen.sinCambios) {
          console.info("[Agencia] " + AgenciaBootstrap.resumenTexto(resumen));
        }
      }
      setConnStatus("", "conectando...");
      await loadAll();
      renderAll();
      setConnStatus("ok", "conectado a Google Sheets");
    } catch (e) {
      setConnStatus("error", `error: ${e.message}`);
      toast(`No se pudo conectar con Google Sheets: ${e.message}`, "error");
    }

    setInterval(async () => {
      try {
        await loadAll();
        renderAll();
        setConnStatus("ok", "conectado a Google Sheets");
      } catch (e) {
        setConnStatus("error", `error: ${e.message}`);
      }
    }, 60000);
  }

  window.Agencia = { init };
})();
