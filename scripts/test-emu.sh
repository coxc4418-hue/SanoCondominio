#!/bin/sh
# Reinicia los datos del emulador, crea 3 sedes de prueba y corre la prueba E2E.
cd "$(dirname "$0")"
curl -s -X DELETE "http://127.0.0.1:8380/emulator/v1/projects/sano-condominio/databases/(default)/documents" > /dev/null
curl -s -X DELETE "http://127.0.0.1:9399/emulator/v1/projects/sano-condominio/accounts" > /dev/null
rm -f .accounts-emu.json
node provision.mjs 3 --emu > /dev/null && node e2e.mjs "http://127.0.0.1:5171" "${1:-shots}"
