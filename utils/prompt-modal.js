/* ============================================================
   PromptModal
   ------------------------------------------------------------
   Reemplazo en interfaz del input() que bloqueaba la terminal del
   servidor Python (POST /api/ask-price -> _handle_ask_price).

   API publica
   -----------
   PromptModal.pedirPrecio(cliente, entregable)
       -> Promise<{ monto: Number, guardado: Boolean }>
       Mismo contrato de retorno que el endpoint Python.

   PromptModal.pedirTexto(opciones)
       -> Promise<{ valor: *, marcado: Boolean }>
       Version generica y reutilizable (pedirPrecio la usa por dentro).

   PromptModal.estaAbierto()  -> Boolean
   PromptModal.cerrar()       -> cancela el modal abierto (si lo hay)

   Cancelacion: la promesa se RECHAZA (no resuelve con monto null).
   -------------------------------------------------------------
   Los tres llamadores actuales envuelven askPrice en try/catch:
     - kanban.js  -> catch { toast(...); return; }   aborta el movimiento
     - material.js-> catch { toast(...); return; }   aborta el completado
     - resumen.js -> catch { monto = null; } y luego omite la fila de
                     cuentas_por_cobrar si monto es null
   Si al cancelar resolvieramos con { monto: null }, kanban.js y
   material.js seguirian de largo: crearian filas en cuentas_por_cobrar
   con Monto_USD vacio y material.js ademas borraria la fila de
   material_disponible. Rechazar reproduce exactamente el "abortar sin
   efectos secundarios" que esos catch ya implementan, y resumen.js
   sigue funcionando igual (registra el output, omite el cobro).

   El error de cancelacion trae banderas para distinguirlo de un fallo
   real:  err.cancelado === true  y  err.codigo === 'CANCELADO'.

   IMPORTANTE: este modulo SOLO pide el dato. NO escribe en la hoja
   'tarifas'. Devuelve el flag `guardado` y el llamador decide.

   Estilo: JS plano, sin modulos ES, sin dependencias. Cargar con
   <script src="utils/prompt-modal.js"></script>. El CSS
   (prompt-modal.css) se inyecta solo si no esta ya en el documento.
   ============================================================ */

var PromptModal = (function () {

  var _scriptSrc = (document.currentScript && document.currentScript.src) || '';

  var PromptModal = {

    // Instancia abierta actualmente (o null).
    _abierto: null,

    // Cola: garantiza un solo modal a la vez aunque se pidan varios.
    _cadena: Promise.resolve(),

    // ---- API publica -------------------------------------------------

    /**
     * Pide el monto en USD de un entregable sin precio en 'tarifas'.
     * @param {String} cliente
     * @param {String} entregable
     * @returns {Promise<{monto:Number, guardado:Boolean}>}
     *          Rechaza con Error (err.cancelado === true) si se cancela.
     */
    pedirPrecio: function (cliente, entregable) {
      var self = this;
      return this.pedirTexto({
        titulo: 'Precio faltante',
        contexto: [
          { etiqueta: 'Cliente', valor: cliente || '-' },
          { etiqueta: 'Entregable', valor: entregable || '-' }
        ],
        etiqueta: 'Monto de esta entrega',
        prefijo: '$',
        sufijo: 'USD',
        placeholder: '0.00',
        ayuda: 'Puedes usar coma o punto decimal (ej. 20 o 20,5).',
        checkbox: {
          etiqueta: 'Guardar este precio en tarifas para el futuro',
          marcado: true
        },
        textoConfirmar: 'Confirmar precio',
        textoCancelar: 'Cancelar',
        mensajeCancelacion: 'ingreso de precio cancelado',
        validar: function (crudo) {
          return self._validarMonto(crudo);
        }
      }).then(function (res) {
        return { monto: res.valor, guardado: res.marcado };
      });
    },

    /**
     * Modal generico de un solo campo de texto + checkbox opcional.
     * @param {Object} opciones
     *   titulo             {String}
     *   contexto           {Array<{etiqueta,valor}>}  filas informativas
     *   etiqueta           {String}  label del input
     *   prefijo / sufijo   {String}  adornos dentro del campo
     *   placeholder        {String}
     *   ayuda              {String}  texto de ayuda bajo el campo
     *   valorInicial       {String}
     *   checkbox           {{etiqueta:String, marcado:Boolean}|null}
     *   textoConfirmar     {String}
     *   textoCancelar      {String}
     *   mensajeCancelacion {String}  mensaje del Error al cancelar
     *   validar            {Function(String) -> {ok:Boolean, valor:*, error:String}}
     * @returns {Promise<{valor:*, marcado:Boolean}>}
     */
    pedirTexto: function (opciones) {
      var self = this;
      var reanudar = function () { return self._mostrar(opciones || {}); };
      var siguiente = this._cadena.then(reanudar, reanudar);
      this._cadena = siguiente.then(function () {}, function () {});
      return siguiente;
    },

    estaAbierto: function () {
      return !!this._abierto;
    },

    /** Cierra y cancela el modal abierto, si lo hay. */
    cerrar: function () {
      if (this._abierto) this._abierto.cancelar();
    },

    // ---- Validacion --------------------------------------------------

    /**
     * Normaliza y valida un monto. Acepta coma o punto decimal, igual
     * que el .replace(",", ".") del handler Python. Tolera espacios,
     * simbolo $ y el sufijo USD.
     * @returns {{ok:Boolean, valor:Number, error:String}}
     */
    _validarMonto: function (crudo) {
      var texto = String(crudo == null ? '' : crudo).trim();
      if (!texto) {
        return { ok: false, error: 'Ingresa un monto en USD.' };
      }
      var limpio = texto
        .replace(/\s/g, '')
        .replace(/\$/g, '')
        .replace(/usd$/i, '')
        .replace(',', '.');
      if (!/^(\d+(\.\d*)?|\.\d+)$/.test(limpio)) {
        return { ok: false, error: 'Valor invalido, ingresa un numero (ej. 20 o 20,5).' };
      }
      var numero = parseFloat(limpio);
      if (isNaN(numero) || !isFinite(numero)) {
        return { ok: false, error: 'Valor invalido, ingresa un numero (ej. 20 o 20,5).' };
      }
      if (numero <= 0) {
        return { ok: false, error: 'El monto debe ser mayor que 0.' };
      }
      return { ok: true, valor: Math.round(numero * 100) / 100 };
    },

    // ---- Construccion y ciclo de vida --------------------------------

    _mostrar: function (op) {
      var self = this;

      return new Promise(function (resolve, reject) {
        self._inyectarCss();

        var elementoPrevio = document.activeElement;
        var finalizado = false;

        var overlay = document.createElement('div');
        overlay.className = 'pm-overlay';
        overlay.setAttribute('data-prompt-modal', '');

        var idTitulo = 'pm-titulo-' + Date.now();
        var idError = 'pm-error-' + Date.now();
        var idAyuda = 'pm-ayuda-' + Date.now();

        var esc = self._escapar;
        var html = '';
        html += '<div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="' + idTitulo + '">';
        html += '<div class="pm-header">';
        html += '<h2 class="pm-title" id="' + idTitulo + '">' + esc(op.titulo || 'Dato requerido') + '</h2>';
        html += '<button type="button" class="pm-close" data-pm="cancelar" aria-label="Cerrar">&#10005;</button>';
        html += '</div>';

        var contexto = op.contexto || [];
        if (contexto.length) {
          html += '<div class="pm-contexto">';
          for (var i = 0; i < contexto.length; i++) {
            html += '<div class="pm-contexto-fila">';
            html += '<span class="pm-contexto-etiqueta">' + esc(contexto[i].etiqueta) + '</span>';
            html += '<span class="pm-contexto-valor">' + esc(contexto[i].valor) + '</span>';
            html += '</div>';
          }
          html += '</div>';
        }

        html += '<div class="pm-campo">';
        if (op.etiqueta) {
          html += '<label class="pm-label" for="pm-input">' + esc(op.etiqueta) + '</label>';
        }
        html += '<div class="pm-input-wrap" data-pm="wrap">';
        if (op.prefijo) html += '<span class="pm-prefijo">' + esc(op.prefijo) + '</span>';
        html += '<input type="text" id="pm-input" class="pm-input" data-pm="input"' +
                ' inputmode="decimal" autocomplete="off" spellcheck="false"' +
                ' placeholder="' + esc(op.placeholder || '') + '"' +
                ' value="' + esc(op.valorInicial || '') + '"' +
                (op.ayuda ? ' aria-describedby="' + idAyuda + '"' : '') + '>';
        if (op.sufijo) html += '<span class="pm-sufijo">' + esc(op.sufijo) + '</span>';
        html += '</div>';
        if (op.ayuda) {
          html += '<div class="pm-hint" id="' + idAyuda + '">' + esc(op.ayuda) + '</div>';
        }
        html += '<div class="pm-error" id="' + idError + '" data-pm="error" role="alert" aria-live="polite"></div>';
        html += '</div>';

        if (op.checkbox) {
          html += '<label class="pm-check">';
          html += '<input type="checkbox" data-pm="check"' + (op.checkbox.marcado ? ' checked' : '') + '>';
          html += '<span>' + esc(op.checkbox.etiqueta) + '</span>';
          html += '</label>';
        }

        html += '<div class="pm-acciones">';
        html += '<button type="button" class="pm-btn pm-btn-secundario" data-pm="cancelar">' +
                esc(op.textoCancelar || 'Cancelar') + '</button>';
        html += '<button type="button" class="pm-btn pm-btn-primario" data-pm="confirmar">' +
                esc(op.textoConfirmar || 'Confirmar') + '</button>';
        html += '</div>';
        html += '</div>';

        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        var caja = overlay.querySelector('.pm-modal');
        var input = overlay.querySelector('[data-pm="input"]');
        var wrap = overlay.querySelector('[data-pm="wrap"]');
        var cajaError = overlay.querySelector('[data-pm="error"]');
        var check = overlay.querySelector('[data-pm="check"]');

        function mostrarError(mensaje) {
          cajaError.textContent = mensaje;
          cajaError.classList.add('pm-visible');
          wrap.classList.add('pm-invalido');
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', idError);
        }

        function limpiarError() {
          cajaError.textContent = '';
          cajaError.classList.remove('pm-visible');
          wrap.classList.remove('pm-invalido');
          input.removeAttribute('aria-invalid');
          if (op.ayuda) input.setAttribute('aria-describedby', idAyuda);
          else input.removeAttribute('aria-describedby');
        }

        function destruir() {
          document.removeEventListener('keydown', alTeclear, true);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          self._abierto = null;
          if (elementoPrevio && typeof elementoPrevio.focus === 'function') {
            try { elementoPrevio.focus(); } catch (e) {}
          }
        }

        function confirmar() {
          if (finalizado) return;
          var crudo = input.value;
          var validar = op.validar || function (v) {
            var t = String(v == null ? '' : v).trim();
            return t ? { ok: true, valor: t } : { ok: false, error: 'Este campo es obligatorio.' };
          };
          var resultado = validar(crudo);
          if (!resultado || !resultado.ok) {
            mostrarError((resultado && resultado.error) || 'Valor invalido.');
            input.focus();
            input.select();
            return;
          }
          finalizado = true;
          destruir();
          resolve({ valor: resultado.valor, marcado: !!(check && check.checked) });
        }

        function cancelar() {
          if (finalizado) return;
          finalizado = true;
          destruir();
          var err = new Error(op.mensajeCancelacion || 'operacion cancelada por el usuario');
          err.cancelado = true;
          err.codigo = 'CANCELADO';
          reject(err);
        }

        // Foco atrapado dentro del modal + Escape.
        function focusables() {
          var nodos = caja.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          var lista = [];
          for (var i = 0; i < nodos.length; i++) {
            if (!nodos[i].disabled && nodos[i].getClientRects().length) lista.push(nodos[i]);
          }
          return lista;
        }

        function alTeclear(ev) {
          if (ev.key === 'Escape' || ev.key === 'Esc') {
            ev.preventDefault();
            ev.stopPropagation();
            cancelar();
            return;
          }
          if (ev.key !== 'Tab') return;
          var lista = focusables();
          if (!lista.length) return;
          var primero = lista[0];
          var ultimo = lista[lista.length - 1];
          var activo = document.activeElement;
          if (!caja.contains(activo)) {
            ev.preventDefault();
            primero.focus();
            return;
          }
          if (ev.shiftKey && activo === primero) {
            ev.preventDefault();
            ultimo.focus();
          } else if (!ev.shiftKey && activo === ultimo) {
            ev.preventDefault();
            primero.focus();
          }
        }

        overlay.addEventListener('click', function (ev) {
          var accion = ev.target.getAttribute && ev.target.getAttribute('data-pm');
          if (accion === 'cancelar') return cancelar();
          if (accion === 'confirmar') return confirmar();
          // Clic fuera de la caja (solo si el gesto empezo en el overlay,
          // para no cerrar al soltar una seleccion de texto).
          if (ev.target === overlay && overlay._pmOrigen === overlay) cancelar();
        });

        overlay.addEventListener('mousedown', function (ev) {
          overlay._pmOrigen = ev.target;
        });

        input.addEventListener('input', limpiarError);
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            confirmar();
          }
        });

        document.addEventListener('keydown', alTeclear, true);

        self._abierto = { cancelar: cancelar, confirmar: confirmar, overlay: overlay };

        // Foco inicial en el input.
        input.focus();
        input.select();
      });
    },

    // ---- Utilidades --------------------------------------------------

    /** Carga prompt-modal.css una sola vez si no esta ya en el documento. */
    _inyectarCss: function () {
      if (document.querySelector('link[data-prompt-modal-css]')) return;
      var yaCargado = document.querySelector('link[href$="prompt-modal.css"]');
      if (yaCargado) return;
      var href = 'prompt-modal.css';
      if (_scriptSrc) {
        href = _scriptSrc.split('?')[0].replace(/utils\/prompt-modal\.js$/, 'prompt-modal.css');
        if (href === _scriptSrc.split('?')[0]) href = 'prompt-modal.css';
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-prompt-modal-css', '');
      document.head.appendChild(link);
    },

    _escapar: function (valor) {
      return String(valor == null ? '' : valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };

  return PromptModal;
})();

window.PromptModal = PromptModal;
