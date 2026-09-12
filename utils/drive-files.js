// ============================================================
// DRIVE-FILES.JS - Subida y visualizacion de archivos en Google Drive
//
// Reemplaza al servidor Python local (uploads/materiales/ y
// uploads/pizarras/<id>/). Sin disco: todo vive en Drive y el
// identificador que se guarda en el Sheet es una referencia
// "drive:<fileId>" en vez de una ruta relativa.
//
// Depende de: GoogleSheets.getToken() (mismo token OAuth de la app).
// Scope disponible: drive.file -> la app SOLO ve los archivos que
// ella misma crea. Es suficiente porque nosotros creamos todo.
//
// ---- DECISION IMPORTANTE: como se muestran los archivos ----
// Con scope drive.file los archivos quedan PRIVADOS. Por eso:
//   * https://drive.google.com/uc?id=...  NO sirve: devuelve la pagina
//     de login/consentimiento porque el navegador no manda el token,
//     y ademas Drive bloquea el hotlinking de archivos no publicos.
//   * thumbnailLink / webContentLink de la metadata tampoco son fiables:
//     caducan, dependen de la cookie de sesion de Google y fallan
//     cross-origin dentro de un <img>.
//   * Publicar cada archivo con permissions.create({role:'reader',
//     type:'anyone'}) SI funcionaria con URL directa, pero convierte
//     material privado del cliente en publico para cualquiera con el
//     enlace. Descartado por defecto (ver publicarArchivo(), opt-in).
// Solucion adoptada: descargar con fetch + Authorization: Bearer sobre
// files/<id>?alt=media, convertir a Blob y servirlo con
// URL.createObjectURL(). El blob: URL funciona en <img>, <audio>,
// <video>, <iframe> y window.open sin necesidad de token adicional.
//
// ---- AUDIO Y SEEK ----
// Un blob: URL SI permite adelantar/retroceder: el recurso esta entero
// en memoria, el navegador conoce su tamano y el seek es instantaneo
// (no hace falta soporte de Range del servidor, que era lo que daba el
// Python con RANGE_RE).
// Limitaciones a tener en cuenta:
//   1. El archivo se descarga COMPLETO antes de poder reproducir; no hay
//      streaming progresivo. Para notas de voz (pocos MB) es irrelevante.
//   2. Un .webm/.ogg grabado con MediaRecorder suele no traer duracion en
//      la cabecera: el <audio> reporta duration = Infinity y el seek se
//      vuelve erratico. Es un problema del contenedor, no del blob; pasaba
//      igual sirviendo desde disco. Workaround clasico: asignar
//      audio.currentTime = 1e101 una vez cargado para forzar el calculo.
//      Lo hace prepararAudio() mas abajo.
// ============================================================

var DriveFiles = {

  // ---- configuracion ----
  CARPETA_RAIZ: 'Agencia - Archivos',
  CARPETA_MATERIALES: 'materiales',
  CARPETA_PIZARRAS: 'pizarras',

  DRIVE_API: 'https://www.googleapis.com/drive/v3/files',
  DRIVE_UPLOAD_API: 'https://www.googleapis.com/upload/drive/v3/files',
  MIME_CARPETA: 'application/vnd.google-apps.folder',

  // Unidad compartida donde vive todo. Se configura porque en "Mi unidad" el
  // archivo lo posee QUIEN LO SUBE y consume su cuota, aunque este dentro de
  // una carpeta ajena: compartir una carpeta no libera espacio. En una unidad
  // compartida los archivos los posee la unidad y el espacio sale del
  // almacenamiento agrupado del Workspace.
  //
  // Si queda vacio, se opera contra "Mi unidad" como antes.
  driveId: function() {
    return (typeof CONFIG !== 'undefined' && CONFIG.AGENCIA_DRIVE_ID) || '';
  },

  // La API de Drive ignora las unidades compartidas salvo que se le pida
  // explicitamente. Sin esto, toda llamada contra la unidad falla con 404.
  _conUnidad: function(url) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'supportsAllDrives=true';
  },

  // Prefijo de la referencia que se guarda en el Sheet (columna Foto /
  // Contenido). Se guarda "drive:<id>" y no la URL porque los blob: URL
  // son efimeros: mueren al recargar la pagina.
  PREFIJO_REF: 'drive:',

  // Maximo de blobs vivos en cache antes de empezar a liberar los mas
  // antiguos. Cada entrada retiene el archivo completo en memoria.
  LIMITE_CACHE: 40,

  // Mismas listas que EXTENSIONES_PERMITIDAS / EXTENSIONES_PIZARRA_PERMITIDAS
  // del api_handler.py, con su mimeType para la subida.
  EXT_IMAGEN: {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp'
  },
  EXT_PIZARRA: {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', webm: 'audio/webm',
    // Video: no estaba en el api_handler.py original, se agrego despues.
    // Nota: 'webm' arriba se mapea a audio/webm porque ya venia asi; un webm
    // de video se subira etiquetado como audio y se pintara como <audio>.
    // Para video conviene mp4 o mov.
    mp4: 'video/mp4', mov: 'video/quicktime'
  },

  ERROR_IMAGEN: 'Formato de imagen no soportado (usa jpg, png, gif o webp)',
  ERROR_PIZARRA: 'Formato no soportado (imagen, pdf, audio: mp3/wav/ogg/m4a/webm, o video: mp4/mov)',

  // ---- estado interno ----
  _carpetas: {},      // ruta ('materiales', 'pizarras/12') -> Promise<folderId>
  _urls: {},          // fileId -> { url, mimeType, name, size }
  _descargas: {},     // fileId -> Promise en curso (evita descargas duplicadas)
  _orden: [],         // fileIds en orden de creacion, para liberar los viejos

  // ============================================================
  // TOKEN
  // ============================================================

  getToken: function() {
    if (typeof GoogleSheets === 'undefined' || !GoogleSheets.getToken) {
      throw new Error('GoogleSheets no esta cargado; drive-files.js depende de el');
    }
    var token = GoogleSheets.getToken();
    if (!token) throw new Error('No autenticado con Google. Inicia sesion de nuevo.');
    return token;
  },

  isAuthenticated: function() {
    return typeof GoogleSheets !== 'undefined' && !!GoogleSheets.getToken();
  },

  // ============================================================
  // REFERENCIAS "drive:<id>"
  // ============================================================

  refDeId: function(fileId) {
    return this.PREFIJO_REF + fileId;
  },

  esRef: function(valor) {
    return typeof valor === 'string' && valor.indexOf(this.PREFIJO_REF) === 0;
  },

  // Acepta "drive:<id>", un id pelado o una URL de Drive y devuelve el id.
  // Devuelve null si el valor es una ruta antigua tipo "uploads/...".
  idDeRef: function(valor) {
    if (!valor || typeof valor !== 'string') return null;
    if (this.esRef(valor)) return valor.slice(this.PREFIJO_REF.length);
    if (valor.indexOf('uploads/') === 0 || valor.indexOf('/') !== -1) {
      var m = valor.match(/[-\w]{25,}/);
      return m ? m[0] : null;
    }
    return /^[-\w]{20,}$/.test(valor) ? valor : null;
  },

  // ============================================================
  // VALIDACION
  // ============================================================

  extensionDe: function(nombre) {
    if (!nombre || nombre.indexOf('.') === -1) return '';
    return nombre.split('.').pop().toLowerCase();
  },

  // Devuelve el mimeType si el archivo es valido; lanza Error en espanol si no.
  validarArchivo: function(file, permitidas, mensajeError) {
    if (!file) throw new Error('No se recibio ningun archivo');
    var ext = this.extensionDe(file.name);
    var mime = permitidas[ext];
    if (!mime) throw new Error(mensajeError);
    return mime;
  },

  esImagenValida: function(file) {
    return !!this.EXT_IMAGEN[this.extensionDe(file && file.name)];
  },

  esArchivoPizarraValido: function(file) {
    return !!this.EXT_PIZARRA[this.extensionDe(file && file.name)];
  },

  // ============================================================
  // CARPETAS
  // ============================================================

  // Busca una carpeta por nombre dentro de un padre; la crea si no existe.
  // Con drive.file el listado solo devuelve carpetas creadas por la app,
  // asi que no hay riesgo de engancharse a una carpeta ajena del usuario.
  _buscarOCrearCarpeta: function(nombre, parentId) {
    var self = this;
    var token = this.getToken();
    var seguro = nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var q = "mimeType='" + this.MIME_CARPETA + "' and name='" + seguro + "' and trashed=false";
    if (parentId) q += " and '" + parentId + "' in parents";

    var url = this.DRIVE_API + '?q=' + encodeURIComponent(q) +
      '&fields=files(id,name)&pageSize=10';
    var unidad = this.driveId();
    if (unidad) {
      // corpora=drive limita la busqueda a esa unidad; sin
      // includeItemsFromAllDrives la respuesta vendria vacia aunque exista.
      url += '&supportsAllDrives=true&includeItemsFromAllDrives=true' +
        '&corpora=drive&driveId=' + encodeURIComponent(unidad);
    } else {
      url += '&spaces=drive';
    }

    return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) {
        if (!r.ok) return self._errorDrive(r, 'Error buscando la carpeta en Drive');
        return r.json();
      })
      .then(function(data) {
        var files = data.files || [];
        if (files.length) return files[0].id;
        var metadata = { name: nombre, mimeType: self.MIME_CARPETA };
        if (parentId) metadata.parents = [parentId];
        return fetch(self._conUnidad(self.DRIVE_API + '?fields=id'), {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata)
        }).then(function(r) {
          if (!r.ok) return self._errorDrive(r, 'No se pudo crear la carpeta en Drive');
          return r.json();
        }).then(function(carpeta) { return carpeta.id; });
      });
  },

  // Resuelve una ruta relativa a la carpeta raiz ('materiales',
  // 'pizarras/17') creando cada nivel si hace falta. Cachea la promesa,
  // no el id, para que dos subidas simultaneas no creen carpetas duplicadas.
  carpetaDeRuta: function(ruta) {
    var self = this;
    ruta = (ruta || '').replace(/^\/+|\/+$/g, '');
    if (this._carpetas[ruta]) return this._carpetas[ruta];

    var promesa;
    if (!ruta) {
      // En una unidad compartida su propio id direcciona la carpeta raiz, asi
      // que la carpeta de la app cuelga de ahi. Sin unidad, cuelga de la raiz
      // de "Mi unidad" (parentId null).
      promesa = this._buscarOCrearCarpeta(this.CARPETA_RAIZ, this.driveId() || null);
    } else {
      var partes = ruta.split('/');
      var ultima = partes.pop();
      promesa = this.carpetaDeRuta(partes.join('/')).then(function(padreId) {
        return self._buscarOCrearCarpeta(ultima, padreId);
      });
    }

    // Si falla, se descarta la promesa para poder reintentar mas tarde.
    promesa = promesa.catch(function(err) {
      delete self._carpetas[ruta];
      throw err;
    });
    this._carpetas[ruta] = promesa;
    return promesa;
  },

  carpetaMateriales: function() {
    return this.carpetaDeRuta(this.CARPETA_MATERIALES);
  },

  carpetaPizarra: function(pizarraId) {
    var id = String(pizarraId || '').trim();
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return Promise.reject(new Error('ID de pizarra invalido'));
    }
    return this.carpetaDeRuta(this.CARPETA_PIZARRAS + '/' + id);
  },

  // ============================================================
  // SUBIDA
  // ============================================================

  // subirArchivo(file, carpeta, opciones)
  //   file    : File o Blob del <input type="file"> / drag&drop
  //   carpeta : ruta relativa a la raiz ('materiales', 'pizarras/17').
  //             Tambien acepta un folderId de Drive ya resuelto.
  //   opciones: { permitidas, mensajeError, nombre }
  // Devuelve { id, name, mimeType, size, ref, carpetaId }
  subirArchivo: function(file, carpeta, opciones) {
    var self = this;
    opciones = opciones || {};
    var ruta = carpeta || '';

    // Por defecto se valida segun la carpeta destino, igual que hacia el
    // Python: materiales solo imagenes, pizarras imagenes + pdf + audio.
    var permitidas = opciones.permitidas ||
      (ruta.indexOf(this.CARPETA_MATERIALES) === 0 ? this.EXT_IMAGEN : this.EXT_PIZARRA);
    var mensaje = opciones.mensajeError ||
      (permitidas === this.EXT_IMAGEN ? this.ERROR_IMAGEN : this.ERROR_PIZARRA);

    var mimeType;
    try {
      mimeType = this.validarArchivo(file, permitidas, mensaje);
      this.getToken();
    } catch (err) {
      return Promise.reject(err);
    }

    var destino = /^[-\w]{20,}$/.test(ruta) ? Promise.resolve(ruta) : this.carpetaDeRuta(ruta);

    return destino.then(function(carpetaId) {
      var token = self.getToken();
      var nombre = opciones.nombre || self._nombreSeguro(file.name);
      var metadata = { name: nombre, mimeType: mimeType, parents: [carpetaId] };
      var frontera = '-------claudia-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var delim = '\r\n--' + frontera + '\r\n';
      var cierre = '\r\n--' + frontera + '--';

      // Multipart de Drive v3: parte JSON con la metadata + parte binaria
      // con el archivo. Se arma como Blob para no pasar el binario a
      // string (base64 inflaria un 33% y rompe archivos grandes).
      var cuerpo = new Blob([
        delim,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        delim,
        'Content-Type: ' + mimeType + '\r\n\r\n',
        file,
        cierre
      ], { type: 'multipart/related; boundary="' + frontera + '"' });

      // Ojo: no se pone Content-Type a mano, fetch lo toma del Blob y asi
      // conserva el boundary correcto.
      return fetch(self._conUnidad(self.DRIVE_UPLOAD_API + '?uploadType=multipart&fields=id,name,mimeType,size'), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: cuerpo
      }).then(function(r) {
        if (!r.ok) return self._errorDrive(r, 'No se pudo subir el archivo a Drive');
        return r.json();
      }).then(function(data) {
        return {
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size ? parseInt(data.size, 10) : (file.size || 0),
          ref: self.refDeId(data.id),
          carpetaId: carpetaId
        };
      });
    });
  },

  // Atajos equivalentes a los dos endpoints del Python.
  subirFotoMaterial: function(file) {
    return this.subirArchivo(file, this.CARPETA_MATERIALES, {
      permitidas: this.EXT_IMAGEN,
      mensajeError: this.ERROR_IMAGEN
    });
  },

  subirArchivoPizarra: function(pizarraId, file) {
    var self = this;
    return this.carpetaPizarra(pizarraId).then(function(carpetaId) {
      return self.subirArchivo(file, carpetaId, {
        permitidas: self.EXT_PIZARRA,
        mensajeError: self.ERROR_PIZARRA
      });
    });
  },

  // Evita nombres raros en Drive sin perder la extension original.
  _nombreSeguro: function(nombre) {
    var limpio = String(nombre || 'archivo').replace(/[\\/\r\n\t]/g, '_').trim();
    return limpio.slice(0, 120) || 'archivo';
  },

  // ============================================================
  // VISUALIZACION (blob URLs autenticados)
  // ============================================================

  // Descarga el archivo con el token y devuelve un blob: URL usable en
  // <img src>, <audio src>, <iframe src> o window.open.
  // Cachea por fileId: la segunda llamada no vuelve a descargar.
  urlDeVisualizacion: function(refOId) {
    var self = this;
    var fileId = this.idDeRef(refOId) || refOId;
    if (!fileId) return Promise.reject(new Error('Referencia de archivo invalida'));

    var cacheado = this._urls[fileId];
    if (cacheado) return Promise.resolve(cacheado.url);
    if (this._descargas[fileId]) return this._descargas[fileId];

    var token;
    try { token = this.getToken(); } catch (err) { return Promise.reject(err); }

    var promesa = fetch(this._conUnidad(this.DRIVE_API + '/' + encodeURIComponent(fileId) + '?alt=media'), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      if (!r.ok) return self._errorDrive(r, 'No se pudo descargar el archivo de Drive');
      return r.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      self._urls[fileId] = { url: url, mimeType: blob.type, size: blob.size };
      self._orden.push(fileId);
      self._podarCache();
      delete self._descargas[fileId];
      return url;
    }).catch(function(err) {
      delete self._descargas[fileId];
      throw err;
    });

    this._descargas[fileId] = promesa;
    return promesa;
  },

  // Version conveniente: asigna el src cuando termina la descarga.
  // Sirve para <img>, <audio>, <video> e <iframe>.
  asignarSrc: function(elemento, refOId, alFallar) {
    return this.urlDeVisualizacion(refOId).then(function(url) {
      elemento.src = url;
      return url;
    }).catch(function(err) {
      if (typeof alFallar === 'function') alFallar(err);
      else if (elemento.alt !== undefined) elemento.alt = 'No se pudo cargar: ' + err.message;
      throw err;
    });
  },

  // Prepara un <audio> o un <video> con blob: URL. El seek funciona sobre el
  // blob, pero los webm/ogg sin duracion en cabecera reportan
  // duration = Infinity; este truco fuerza al navegador a calcularla.
  //
  // Sirve para ambos porque <audio> y <video> comparten la interfaz
  // HTMLMediaElement: mismos duration, currentTime y eventos.
  prepararMedia: function(medio, refOId) {
    return this.asignarSrc(medio, refOId).then(function(url) {
      medio.addEventListener('loadedmetadata', function fijarDuracion() {
        if (medio.duration === Infinity || isNaN(medio.duration)) {
          medio.currentTime = 1e101;
          medio.addEventListener('timeupdate', function volver() {
            medio.removeEventListener('timeupdate', volver);
            medio.currentTime = 0;
          });
        }
        medio.removeEventListener('loadedmetadata', fijarDuracion);
      });
      return url;
    });
  },

  // Alias historico: se llamaba asi cuando solo habia audio.
  prepararAudio: function(audio, refOId) {
    return this.prepararMedia(audio, refOId);
  },

  // Abre el archivo en otra pestana (usado por los PDF). Se prefiere el
  // blob: URL; si el navegador bloquea la navegacion a blob:, el fallback
  // es la vista previa de Drive, que si pide login pero funciona.
  abrirEnPestana: function(refOId) {
    var self = this;
    return this.urlDeVisualizacion(refOId).then(function(url) {
      var w = window.open(url, '_blank');
      if (!w) {
        var fileId = self.idDeRef(refOId) || refOId;
        window.open('https://drive.google.com/file/d/' + fileId + '/view', '_blank');
      }
      return url;
    });
  },

  // URL de respaldo, NO usable en <img> con archivos privados. Existe solo
  // para enlaces "abrir en Drive" donde el usuario ya tiene sesion iniciada.
  urlEnDrive: function(refOId) {
    var fileId = this.idDeRef(refOId) || refOId;
    return 'https://drive.google.com/file/d/' + fileId + '/view';
  },

  // ---- gestion de memoria de los object URLs ----

  liberarUrl: function(refOId) {
    var fileId = this.idDeRef(refOId) || refOId;
    var entrada = this._urls[fileId];
    if (!entrada) return false;
    URL.revokeObjectURL(entrada.url);
    delete this._urls[fileId];
    var i = this._orden.indexOf(fileId);
    if (i !== -1) this._orden.splice(i, 1);
    return true;
  },

  liberarTodo: function() {
    var self = this;
    Object.keys(this._urls).forEach(function(id) {
      URL.revokeObjectURL(self._urls[id].url);
    });
    this._urls = {};
    this._orden = [];
  },

  // Libera los blobs mas antiguos cuando la cache pasa del limite.
  _podarCache: function() {
    while (this._orden.length > this.LIMITE_CACHE) {
      this.liberarUrl(this._orden[0]);
    }
  },

  // ============================================================
  // METADATA Y BORRADO
  // ============================================================

  metadatos: function(refOId) {
    var self = this;
    var fileId = this.idDeRef(refOId) || refOId;
    var token = this.getToken();
    return fetch(this._conUnidad(this.DRIVE_API + '/' + encodeURIComponent(fileId) +
      '?fields=id,name,mimeType,size,createdTime'), {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      if (!r.ok) return self._errorDrive(r, 'No se pudo leer el archivo en Drive');
      return r.json();
    });
  },

  existe: function(refOId) {
    return this.metadatos(refOId).then(function() { return true; })
      .catch(function() { return false; });
  },

  // Borrado definitivo. Libera tambien el blob cacheado.
  borrarArchivo: function(refOId) {
    var self = this;
    var fileId = this.idDeRef(refOId) || refOId;
    if (!fileId) return Promise.resolve(false);
    var token;
    try { token = this.getToken(); } catch (err) { return Promise.reject(err); }

    return fetch(this._conUnidad(this.DRIVE_API + '/' + encodeURIComponent(fileId)), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r) {
      self.liberarUrl(fileId);
      if (r.status === 404) return false;  // ya no existia
      if (!r.ok) return self._errorDrive(r, 'No se pudo borrar el archivo de Drive');
      return true;
    });
  },

  // Manda el archivo a la papelera en vez de borrarlo. Es lo que usa la app
  // para TODO borrado: la fila del Sheet se puede deshacer y el archivo tiene
  // que poder volver con ella (restaurarDePapelera). Nada se destruye de
  // forma permanente desde la app; vaciar la papelera es decision humana.
  moverAPapelera: function(refOId) {
    return this._cambiarPapelera(refOId, true, 'No se pudo mover el archivo a la papelera');
  },

  restaurarDePapelera: function(refOId) {
    return this._cambiarPapelera(refOId, false, 'No se pudo restaurar el archivo de la papelera');
  },

  _cambiarPapelera: function(refOId, trashed, mensajeError) {
    var self = this;
    var fileId = this.idDeRef(refOId) || refOId;
    if (!fileId) return Promise.resolve(false);
    var token;
    try { token = this.getToken(); } catch (err) { return Promise.reject(err); }

    return fetch(this._conUnidad(this.DRIVE_API + '/' + encodeURIComponent(fileId)), {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: trashed })
    }).then(function(r) {
      if (trashed) self.liberarUrl(fileId);
      if (r.status === 404) return false;  // ya no existe (papelera vaciada)
      if (!r.ok) return self._errorDrive(r, mensajeError);
      return true;
    });
  },

  // OPT-IN, no se usa por defecto: hace el archivo publico para cualquiera
  // con el enlace y devuelve una URL directa que si sirve en <img src>.
  // Util solo si algun dia hace falta compartir material con un cliente.
  publicarArchivo: function(refOId) {
    var self = this;
    var fileId = this.idDeRef(refOId) || refOId;
    var token = this.getToken();
    return fetch(this._conUnidad(this.DRIVE_API + '/' + encodeURIComponent(fileId) + '/permissions'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    }).then(function(r) {
      if (!r.ok) return self._errorDrive(r, 'No se pudo publicar el archivo');
      return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w2000';
    });
  },

  // ============================================================
  // ERRORES
  // ============================================================

  // Traduce la respuesta de error de Drive a un Error con mensaje util.
  _errorDrive: function(response, mensajeBase) {
    return response.json().then(function(data) {
      var detalle = data && data.error ? data.error.message : '';
      throw new Error(detalle ? mensajeBase + ': ' + detalle : mensajeBase);
    }, function() {
      throw new Error(mensajeBase + ' (HTTP ' + response.status + ')');
    });
  }
};

// Libera los object URLs al cerrar/recargar para no dejar blobs colgando.
window.addEventListener('pagehide', function() { DriveFiles.liberarTodo(); });

window.DriveFiles = DriveFiles;
