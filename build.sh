#!/bin/sh
# Genera env.js a partir de variables de entorno.
#
# Sirve igual para GitHub Actions y para Cloudflare Pages (comando de build:
# "sh build.sh"). Sustituye al sed que parcheaba index.html en tiempo de
# despliegue: aquel dependia de una coincidencia exacta de texto y solo
# funcionaba en el workflow, asi que ni en local ni en Pages habia env.js.
#
# NO metas secretos aqui. env.js se sirve como archivo estatico y es legible
# por cualquiera que abra el sitio. La key de Anthropic vive como variable de
# entorno del proyecto (marcada como Secret) y solo la lee la funcion del
# servidor en functions/api/claude.js.

set -e

cat > env.js <<EOF
// Generado en tiempo de despliegue. No editar a mano ni commitear.
window.ENV_GOOGLE_CLIENT_ID = '${GOOGLE_CLIENT_ID}';
window.ENV_AGENCIA_SPREADSHEET_ID = '${AGENCIA_SPREADSHEET_ID}';
window.ENV_AGENCIA_DRIVE_ID = '${AGENCIA_DRIVE_ID}';
EOF

echo "env.js generado"

# Aviso temprano: sin estas dos, la app carga pero no puede iniciar sesion ni
# leer el spreadsheet de Agencia, y el fallo aparece recien en el navegador.
[ -n "${GOOGLE_CLIENT_ID}" ] || echo "AVISO: GOOGLE_CLIENT_ID vacio — el login de Google fallara"
[ -n "${AGENCIA_SPREADSHEET_ID}" ] || echo "AVISO: AGENCIA_SPREADSHEET_ID vacio — Agencia no cargara"
