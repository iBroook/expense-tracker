// Capa de acceso a datos. Antes pegaba contra el backend local en Python
// (proxy hacia Google Sheets); ahora delega en AgenciaSheets, que habla
// directo con la API de Sheets usando el token OAuth de la app.
// Se conserva el objeto Api como fachada para no tocar el resto de la app.
const Api = (() => {
  return {
    // Ya no existe el endpoint /api/config: el nombre es fijo.
    getConfig: () => Promise.resolve({ agencia_nombre: "Agencia" }),
    getSheet: (name) => AgenciaSheets.getSheet(name),
    createRow: (name, data) => AgenciaSheets.createRow(name, data),
    updateRow: (name, id, updates) => AgenciaSheets.updateRow(name, id, updates),
    deleteRow: (name, id) => AgenciaSheets.deleteRow(name, id),
    // uploadFoto / uploadPizarraArchivo -> DriveFiles (material.js, pizarra.js)
    // askPrice -> PromptModal.pedirPrecio (kanban.js, material.js, resumen.js)
  };
})();
