#!/bin/sh
# Compila la API y el monitoreo para el arranque de deploy/replit/start.mjs (incluye dependencias de
# desarrollo: el monitoreo las usa para compilar y para sus scripts operativos con tsx).
set -eu
cd "$(dirname "$0")/../.."
export NEXT_TELEMETRY_DISABLED=1
(cd unified-ads-api && npm ci --include=dev && npm run build)
(cd media-monitoring-center && npm ci --include=dev && npm run build)
