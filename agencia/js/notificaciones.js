// Notificaciones del navegador (Web Notification API) con fallback a toast()
// interno y anti-spam via localStorage (no se repite el mismo evento).
const Notificaciones = (() => {
  const KEY = "agencia_notificadas_v1";

  function leidas() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function marcar(key) {
    const n = leidas();
    n[key] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(n));
  }

  function notificar(key, titulo, cuerpo) {
    if (leidas()[key]) return;
    marcar(key);

    if (!("Notification" in window)) {
      toast(`${titulo}: ${cuerpo}`, "");
      return;
    }
    if (Notification.permission === "granted") {
      new Notification(titulo, { body: cuerpo });
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") {
          new Notification(titulo, { body: cuerpo });
        } else {
          toast(`${titulo}: ${cuerpo}`, "");
        }
      });
      return;
    }
    toast(`${titulo}: ${cuerpo}`, "");
  }

  return { notificar };
})();
