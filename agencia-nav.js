// ============================================================
// AGENCIA-NAV.JS — pegamento de navegación entre FinTrack y Agencia
// ------------------------------------------------------------
// Este archivo NO modifica script.js. Envuelve window.switchTab:
// guarda la referencia original y reasigna la global. Como en
// script.js switchTab es una declaración de función en ámbito
// global, el binding ES la propiedad window.switchTab, así que
// reasignarla afecta también a las llamadas internas de script.js
// y a los onclick inline del sidebar.
//
// Debe cargarse DESPUÉS de script.js.
// ============================================================

(function () {
  'use strict';

  // Pestañas que pertenecen a Agencia. El resto se delega a FinTrack.
  var AGENCIA_TABS = ['material', 'kanban', 'resumen', 'rendimiento', 'cxc', 'pizarra'];

  var arrancada = false;   // Agencia.init() ya se ejecutó
  var arrancando = false;  // arranque en curso (evita dobles llamadas)

  function esTabAgencia(tab) {
    return AGENCIA_TABS.indexOf(tab) !== -1;
  }

  function raiz() {
    return document.getElementById('agencia-root');
  }

  function marcarNavActivo(tab) {
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.tab === tab);
    }
  }

  // ------------------------------------------------------------
  // Arranque de Agencia
  // ------------------------------------------------------------

  // El contrato con agencia/js/app.js es window.Agencia.init(), que es
  // idempotente y devuelve una promesa. Se prueban además dos nombres
  // alternativos por si el bootstrap se renombra.
  function resolverInit() {
    if (window.Agencia && typeof window.Agencia.init === 'function') return window.Agencia.init;
    if (window.AgenciaApp && typeof window.AgenciaApp.init === 'function') return window.AgenciaApp.init;
    if (typeof window.initAgencia === 'function') return window.initAgencia;
    return null;
  }

  function haySesion() {
    try {
      return !!(window.GoogleSheets && GoogleSheets.isAuthenticated());
    } catch (err) {
      return false;
    }
  }

  // Arranca Agencia una sola vez y solo con sesión OAuth activa.
  // Nunca se llama desde DOMContentLoaded: sin token, todas las
  // llamadas a Sheets fallarían y se llenaría la pantalla de toasts.
  function arrancarAgencia() {
    if (arrancada || arrancando) return;
    if (!raiz()) return;
    if (!haySesion()) return;

    var init = resolverInit();
    if (!init) {
      // Si agencia/js/app.js todavía se auto-arranca en su propio
      // DOMContentLoaded, esto no es un problema: solo significa que
      // no hay nada que llamar desde aquí.
      console.warn('[agencia-nav] No se encontró Agencia.init(); se asume que agencia/js/app.js arranca solo.');
      arrancada = true;
      return;
    }

    arrancando = true;
    try {
      Promise.resolve(init()).then(function () {
        arrancada = true;
        arrancando = false;
      }).catch(function (err) {
        arrancando = false;
        console.error('[agencia-nav] Falló el arranque de Agencia:', err);
      });
    } catch (err) {
      arrancando = false;
      console.error('[agencia-nav] Falló el arranque de Agencia:', err);
    }
  }

  // ------------------------------------------------------------
  // Mostrar / ocultar
  // ------------------------------------------------------------

  function mostrarAgencia(tab) {
    var root = raiz();
    if (!root) return false;

    var contenidoFinanzas = document.getElementById('tab-content');
    if (contenidoFinanzas) contenidoFinanzas.style.display = 'none';

    root.style.display = 'block';

    var paneles = root.querySelectorAll('.tab-panel');
    for (var i = 0; i < paneles.length; i++) {
      paneles[i].classList.toggle('active', paneles[i].id === 'tab-' + tab);
    }

    marcarNavActivo(tab);

    // Deja constancia de la pestaña actual para que FinTrack no
    // vuelva a pintar su contenido: renderTab() ignora los valores
    // que no son suyos. App se declara con const en script.js, así
    // que no es propiedad de window: hay que leerlo por el ámbito
    // global léxico.
    try {
      if (typeof App !== 'undefined' && App) App.currentTab = tab;
    } catch (err) { /* App no disponible: no es crítico */ }

    arrancarAgencia();
    return true;
  }

  function ocultarAgencia() {
    var root = raiz();
    if (root) root.style.display = 'none';
    var contenidoFinanzas = document.getElementById('tab-content');
    if (contenidoFinanzas) contenidoFinanzas.style.display = '';
  }

  // ------------------------------------------------------------
  // Intercepción de switchTab
  // ------------------------------------------------------------

  var switchTabOriginal = window.switchTab;

  if (typeof switchTabOriginal !== 'function') {
    console.error('[agencia-nav] switchTab no está definido: ¿se cargó script.js antes que agencia-nav.js?');
  } else {
    window.switchTab = function (tab) {
      if (esTabAgencia(tab)) {
        try {
          if (mostrarAgencia(tab)) {
            if (typeof window.closeSidebar === 'function') window.closeSidebar();
            return;
          }
        } catch (err) {
          console.error('[agencia-nav] Error mostrando la pestaña de Agencia:', err);
        }
        // Si Agencia no está disponible, no se deja al usuario en
        // una pantalla vacía: se cae al dashboard de finanzas.
        ocultarAgencia();
        return switchTabOriginal.call(this, 'dashboard');
      }

      ocultarAgencia();
      return switchTabOriginal.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------
  // Enganche con el ciclo de vida de FinTrack
  // ------------------------------------------------------------

  // showApp() es lo que FinTrack llama cuando ya hay sesión y hoja
  // elegida (startApp / createNewSheet). Es el momento correcto para
  // arrancar Agencia: hay token OAuth y el DOM ya está montado.
  var showAppOriginal = window.showApp;
  if (typeof showAppOriginal === 'function') {
    window.showApp = function () {
      var r = showAppOriginal.apply(this, arguments);
      try {
        arrancarAgencia();
      } catch (err) {
        console.error('[agencia-nav] Error arrancando Agencia desde showApp:', err);
      }
      return r;
    };
  }

  // Caso borde: el usuario recarga con sesión ya activa y showApp se
  // ejecutó antes de que este archivo envolviera nada.
  document.addEventListener('DOMContentLoaded', function () {
    var app = document.getElementById('app');
    if (app && app.style.display === 'block') arrancarAgencia();
  });
})();
