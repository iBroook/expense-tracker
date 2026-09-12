// Pestaña: Pizarra (whiteboard tipo Miro, con múltiples instancias)
const Pizarra = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DEFAULTS = {
    texto: { ancho: 200, alto: 120 },
    texto_libre: { ancho: 220, alto: 60 },
    forma: { ancho: 140, alto: 90 },
    imagen: { ancho: 240, alto: 180 },
    pdf: { ancho: 160, alto: 190 },
    audio: { ancho: 240, alto: 70 },
    enlace: { ancho: 320, alto: 400 },
  };
  // Tipos de elemento que se dibujan como trazo/linea en el SVG (a partir de
  // un path guardado en Contenido), en vez de como tarjeta arrastrable.
  const TIPOS_TRAZO = ["trazo", "linea", "flecha"];
  // Tipos cuyo Contenido es una referencia a un archivo de Drive.
  const TIPOS_ARCHIVO = ["imagen", "pdf", "audio", "video"];
  // Tipos cuyo contenido es un <textarea> editable.
  const TIPOS_TEXTO = ["texto", "texto_libre", "forma"];
  // Formas admitidas en la columna Forma. La primera es el valor por defecto
  // y el que asumen las filas viejas, que no traen la columna.
  const FORMAS = ["rect", "redondeado", "elipse", "rombo", "triangulo"];
  // Dentro de estos elementos el mousedown no arrastra: son controles que
  // necesitan el gesto para si mismos.
  const SEL_NO_ARRASTRABLE =
    ".pizarra-elemento-borrar, .pizarra-resize-handle, .pizarra-elemento-texto, audio, video, iframe, a, button";
  // Umbral en px antes de considerar que un gesto es arrastre y no un clic.
  const UMBRAL_ARRASTRE = 3;
  // GIF transparente de 1x1: placeholder mientras baja el archivo de Drive.
  const PLACEHOLDER_IMAGEN =
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const MAX_HISTORIAL = 50;
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 2;
  const ZOOM_PASO = 0.1;

  let pizarraActualId = null;
  let herramienta = "mover";
  let zoom = 1;
  let undoStack = [];
  let redoStack = [];
  // ID de la forma origen ya elegida mientras se arma una conexion con la
  // herramienta "conectar" (null = todavia no se eligio ninguna).
  let conexionOrigenId = null;
  // true mientras hay un arrastre/resize/trazo en curso: evita que el poll de
  // 60s (renderAll -> Pizarra.render) reconstruya el DOM a mitad de un gesto.
  let interactuando = false;

  // ---- helpers de datos ----
  function elementosDePizarra(id = pizarraActualId) {
    return State.pizarraElementos.filter((e) => String(e.Pizarra_ID) === String(id));
  }

  function siguienteZIndex() {
    return elementosDePizarra().reduce((max, e) => Math.max(max, Number(e.Z_index) || 0), 0) + 1;
  }

  function siguienteOffset() {
    return (elementosDePizarra().length % 10) * 28;
  }

  function limpiarHistorial() {
    undoStack = [];
    redoStack = [];
  }

  function actualizarLocal(id, cambios) {
    const el = State.pizarraElementos.find((e) => String(e.ID) === String(id));
    if (el) Object.assign(el, cambios);
  }

  function elementoPorId(id) {
    return State.pizarraElementos.find((e) => String(e.ID) === String(id));
  }

  // Los elementos viejos guardan rutas "uploads/pizarras/..." que ya no
  // existen en ningún lado; idDeRef() devuelve null para ellas.
  function esRefUtilizable(el) {
    return !!DriveFiles.idDeRef(el.Contenido);
  }

  function avisoArchivo(texto) {
    const div = document.createElement("div");
    div.className = "pizarra-archivo-nombre";
    div.textContent = texto;
    return div;
  }

  // Manda a la papelera de Drive el archivo de un elemento imagen/pdf/audio/
  // video para no dejar huerfanos. A la papelera y no borrado: asi el undo
  // puede traerlo de vuelta junto con la fila (restaurarArchivoDeElemento).
  // Nunca aborta el borrado del elemento: si falla, solo avisa.
  async function borrarArchivoDeElemento(el) {
    if (!TIPOS_ARCHIVO.includes(el.Tipo)) return;
    if (!esRefUtilizable(el)) return;
    try {
      await DriveFiles.moverAPapelera(el.Contenido);
    } catch (e) {
      toast(`No se pudo mover el archivo a la papelera: ${e.message}`, "error");
    }
  }

  async function restaurarArchivoDeElemento(el) {
    if (!TIPOS_ARCHIVO.includes(el.Tipo)) return;
    if (!esRefUtilizable(el)) return;
    try {
      const ok = await DriveFiles.restaurarDePapelera(el.Contenido);
      if (!ok) toast("El archivo ya no está en la papelera de Drive; el elemento vuelve sin él", "error");
    } catch (e) {
      toast(`No se pudo restaurar el archivo de la papelera: ${e.message}`, "error");
    }
  }

  // Ejecuta una escritura a Sheets. Si falla: avisa, deshace el cambio local
  // (si se paso `revertir`) y repinta, en vez de dejar una promesa rechazada
  // sin capturar. Antes, un fallo de red al arrastrar dejaba el elemento
  // movido en pantalla y en el siguiente poll volvia solo a su sitio sin
  // ninguna explicacion. Devuelve null al fallar; nunca un valor falsy al
  // tener exito (deleteRow resuelve undefined y se normaliza a true).
  async function persistir(op, revertir) {
    try {
      const valor = await op();
      return valor === undefined ? true : valor;
    } catch (e) {
      if (revertir) revertir();
      toast(`No se guardó en Google Sheets: ${e.message}`, "error");
      renderElementos();
      return null;
    }
  }

  // ---- geometria para conexiones entre formas ----
  function rectDe(el) {
    return { x: Number(el.X) || 0, y: Number(el.Y) || 0, w: Number(el.Ancho) || 0, h: Number(el.Alto) || 0 };
  }

  function centroDe(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }

  // Punto donde el segmento entre el centro de `rect` y el punto `hacia`
  // cruza el borde de `rect` (para que la linea de conexion nazca/termine
  // en el borde de la forma, no en su centro).
  function puntoEnBorde(rect, hacia) {
    const c = centroDe(rect);
    const dx = hacia.x - c.x;
    const dy = hacia.y - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = rect.w / 2 || 1;
    const hh = rect.h / 2 || 1;
    const escala = Math.min(
      dx !== 0 ? Math.abs(hw / dx) : Infinity,
      dy !== 0 ? Math.abs(hh / dy) : Infinity
    );
    return { x: c.x + dx * escala, y: c.y + dy * escala };
  }

  // ---- selector / CRUD de instancias de pizarra ----
  function poblarSelector() {
    const sel = document.getElementById("pizarra-selector");
    const actual = sel.value || pizarraActualId;
    sel.innerHTML = "";
    State.pizarras.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.ID;
      opt.textContent = p.Nombre || `Pizarra ${p.ID}`;
      sel.appendChild(opt);
    });
    if (State.pizarras.some((p) => String(p.ID) === String(actual))) {
      sel.value = actual;
      pizarraActualId = String(actual);
    } else if (State.pizarras.length > 0) {
      pizarraActualId = String(State.pizarras[0].ID);
      sel.value = pizarraActualId;
    } else {
      pizarraActualId = null;
    }
  }

  async function crearPizarra() {
    const nombre = prompt("Nombre de la nueva pizarra:");
    if (!nombre || !nombre.trim()) return;
    const creada = await persistir(() => Api.createRow("pizarras", {
      Nombre: nombre.trim(),
      Fecha_creacion: todayISO(),
    }));
    if (!creada) return;
    await refreshPizarras();
    pizarraActualId = String(creada.ID);
    limpiarHistorial();
    render();
    toast(`Pizarra "${nombre.trim()}" creada`, "success");
  }

  async function renombrarPizarra() {
    if (!pizarraActualId) return;
    const actual = State.pizarras.find((p) => String(p.ID) === String(pizarraActualId));
    const nombre = prompt("Nuevo nombre:", actual ? actual.Nombre : "");
    if (!nombre || !nombre.trim()) return;
    if (!(await persistir(() => Api.updateRow("pizarras", pizarraActualId, { Nombre: nombre.trim() })))) return;
    await refreshPizarras();
    render();
  }

  async function borrarPizarraActual() {
    if (!pizarraActualId) return;
    const actual = State.pizarras.find((p) => String(p.ID) === String(pizarraActualId));
    if (!confirm(`Borrar la pizarra "${actual ? actual.Nombre : ""}" y todo su contenido? Esta acción no se puede deshacer.`)) return;
    // Si un elemento no se puede borrar se sigue con los demas; la pizarra
    // solo se elimina si no quedo ninguno, para no dejar filas huerfanas.
    let fallidos = 0;
    for (const el of elementosDePizarra()) {
      if (!(await persistir(() => Api.deleteRow("pizarra_elementos", el.ID)))) { fallidos++; continue; }
      await borrarArchivoDeElemento(el);
    }
    if (fallidos) {
      toast(`${fallidos} elemento(s) no se pudieron borrar; la pizarra se conserva`, "error");
      await refreshPizarraElementos();
      render();
      return;
    }
    if (!(await persistir(() => Api.deleteRow("pizarras", pizarraActualId)))) return;
    pizarraActualId = null;
    limpiarHistorial();
    await Promise.all([refreshPizarras(), refreshPizarraElementos()]);
    render();
    toast("Pizarra borrada", "success");
  }

  // ---- render ----
  function render() {
    poblarSelector();
    const vacio = State.pizarras.length === 0;
    document.getElementById("pizarra-vacia").classList.toggle("hidden", !vacio);
    document.getElementById("pizarra-canvas-wrap").classList.toggle("hidden", vacio);
    if (vacio) return;

    if (interactuando) return;
    const activo = document.activeElement;
    if (activo && activo.classList && activo.classList.contains("pizarra-elemento-texto")) return;
    // Una tarjeta en modo edicion tiene el texto abierto o un embed en uso: el
    // foco de un iframe no se ve desde aca, asi que reconstruir el DOM cortaria
    // la reproduccion a mitad. Se espera al proximo ciclo.
    if (document.querySelector("#tab-pizarra .pizarra-elemento.editando")) return;

    renderElementos();
  }

  function renderElementos() {
    const canvas = document.getElementById("pizarra-canvas");
    const svg = document.getElementById("pizarra-svg");

    canvas.querySelectorAll(".pizarra-elemento").forEach((n) => n.remove());
    svg.innerHTML = "";
    const defs = asegurarDefs(svg);

    const elementos = elementosDePizarra();
    // 1) tarjetas primero (formas/texto/imagen/pdf/audio), para que sus
    // posiciones esten resueltas cuando calculemos las conexiones.
    elementos.forEach((el) => {
      if (TIPOS_TRAZO.includes(el.Tipo) || el.Tipo === "conexion") return;
      canvas.appendChild(crearTarjeta(el));
    });
    // 2) trazos, lineas y flechas sueltas (path fijo guardado en Contenido)
    elementos.forEach((el) => {
      if (TIPOS_TRAZO.includes(el.Tipo)) svg.appendChild(crearPathSvg(el, defs));
    });
    // 3) conexiones entre formas (geometria calculada a partir de las
    // posiciones actuales de origen/destino, no de un path fijo)
    elementos.forEach((el) => {
      if (el.Tipo !== "conexion") return;
      const linea = crearConexionSvg(el, defs);
      if (linea) svg.appendChild(linea);
    });
  }

  function asegurarDefs(svg) {
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      svg.appendChild(defs);
    }
    return defs;
  }

  function crearMarkerFlecha(defs, id, color) {
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("markerWidth", "10");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const punta = document.createElementNS(SVG_NS, "path");
    punta.setAttribute("d", "M0,0 L0,6 L9,3 z");
    punta.setAttribute("fill", color || "#e8b33d");
    marker.appendChild(punta);
    defs.appendChild(marker);
  }

  function crearPathSvg(el, defs) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", el.Contenido || "");
    path.setAttribute("stroke", el.Color || "#e8b33d");
    path.setAttribute("stroke-width", el.Grosor || 3);
    path.setAttribute("class", "pizarra-trazo");
    path.dataset.id = el.ID;
    if (el.Tipo === "flecha") {
      const markerId = `pizarra-marker-${el.ID}`;
      crearMarkerFlecha(defs, markerId, el.Color);
      path.setAttribute("marker-end", `url(#${markerId})`);
    }
    path.addEventListener("click", (e) => {
      if (herramienta !== "borrador") return;
      e.stopPropagation();
      borrarElemento(el, true);
    });
    path.addEventListener("mouseenter", () => {
      if (herramienta === "borrador") path.classList.add("trazo-resaltado");
    });
    path.addEventListener("mouseleave", () => path.classList.remove("trazo-resaltado"));
    return path;
  }

  // Linea entre dos formas (Origen_ID/Destino_ID). Se recalcula en cada
  // render a partir de las posiciones actuales de esas formas, asi que se
  // mantiene "enganchada" cuando alguna se mueve o cambia de tamaño (ver
  // tambien actualizarConexionesEnVivo, que la reubica durante el arrastre
  // sin esperar al proximo render).
  function crearConexionSvg(el, defs) {
    const origen = elementoPorId(el.Origen_ID);
    const destino = elementoPorId(el.Destino_ID);
    if (!origen || !destino) return null;
    const rectO = rectDe(origen);
    const rectD = rectDe(destino);
    const p1 = puntoEnBorde(rectO, centroDe(rectD));
    const p2 = puntoEnBorde(rectD, centroDe(rectO));

    const linea = document.createElementNS(SVG_NS, "line");
    linea.setAttribute("x1", p1.x);
    linea.setAttribute("y1", p1.y);
    linea.setAttribute("x2", p2.x);
    linea.setAttribute("y2", p2.y);
    linea.setAttribute("stroke", el.Color || "#e8b33d");
    linea.setAttribute("stroke-width", el.Grosor || 2);
    linea.setAttribute("class", "pizarra-trazo pizarra-conexion");
    linea.dataset.id = el.ID;

    const markerId = `pizarra-marker-${el.ID}`;
    crearMarkerFlecha(defs, markerId, el.Color);
    linea.setAttribute("marker-end", `url(#${markerId})`);

    linea.addEventListener("click", (e) => {
      if (herramienta !== "borrador") return;
      e.stopPropagation();
      borrarElemento(el, true);
    });
    linea.addEventListener("mouseenter", () => {
      if (herramienta === "borrador") linea.classList.add("trazo-resaltado");
    });
    linea.addEventListener("mouseleave", () => linea.classList.remove("trazo-resaltado"));
    return linea;
  }

  // Reubica en vivo (sin esperar a renderElementos) las conexiones que
  // tocan la forma `elId`, mientras se la arrastra o redimensiona.
  function actualizarConexionesEnVivo(elId, rectVivo) {
    const conexiones = elementosDePizarra().filter(
      (e) => e.Tipo === "conexion" && (String(e.Origen_ID) === String(elId) || String(e.Destino_ID) === String(elId))
    );
    conexiones.forEach((con) => {
      const esOrigen = String(con.Origen_ID) === String(elId);
      const otro = elementoPorId(esOrigen ? con.Destino_ID : con.Origen_ID);
      if (!otro) return;
      const rectOtro = rectDe(otro);
      const rectO = esOrigen ? rectVivo : rectOtro;
      const rectD = esOrigen ? rectOtro : rectVivo;
      const p1 = puntoEnBorde(rectO, centroDe(rectD));
      const p2 = puntoEnBorde(rectD, centroDe(rectO));
      const linea = document.querySelector(`.pizarra-conexion[data-id="${con.ID}"]`);
      if (!linea) return;
      linea.setAttribute("x1", p1.x);
      linea.setAttribute("y1", p1.y);
      linea.setAttribute("x2", p2.x);
      linea.setAttribute("y2", p2.y);
    });
  }

  // ---- enlaces externos ----
  // Verificado en 2026-09 contra los endpoints reales: youtube-nocookie,
  // tiktok/player/v1 e instagram/<code>/embed se incrustan sin token ni API
  // key. X/Twitter, Facebook, LinkedIn y Pinterest mandan cabeceras que
  // impiden el framing, asi que esos caen en la tarjeta de enlace simple.
  const RE_YOUTUBE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
  const RE_TIKTOK = /tiktok\.com\/@[\w.\-]+\/(?:video|photo)\/(\d{17,21})/;
  const RE_TIKTOK_V = /tiktok\.com\/v\/(\d{17,21})/;
  const RE_TIKTOK_CORTO = /(?:vm|vt)\.tiktok\.com\/\w+|tiktok\.com\/t\/\w+/;
  const RE_INSTAGRAM = /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/;
  const RE_IMAGEN_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|jxl)(?:[?#]|$)/i;
  const RE_VIDEO_EXT = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i;
  // CDNs que sirven imagenes sin extension en la ruta.
  const RE_CDN_IMAGEN = /^(?:i\.imgur\.com|pbs\.twimg\.com|images\.unsplash\.com|lh3\.googleusercontent\.com|[\w.-]*\.cdninstagram\.com)$/i;

  function normalizarUrl(crudo) {
    const texto = String(crudo == null ? "" : crudo).trim();
    // Con espacios no es una URL: el navegador los percent-codifica y
    // "texto que no es url" pasaria como https://texto%20que%20no%20es%20url/.
    if (!texto || /\s/.test(texto)) return null;
    try {
      const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
      // Un host sin punto tampoco es un dominio ("hola" -> https://hola/).
      if (!url.hostname.includes(".")) return null;
      return url;
    } catch (e) {
      return null;
    }
  }

  function dominioDe(href) {
    const url = normalizarUrl(href);
    return url ? url.hostname.replace(/^www\./, "") : "";
  }

  // Un link de Google Imagenes no es la imagen: /imgres es una pagina HTML
  // que ademas bloquea el framing. La URL real viaja en el parametro imgurl.
  // La variante nueva (imgres?q=...) no la trae y no hay forma de deducirla:
  // en ese caso se devuelve tal cual y termina como tarjeta de enlace.
  function desenvolverGoogleImagenes(url) {
    if (!/(^|\.)google\.[a-z.]+$/i.test(url.hostname)) return url;
    if (!url.pathname.startsWith("/imgres")) return url;
    const real = url.searchParams.get("imgurl") || url.searchParams.get("url");
    return (real && normalizarUrl(real)) || url;
  }

  function analizarEnlace(crudo) {
    let url = normalizarUrl(crudo);
    if (!url) return { proveedor: "invalido" };
    url = desenvolverGoogleImagenes(url);
    const href = url.href;

    const yt = href.match(RE_YOUTUBE);
    if (yt) {
      return { proveedor: "youtube", href, alto: 220,
        embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
    }
    const tt = href.match(RE_TIKTOK) || href.match(RE_TIKTOK_V);
    if (tt) {
      return { proveedor: "tiktok", href, alto: 560,
        embed: `https://www.tiktok.com/player/v1/${tt[1]}?music_info=1&description=1` };
    }
    const ig = href.match(RE_INSTAGRAM);
    if (ig) {
      return { proveedor: "instagram", href, alto: 640,
        embed: `https://www.instagram.com/p/${ig[1]}/embed/captioned` };
    }
    if (RE_IMAGEN_EXT.test(url.pathname) || RE_CDN_IMAGEN.test(url.hostname)) {
      return { proveedor: "imagen", href, alto: 260 };
    }
    if (RE_VIDEO_EXT.test(url.pathname)) return { proveedor: "video", href, alto: 240 };
    if (RE_TIKTOK_CORTO.test(href)) return { proveedor: "tiktok_corto", href, alto: 150 };
    return { proveedor: "generico", href, alto: 150 };
  }

  // Los links cortos de TikTok no llevan el ID y el redirect no se puede
  // seguir con fetch (CORS). Su oEmbed si manda Access-Control-Allow-Origin:*,
  // asi que devuelve el ID directo desde el navegador.
  async function resolverTikTokCorto(href) {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(href)}`);
    if (!r.ok) throw new Error(`TikTok respondió ${r.status}`);
    const datos = await r.json();
    const id = datos.embed_product_id ||
      (String(datos.html || "").match(/data-video-id="(\d+)"/) || [])[1];
    if (!id) throw new Error("no se pudo leer el ID del video");
    return { id: id, titulo: datos.title || "" };
  }

  function crearIframeEmbed(info) {
    const marco = document.createElement("iframe");
    marco.className = "pizarra-embed";
    marco.src = info.embed;
    marco.loading = "lazy";
    marco.referrerPolicy = "strict-origin-when-cross-origin";
    marco.allowFullscreen = true;
    // Sin sandbox a proposito: TikTok e Instagram se rompen con el.
    // Sin web-share: Chrome no lo reconoce como feature de iframe y avisa en
    // consola por cada embed.
    marco.setAttribute("allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
    return marco;
  }

  function crearTarjetaEnlace(info, el, mensaje) {
    const card = document.createElement("a");
    card.className = "pizarra-enlace-card";
    card.href = info.href || el.Contenido || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const icono = document.createElement("div");
    icono.className = "pizarra-archivo-icono";
    icono.textContent = "🔗";
    card.appendChild(icono);

    const titulo = document.createElement("div");
    titulo.className = "pizarra-enlace-titulo";
    titulo.textContent = el.Nombre_archivo || dominioDe(info.href) || "enlace";
    card.appendChild(titulo);

    const nota = document.createElement("div");
    nota.className = "pizarra-archivo-nombre";
    nota.textContent = mensaje || "Abrir en una pestaña nueva";
    card.appendChild(nota);
    return card;
  }

  function crearContenidoEnlace(el) {
    const info = analizarEnlace(el.Contenido);
    if (info.proveedor === "invalido") {
      return crearTarjetaEnlace(info, el, "Enlace no válido");
    }
    if (info.embed) {
      const caja = document.createElement("div");
      caja.className = "pizarra-embed-caja";
      caja.appendChild(crearIframeEmbed(info));
      const hint = document.createElement("div");
      hint.className = "pizarra-embed-hint";
      hint.textContent = "Doble clic para interactuar";
      caja.appendChild(hint);
      return caja;
    }
    if (info.proveedor === "imagen") {
      const img = document.createElement("img");
      img.alt = el.Nombre_archivo || "imagen";
      // Sin referrer: varios CDNs sirven un placeholder si detectan hotlinking.
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.replaceWith(crearTarjetaEnlace(info, el, "No se pudo cargar la imagen"));
      });
      img.src = info.href;
      return img;
    }
    if (info.proveedor === "video") {
      const video = document.createElement("video");
      video.className = "pizarra-video";
      video.controls = true;
      video.src = info.href;
      return video;
    }
    if (info.proveedor === "tiktok_corto") {
      return crearTarjetaEnlace(info, el,
        "Link corto de TikTok: pegá la URL larga para ver la vista previa");
    }
    return crearTarjetaEnlace(info, el);
  }

  function crearTarjeta(el) {
    const div = document.createElement("div");
    div.className = "pizarra-elemento";
    if (el.Tipo === "forma") {
      // La forma se pinta en un ::before y no en el borde del div: asi el
      // clip-path del rombo/triangulo no recorta el boton de borrar ni el
      // tirador de resize, que son hijos de la tarjeta.
      const forma = FORMAS.includes(el.Forma) ? el.Forma : FORMAS[0];
      div.classList.add("pizarra-elemento-forma", `forma-${forma}`);
      div.style.setProperty("--forma-color", el.Color || "#e8b33d");
      div.style.setProperty("--forma-grosor", `${el.Grosor || 2}px`);
    }
    if (el.Tipo === "texto_libre") div.classList.add("pizarra-elemento-libre");
    if (el.Tipo === "enlace") div.classList.add("pizarra-elemento-enlace");
    div.dataset.id = el.ID;
    div.style.left = `${el.X}px`;
    div.style.top = `${el.Y}px`;
    div.style.width = `${el.Ancho}px`;
    div.style.height = `${el.Alto}px`;
    div.style.zIndex = el.Z_index || 1;

    // En la herramienta "conectar" cualquier clic en la tarjeta elige esta
    // forma como origen/destino de la conexion, en vez de arrastrar/editar.
    div.addEventListener("click", (e) => {
      if (herramienta !== "conectar") return;
      e.stopPropagation();
      manejarClicConectar(el);
    });

    // El arrastre engancha en TODA la tarjeta. Antes colgaba solo del handle,
    // una franja de 14px con el boton de borrar encima: acertarle era casi
    // imposible y parecia que la pizarra no dejaba mover nada.
    // SEL_NO_ARRASTRABLE excluye los controles que necesitan el gesto.
    div.addEventListener("mousedown", (e) => iniciarArrastre(e, el, div));

    // El texto y los embeds estan con pointer-events:none para poder arrastrar
    // por encima de ellos; el doble clic los habilita para editar/interactuar.
    div.addEventListener("dblclick", (e) => {
      if (herramienta !== "mover") return;
      e.stopPropagation();
      activarEdicion(div);
    });

    // El texto suelto no lleva franja: es texto sobre el lienzo, sin caja.
    if (el.Tipo !== "texto_libre") {
      const handle = document.createElement("div");
      handle.className = "pizarra-elemento-handle";
      div.appendChild(handle);
    }

    const btnBorrar = document.createElement("span");
    btnBorrar.className = "pizarra-elemento-borrar";
    btnBorrar.textContent = "×";
    btnBorrar.title = "Borrar";
    btnBorrar.addEventListener("click", (e) => {
      e.stopPropagation();
      borrarElemento(el, true);
    });
    div.appendChild(btnBorrar);

    const contenido = document.createElement("div");
    contenido.className = "pizarra-elemento-contenido";
    contenido.appendChild(crearContenidoPorTipo(el));
    div.appendChild(contenido);

    const handleResize = document.createElement("div");
    handleResize.className = "pizarra-resize-handle";
    handleResize.addEventListener("mousedown", (e) => iniciarResize(e, el, div));
    div.appendChild(handleResize);

    return div;
  }

  // Habilita la interaccion con el contenido de una tarjeta (escribir en el
  // textarea, usar los controles de un embed). Se sale al perder el foco o
  // al hacer clic fuera.
  function activarEdicion(div) {
    div.classList.add("editando");
    const ta = div.querySelector(".pizarra-elemento-texto");
    if (ta) {
      ta.focus();
      return;
    }
    // Un iframe no emite blur hacia afuera, asi que el modo se cierra con el
    // primer mousedown fuera de la tarjeta (en captura, antes que el arrastre).
    const salir = (ev) => {
      if (div.contains(ev.target)) return;
      div.classList.remove("editando");
      document.removeEventListener("mousedown", salir, true);
    };
    document.addEventListener("mousedown", salir, true);
  }

  function crearContenidoPorTipo(el) {
    if (TIPOS_TEXTO.includes(el.Tipo)) {
      const ta = document.createElement("textarea");
      ta.className = "pizarra-elemento-texto";
      ta.placeholder = el.Tipo === "forma" ? "Etiqueta..." : "Escribí algo...";
      ta.value = el.Contenido || "";
      if (el.Tipo !== "forma") {
        ta.style.color = el.Color || "";
        ta.style.fontSize = `${el.Grosor || 14}px`;
      }
      ta.addEventListener("change", async () => {
        const anterior = el.Contenido;
        el.Contenido = ta.value;
        await persistir(
          () => Api.updateRow("pizarra_elementos", el.ID, { Contenido: ta.value }),
          () => { el.Contenido = anterior; }
        );
      });
      ta.addEventListener("blur", () => {
        const card = ta.closest(".pizarra-elemento");
        if (card) card.classList.remove("editando");
      });
      return ta;
    }
    if (el.Tipo === "enlace") return crearContenidoEnlace(el);
    if (el.Tipo === "imagen") {
      const img = document.createElement("img");
      img.alt = el.Nombre_archivo || "imagen";
      if (!esRefUtilizable(el)) {
        img.src = PLACEHOLDER_IMAGEN;
        img.alt = "archivo no migrado";
        img.title = "archivo no migrado";
        return img;
      }
      // El archivo vive en Drive: hay que bajarlo con el token y pasarlo a
      // blob URL, asi que el src llega despues del render.
      img.src = PLACEHOLDER_IMAGEN;
      img.alt = "Cargando...";
      DriveFiles.asignarSrc(img, el.Contenido).then(() => {
        img.alt = el.Nombre_archivo || "imagen";
      }).catch((e) => {
        img.src = PLACEHOLDER_IMAGEN;
        img.alt = `No se pudo cargar: ${e.message}`;
        img.title = img.alt;
      });
      return img;
    }
    // pdf, audio y video comparten la misma tarjeta con ícono/nombre de archivo
    const card = document.createElement("div");
    card.className = "pizarra-elemento-archivo";
    if (el.Tipo === "audio" || el.Tipo === "video") {
      const medio = document.createElement(el.Tipo === "video" ? "video" : "audio");
      medio.controls = true;
      // Sin preload: el blob ya trae el archivo entero en memoria, y en video
      // pedir metadata aparte solo duplica trabajo.
      if (el.Tipo === "video") medio.className = "pizarra-video";
      if (esRefUtilizable(el)) {
        // prepararMedia ademas arregla la duracion Infinity de los webm/ogg.
        DriveFiles.prepararMedia(medio, el.Contenido).catch((e) => {
          card.appendChild(avisoArchivo(`No se pudo cargar: ${e.message}`));
        });
      } else {
        card.appendChild(avisoArchivo("archivo no migrado"));
      }
      card.appendChild(medio);
    } else {
      const icono = document.createElement("div");
      icono.className = "pizarra-archivo-icono";
      icono.textContent = "PDF";
      card.appendChild(icono);
      if (esRefUtilizable(el)) {
        card.addEventListener("click", () => {
          DriveFiles.abrirEnPestana(el.Contenido).catch((e) => {
            toast(`No se pudo abrir el archivo: ${e.message}`, "error");
          });
        });
      } else {
        card.appendChild(avisoArchivo("archivo no migrado"));
      }
    }
    const nombre = document.createElement("div");
    nombre.className = "pizarra-archivo-nombre";
    nombre.textContent = el.Nombre_archivo || "";
    card.appendChild(nombre);
    return card;
  }

  // ---- mover / redimensionar (arrastre libre) ----
  function iniciarArrastre(e, el, div) {
    if (herramienta !== "mover") return;
    if (e.button !== 0) return;
    // Los controles interactivos se quedan el gesto: el boton de borrar, el
    // tirador de resize, el texto en modo edicion y los reproductores/embeds.
    if (e.target.closest(SEL_NO_ARRASTRABLE)) return;
    e.preventDefault();
    const inicioX = e.clientX;
    const inicioY = e.clientY;
    const elX = Number(el.X) || 0;
    const elY = Number(el.Y) || 0;
    interactuando = true;
    let movio = false;

    const ancho = Number(el.Ancho) || 0;
    const alto = Number(el.Alto) || 0;

    function onMove(ev) {
      const dx = (ev.clientX - inicioX) / zoom;
      const dy = (ev.clientY - inicioY) / zoom;
      // Umbral: sin el, un clic con un pixel de temblor moveria el elemento y
      // dispararia una escritura al Sheet.
      if (!movio && Math.abs(dx) < UMBRAL_ARRASTRE && Math.abs(dy) < UMBRAL_ARRASTRE) return;
      movio = true;
      div.classList.add("arrastrando");
      const nuevoX = Math.max(0, elX + dx);
      const nuevoY = Math.max(0, elY + dy);
      div.style.left = `${nuevoX}px`;
      div.style.top = `${nuevoY}px`;
      actualizarConexionesEnVivo(el.ID, { x: nuevoX, y: nuevoY, w: ancho, h: alto });
    }
    async function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      interactuando = false;
      div.classList.remove("arrastrando");
      if (!movio) return;
      const nuevoX = Math.max(0, elX + (ev.clientX - inicioX) / zoom);
      const nuevoY = Math.max(0, elY + (ev.clientY - inicioY) / zoom);
      actualizarLocal(el.ID, { X: nuevoX, Y: nuevoY });
      const ok = await persistir(
        () => Api.updateRow("pizarra_elementos", el.ID, { X: nuevoX, Y: nuevoY }),
        () => actualizarLocal(el.ID, { X: elX, Y: elY })
      );
      if (ok) pushUndo({ tipo: "mover", id: el.ID, antes: { X: elX, Y: elY }, despues: { X: nuevoX, Y: nuevoY } });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function iniciarResize(e, el, div) {
    if (herramienta !== "mover") return;
    e.preventDefault();
    e.stopPropagation();
    const inicioX = e.clientX;
    const inicioY = e.clientY;
    const anchoIni = Number(el.Ancho) || 100;
    const altoIni = Number(el.Alto) || 100;
    const elX = Number(el.X) || 0;
    const elY = Number(el.Y) || 0;
    interactuando = true;

    function onMove(ev) {
      const nuevoAncho = Math.max(50, anchoIni + (ev.clientX - inicioX) / zoom);
      const nuevoAlto = Math.max(40, altoIni + (ev.clientY - inicioY) / zoom);
      div.style.width = `${nuevoAncho}px`;
      div.style.height = `${nuevoAlto}px`;
      actualizarConexionesEnVivo(el.ID, { x: elX, y: elY, w: nuevoAncho, h: nuevoAlto });
    }
    async function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      interactuando = false;
      const nuevoAncho = Math.max(50, anchoIni + (ev.clientX - inicioX) / zoom);
      const nuevoAlto = Math.max(40, altoIni + (ev.clientY - inicioY) / zoom);
      if (nuevoAncho === anchoIni && nuevoAlto === altoIni) return;
      actualizarLocal(el.ID, { Ancho: nuevoAncho, Alto: nuevoAlto });
      const ok = await persistir(
        () => Api.updateRow("pizarra_elementos", el.ID, { Ancho: nuevoAncho, Alto: nuevoAlto }),
        () => actualizarLocal(el.ID, { Ancho: anchoIni, Alto: altoIni })
      );
      if (ok) pushUndo({ tipo: "resize", id: el.ID, antes: { Ancho: anchoIni, Alto: altoIni }, despues: { Ancho: nuevoAncho, Alto: nuevoAlto } });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  async function borrarElemento(el, agregarHistorial) {
    if (!(await persistir(() => Api.deleteRow("pizarra_elementos", el.ID)))) return;
    State.pizarraElementos = State.pizarraElementos.filter((e) => String(e.ID) !== String(el.ID));
    // El archivo de Drive va a la papelera junto con el elemento; el undo lo
    // restaura junto con la fila (ver aplicarCambio).
    await borrarArchivoDeElemento(el);
    if (agregarHistorial) pushUndo({ tipo: "borrar", elemento: { ...el } });
    // Al borrar una forma tambien se borran sus conexiones: si no lo
    // hicieramos quedarian filas "conexion" en el Sheet apuntando a un
    // Origen_ID/Destino_ID inexistente (invisibles pero acumulandose).
    // Nota: el undo de este borrado no restaura esas conexiones.
    if (el.Tipo !== "conexion") {
      const huerfanas = State.pizarraElementos.filter(
        (e) => e.Tipo === "conexion" && (String(e.Origen_ID) === String(el.ID) || String(e.Destino_ID) === String(el.ID))
      );
      for (const con of huerfanas) {
        await persistir(() => Api.deleteRow("pizarra_elementos", con.ID));
      }
      State.pizarraElementos = State.pizarraElementos.filter((e) => !huerfanas.includes(e));
    }
    renderElementos();
  }

  // ---- conectar dos formas con una linea ----
  function manejarClicConectar(el) {
    if (!conexionOrigenId) {
      conexionOrigenId = el.ID;
      resaltarSeleccionConexion(el.ID);
      toast("Elegida la forma origen: ahora hacé clic en la forma destino");
      return;
    }
    if (String(conexionOrigenId) === String(el.ID)) {
      conexionOrigenId = null;
      resaltarSeleccionConexion(null);
      return;
    }
    crearConexion(conexionOrigenId, el.ID);
    conexionOrigenId = null;
    resaltarSeleccionConexion(null);
  }

  function resaltarSeleccionConexion(id) {
    document.querySelectorAll(".pizarra-elemento").forEach((div) => {
      div.classList.toggle("pizarra-elemento-conectando", id !== null && div.dataset.id === String(id));
    });
  }

  async function crearConexion(origenId, destinoId) {
    const color = document.getElementById("pizarra-color").value;
    const grosor = document.getElementById("pizarra-grosor").value;
    const creado = await persistir(() => Api.createRow("pizarra_elementos", {
      Pizarra_ID: pizarraActualId,
      Tipo: "conexion",
      X: 0, Y: 0, Ancho: 0, Alto: 0,
      Contenido: "",
      Nombre_archivo: "",
      Color: color,
      Grosor: grosor,
      Z_index: siguienteZIndex(),
      Fecha_creacion: todayISO(),
      Origen_ID: origenId,
      Destino_ID: destinoId,
    }));
    if (!creado) return;
    State.pizarraElementos.push(creado);
    pushUndo({ tipo: "crear", elemento: { ...creado } });
    renderElementos();
    toast("Conexión creada", "success");
  }

  // ---- lápiz (dibujo a mano alzada) ----
  function coordEnCanvas(e) {
    const rect = document.getElementById("pizarra-canvas").getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  function puntosADPath(puntos) {
    return puntos.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }

  function cajaDePuntos(puntos) {
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: minX, y: minY, ancho: Math.max(1, maxX - minX), alto: Math.max(1, maxY - minY) };
  }

  function iniciarDibujo(e) {
    if (herramienta !== "lapiz" || !pizarraActualId) return;
    if (e.target.closest(".pizarra-elemento")) return;
    interactuando = true;

    const svg = document.getElementById("pizarra-svg");
    const path = document.createElementNS(SVG_NS, "path");
    const color = document.getElementById("pizarra-color").value;
    const grosor = document.getElementById("pizarra-grosor").value;
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", grosor);
    path.setAttribute("class", "pizarra-trazo");
    svg.appendChild(path);

    const puntos = [coordEnCanvas(e)];
    path.setAttribute("d", puntosADPath(puntos));

    function onMove(ev) {
      puntos.push(coordEnCanvas(ev));
      path.setAttribute("d", puntosADPath(puntos));
    }
    async function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      interactuando = false;
      if (puntos.length < 2) {
        path.remove();
        return;
      }
      const caja = cajaDePuntos(puntos);
      const creado = await persistir(() => Api.createRow("pizarra_elementos", {
        Pizarra_ID: pizarraActualId,
        Tipo: "trazo",
        X: caja.x, Y: caja.y, Ancho: caja.ancho, Alto: caja.alto,
        Contenido: puntosADPath(puntos),
        Nombre_archivo: "",
        Color: color,
        Grosor: grosor,
        Z_index: siguienteZIndex(),
        Fecha_creacion: todayISO(),
      }));
      if (!creado) return;
      State.pizarraElementos.push(creado);
      pushUndo({ tipo: "crear", elemento: { ...creado } });
      renderElementos();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---- linea recta / flecha (arrastrar de un punto a otro) ----
  function iniciarLineaRecta(e) {
    if ((herramienta !== "linea" && herramienta !== "flecha") || !pizarraActualId) return;
    if (e.target.closest(".pizarra-elemento")) return;
    interactuando = true;

    const tipo = herramienta;
    const svg = document.getElementById("pizarra-svg");
    const defs = asegurarDefs(svg);
    const color = document.getElementById("pizarra-color").value;
    const grosor = document.getElementById("pizarra-grosor").value;
    const inicio = coordEnCanvas(e);

    const preview = document.createElementNS(SVG_NS, "line");
    preview.setAttribute("x1", inicio.x);
    preview.setAttribute("y1", inicio.y);
    preview.setAttribute("x2", inicio.x);
    preview.setAttribute("y2", inicio.y);
    preview.setAttribute("stroke", color);
    preview.setAttribute("stroke-width", grosor);
    preview.setAttribute("class", "pizarra-trazo");
    if (tipo === "flecha") {
      crearMarkerFlecha(defs, "pizarra-marker-preview", color);
      preview.setAttribute("marker-end", "url(#pizarra-marker-preview)");
    }
    svg.appendChild(preview);

    function onMove(ev) {
      const actual = coordEnCanvas(ev);
      preview.setAttribute("x2", actual.x);
      preview.setAttribute("y2", actual.y);
    }
    async function onUp(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      interactuando = false;
      const fin = coordEnCanvas(ev);
      preview.remove();
      if (Math.hypot(fin.x - inicio.x, fin.y - inicio.y) < 4) return;
      const caja = cajaDePuntos([inicio, fin]);
      const creado = await persistir(() => Api.createRow("pizarra_elementos", {
        Pizarra_ID: pizarraActualId,
        Tipo: tipo,
        X: caja.x, Y: caja.y, Ancho: caja.ancho, Alto: caja.alto,
        Contenido: puntosADPath([inicio, fin]),
        Nombre_archivo: "",
        Color: color,
        Grosor: grosor,
        Z_index: siguienteZIndex(),
        Fecha_creacion: todayISO(),
      }));
      if (!creado) return;
      State.pizarraElementos.push(creado);
      pushUndo({ tipo: "crear", elemento: { ...creado } });
      renderElementos();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---- deshacer / rehacer ----
  function pushUndo(accion) {
    undoStack.push(accion);
    if (undoStack.length > MAX_HISTORIAL) undoStack.shift();
    redoStack = [];
  }

  // Sheets primero, estado local despues: si la escritura falla, la excepcion
  // sube a deshacer/rehacer con el estado intacto. createRow respeta el ID
  // que recibe, asi que la fila vuelve con su ID original y las conexiones
  // que apuntaban a el siguen valiendo.
  async function quitarFila(elemento) {
    await Api.deleteRow("pizarra_elementos", elemento.ID);
    State.pizarraElementos = State.pizarraElementos.filter((e) => String(e.ID) !== String(elemento.ID));
    await borrarArchivoDeElemento(elemento);
  }

  async function reponerFila(elemento) {
    // El archivo vuelve de la papelera antes que la fila: si no esta, avisa y
    // la fila se recrea igual (el usuario decide si la borra).
    await restaurarArchivoDeElemento(elemento);
    await Api.createRow("pizarra_elementos", elemento);
    State.pizarraElementos.push({ ...elemento });
  }

  async function aplicarCambio(accion, usarAntes) {
    switch (accion.tipo) {
      case "mover":
      case "resize": {
        const cambios = usarAntes ? accion.antes : accion.despues;
        await Api.updateRow("pizarra_elementos", accion.id, cambios);
        actualizarLocal(accion.id, cambios);
        break;
      }
      case "crear": {
        if (usarAntes) await quitarFila(accion.elemento);
        else await reponerFila(accion.elemento);
        break;
      }
      case "borrar": {
        if (usarAntes) await reponerFila(accion.elemento);
        else await quitarFila(accion.elemento);
        break;
      }
    }
    renderElementos();
  }

  // Si la escritura falla, la accion vuelve a su pila para poder reintentar.
  // aplicarCambio escribe en Sheets ANTES de tocar el estado local, asi que un
  // fallo deja todo como estaba.
  async function deshacer() {
    const accion = undoStack.pop();
    if (!accion) return;
    try {
      await aplicarCambio(accion, true);
      redoStack.push(accion);
    } catch (e) {
      undoStack.push(accion);
      toast(`No se pudo deshacer: ${e.message}`, "error");
    }
  }

  async function rehacer() {
    const accion = redoStack.pop();
    if (!accion) return;
    try {
      await aplicarCambio(accion, false);
      undoStack.push(accion);
    } catch (e) {
      redoStack.push(accion);
      toast(`No se pudo rehacer: ${e.message}`, "error");
    }
  }

  function onKeydown(e) {
    if (!document.getElementById("tab-pizarra").classList.contains("active")) return;
    const activo = document.activeElement;
    if (activo && ["INPUT", "TEXTAREA", "SELECT"].includes(activo.tagName)) return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      deshacer();
    } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
      e.preventDefault();
      rehacer();
    }
  }

  // ---- zoom ----
  function aplicarZoom() {
    document.getElementById("pizarra-canvas").style.transform = `scale(${zoom})`;
    document.getElementById("pizarra-zoom-nivel").textContent = `${Math.round(zoom * 100)}%`;
  }

  function cambiarZoom(delta) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(zoom + delta).toFixed(2)));
    aplicarZoom();
  }

  function resetZoom() {
    zoom = 1;
    aplicarZoom();
  }

  function onWheelZoom(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    cambiarZoom(e.deltaY < 0 ? ZOOM_PASO : -ZOOM_PASO);
  }

  // ---- herramientas ----
  function seleccionarHerramienta(tool) {
    herramienta = tool;
    document.querySelectorAll(".btn-tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    const canvas = document.getElementById("pizarra-canvas");
    canvas.classList.remove("modo-mover", "modo-lapiz", "modo-borrador", "modo-linea", "modo-flecha", "modo-conectar");
    canvas.classList.add(`modo-${tool}`);
    if (tool !== "conectar") {
      conexionOrigenId = null;
      resaltarSeleccionConexion(null);
    }
  }

  // ---- agregar texto / forma / enlace / imagen / pdf / audio ----

  // Crea un elemento en la posicion escalonada de siempre. `extra` sobrescribe
  // los campos base, asi cada tipo solo declara lo suyo.
  async function crearElementoBasico(tipo, extra) {
    if (!pizarraActualId) {
      toast("Primero creá o elegí una pizarra", "error");
      return null;
    }
    const offset = siguienteOffset();
    const tam = DEFAULTS[tipo];
    const creado = await persistir(() => Api.createRow("pizarra_elementos", Object.assign({
      Pizarra_ID: pizarraActualId,
      Tipo: tipo,
      X: 60 + offset, Y: 60 + offset,
      Ancho: tam.ancho, Alto: tam.alto,
      Contenido: "",
      Nombre_archivo: "",
      Color: "", Grosor: "",
      Z_index: siguienteZIndex(),
      Fecha_creacion: todayISO(),
    }, extra || {})));
    if (!creado) return null;
    State.pizarraElementos.push(creado);
    pushUndo({ tipo: "crear", elemento: { ...creado } });
    renderElementos();
    return creado;
  }

  // Deja la tarjeta recien creada lista para escribir sin pedir doble clic.
  function enfocarTexto(id) {
    const div = document.querySelector(`.pizarra-elemento[data-id="${id}"]`);
    if (div) activarEdicion(div);
  }

  async function agregarTexto() {
    const creado = await crearElementoBasico("texto", { Color: "#ecebe5", Grosor: 14 });
    if (creado) enfocarTexto(creado.ID);
  }

  // Texto sin caja: misma tarjeta arrastrable, pero sin borde, sin fondo y sin
  // franja superior. Es un tipo aparte y no una variante de "texto" para no
  // tocar el significado de las filas ya guardadas.
  async function agregarTextoLibre() {
    const creado = await crearElementoBasico("texto_libre", { Color: "#ecebe5", Grosor: 18 });
    if (creado) enfocarTexto(creado.ID);
  }

  async function agregarForma() {
    const sel = document.getElementById("pizarra-forma-tipo");
    const forma = sel && FORMAS.includes(sel.value) ? sel.value : FORMAS[0];
    const creado = await crearElementoBasico("forma", {
      Color: document.getElementById("pizarra-color").value,
      Grosor: 2,
      Forma: forma,
      Origen_ID: "", Destino_ID: "",
    });
    if (creado) enfocarTexto(creado.ID);
  }

  async function agregarEnlace() {
    if (!pizarraActualId) {
      toast("Primero creá o elegí una pizarra", "error");
      return;
    }
    let crudo;
    try {
      const r = await PromptModal.pedirTexto({
        titulo: "Agregar desde un link",
        etiqueta: "Pegá el link",
        placeholder: "https://www.instagram.com/reel/...",
        ayuda: "YouTube, TikTok, Instagram, o una URL directa de imagen o video. " +
          "X/Twitter y Facebook no permiten vista previa: quedan como enlace.",
        textoConfirmar: "Agregar",
        validar: (v) => (analizarEnlace(v).proveedor === "invalido"
          ? { ok: false, error: "No parece una URL válida." }
          : { ok: true, valor: String(v).trim() }),
      });
      crudo = r.valor;
    } catch (e) {
      return; // cancelado
    }
    await crearEnlace(crudo);
  }

  async function crearEnlace(crudo) {
    let info = analizarEnlace(crudo);
    let href = info.href || String(crudo).trim();
    let titulo = "";
    // Se resuelve una sola vez, al crear, para guardar ya la URL larga: asi el
    // render se mantiene sincrono y no pega a la red en cada repintado.
    if (info.proveedor === "tiktok_corto") {
      try {
        const r = await resolverTikTokCorto(href);
        href = `https://www.tiktok.com/@tiktok/video/${r.id}`;
        titulo = r.titulo;
        info = analizarEnlace(href);
      } catch (e) {
        toast(`No se pudo resolver el link corto de TikTok: ${e.message}`, "error");
      }
    }
    const creado = await crearElementoBasico("enlace", {
      Contenido: href,
      Nombre_archivo: titulo || dominioDe(href),
      Alto: info.alto || DEFAULTS.enlace.alto,
    });
    if (creado) toast("Enlace agregado", "success");
  }

  // Pegar un link con la pestaña de pizarra abierta lo agrega directo: es el
  // gesto natural para traer algo de Instagram, TikTok o YouTube.
  async function onPaste(e) {
    if (!document.getElementById("tab-pizarra").classList.contains("active")) return;
    const activo = document.activeElement;
    if (activo && ["INPUT", "TEXTAREA", "SELECT"].includes(activo.tagName)) return;
    if (PromptModal.estaAbierto()) return;
    const texto = ((e.clipboardData && e.clipboardData.getData("text")) || "").trim();
    if (!/^https?:\/\//i.test(texto)) return;
    e.preventDefault();
    if (!pizarraActualId) {
      toast("Primero creá o elegí una pizarra", "error");
      return;
    }
    await crearEnlace(texto);
  }

  function dispararSelectorArchivo(tipo) {
    if (!pizarraActualId) {
      toast("Primero creá o elegí una pizarra", "error");
      return;
    }
    document.getElementById(`pizarra-file-${tipo}`).click();
  }

  // Sube un archivo ya elegido (por selector o arrastrado desde el explorador)
  // y crea su elemento en la posicion (x, y) dada. El File se manda tal cual
  // a Drive y en Contenido se guarda su referencia "drive:<id>".
  async function subirYCrearElemento(tipo, file, x, y) {
    try {
      const resultado = await DriveFiles.subirArchivoPizarra(pizarraActualId, file);
      const tam = DEFAULTS[tipo];
      const creado = await Api.createRow("pizarra_elementos", {
        Pizarra_ID: pizarraActualId,
        Tipo: tipo,
        X: x, Y: y,
        Ancho: tam.ancho, Alto: tam.alto,
        Contenido: resultado.ref,
        Nombre_archivo: file.name,
        Color: "", Grosor: "",
        Z_index: siguienteZIndex(),
        Fecha_creacion: todayISO(),
      });
      State.pizarraElementos.push(creado);
      pushUndo({ tipo: "crear", elemento: { ...creado } });
      renderElementos();
    } catch (e) {
      toast(`No se pudo subir el archivo: ${e.message}`, "error");
    }
  }

  async function onArchivoSeleccionado(tipo, input) {
    const file = input.files[0];
    if (!file) return;
    input.value = "";
    const offset = siguienteOffset();
    await subirYCrearElemento(tipo, file, 60 + offset, 60 + offset);
  }

  // ---- arrastrar archivos desde el explorador ----
  function tipoDeArchivo(file) {
    const mime = file.type || "";
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "imagen";
    if (mime === "application/pdf" || ext === "pdf") return "pdf";
    // Video antes que audio: un .webm de video trae mime "video/webm" y hay
    // que pintarlo como <video>, no como <audio>.
    if (mime.startsWith("video/") || ["mp4", "mov"].includes(ext)) return "video";
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "webm"].includes(ext)) return "audio";
    return null;
  }

  function onDragOver(e) {
    e.preventDefault();
    document.getElementById("pizarra-canvas").classList.add("arrastrando-archivo");
  }

  function onDragLeave(e) {
    if (e.target === document.getElementById("pizarra-canvas")) {
      document.getElementById("pizarra-canvas").classList.remove("arrastrando-archivo");
    }
  }

  async function onDrop(e) {
    e.preventDefault();
    document.getElementById("pizarra-canvas").classList.remove("arrastrando-archivo");
    if (!pizarraActualId) {
      toast("Primero creá o elegí una pizarra", "error");
      return;
    }
    const archivos = Array.from(e.dataTransfer.files || []);
    if (archivos.length === 0) {
      // Arrastrar un enlace desde otra pestaña no trae archivos, solo la URL.
      const uri = (e.dataTransfer.getData("text/uri-list") ||
        e.dataTransfer.getData("text") || "").trim();
      if (/^https?:\/\//i.test(uri)) await crearEnlace(uri);
      return;
    }
    const base = coordEnCanvas(e);
    let offset = 0;
    for (const file of archivos) {
      const tipo = tipoDeArchivo(file);
      if (!tipo) {
        toast(`Formato no soportado: ${file.name}`, "error");
        continue;
      }
      const tam = DEFAULTS[tipo];
      const x = Math.max(0, base.x + offset - tam.ancho / 2);
      const y = Math.max(0, base.y + offset - tam.alto / 2);
      await subirYCrearElemento(tipo, file, x, y);
      offset += 24;
    }
  }

  function bindEvents() {
    document.getElementById("pizarra-selector").addEventListener("change", (e) => {
      pizarraActualId = e.target.value;
      limpiarHistorial();
      renderElementos();
    });
    document.getElementById("btn-pizarra-nueva").addEventListener("click", crearPizarra);
    document.getElementById("btn-pizarra-renombrar").addEventListener("click", renombrarPizarra);
    document.getElementById("btn-pizarra-borrar").addEventListener("click", borrarPizarraActual);

    document.querySelectorAll(".btn-tool").forEach((b) => {
      b.addEventListener("click", () => seleccionarHerramienta(b.dataset.tool));
    });
    seleccionarHerramienta("mover");

    document.getElementById("btn-pizarra-undo").addEventListener("click", deshacer);
    document.getElementById("btn-pizarra-redo").addEventListener("click", rehacer);
    document.addEventListener("keydown", onKeydown);

    document.getElementById("btn-pizarra-texto").addEventListener("click", agregarTexto);
    document.getElementById("btn-pizarra-texto-libre").addEventListener("click", agregarTextoLibre);
    document.getElementById("btn-pizarra-forma").addEventListener("click", agregarForma);
    document.getElementById("btn-pizarra-enlace").addEventListener("click", agregarEnlace);
    document.addEventListener("paste", onPaste);
    document.getElementById("btn-pizarra-imagen").addEventListener("click", () => dispararSelectorArchivo("imagen"));
    document.getElementById("btn-pizarra-pdf").addEventListener("click", () => dispararSelectorArchivo("pdf"));
    document.getElementById("btn-pizarra-audio").addEventListener("click", () => dispararSelectorArchivo("audio"));
    document.getElementById("btn-pizarra-video").addEventListener("click", () => dispararSelectorArchivo("video"));
    document.getElementById("pizarra-file-imagen").addEventListener("change", (e) => onArchivoSeleccionado("imagen", e.target));
    document.getElementById("pizarra-file-pdf").addEventListener("change", (e) => onArchivoSeleccionado("pdf", e.target));
    document.getElementById("pizarra-file-audio").addEventListener("change", (e) => onArchivoSeleccionado("audio", e.target));
    document.getElementById("pizarra-file-video").addEventListener("change", (e) => onArchivoSeleccionado("video", e.target));

    const canvas = document.getElementById("pizarra-canvas");
    canvas.addEventListener("mousedown", iniciarDibujo);
    canvas.addEventListener("mousedown", iniciarLineaRecta);
    canvas.addEventListener("click", (e) => {
      if (herramienta === "conectar" && conexionOrigenId && !e.target.closest(".pizarra-elemento")) {
        conexionOrigenId = null;
        resaltarSeleccionConexion(null);
      }
    });
    canvas.addEventListener("dragover", onDragOver);
    canvas.addEventListener("dragleave", onDragLeave);
    canvas.addEventListener("drop", onDrop);

    document.getElementById("btn-pizarra-zoom-in").addEventListener("click", () => cambiarZoom(ZOOM_PASO));
    document.getElementById("btn-pizarra-zoom-out").addEventListener("click", () => cambiarZoom(-ZOOM_PASO));
    document.getElementById("btn-pizarra-zoom-reset").addEventListener("click", resetZoom);
    document.getElementById("pizarra-canvas-wrap").addEventListener("wheel", onWheelZoom, { passive: false });
  }

  return { render, bindEvents };
})();
