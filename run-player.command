#!/bin/bash
set -euo pipefail

# Change to repository directory
cd "$(dirname "$0")"

resolve_port() {
  local candidate=""

  if [[ -n "${PORT:-}" ]] && [[ "${PORT}" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )); then
    echo "${PORT}"
    return
  fi

  if [[ -f "extra.conf" ]]; then
    candidate="$(
      awk -F'[=:]' '
        BEGIN { IGNORECASE = 1 }
        /^[[:space:]]*#/ { next }
        NF < 2 { next }
        {
          key = $1
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
          if (tolower(key) != "port") { next }
          value = $2
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
          gsub(/^"|"$/, "", value)
          gsub(/^'\''|'\''$/, "", value)
          if (value ~ /^[0-9]+$/ && value >= 1 && value <= 65535) {
            print value
            exit
          }
        }
      ' "extra.conf"
    )"
  fi

  if [[ -n "${candidate}" ]]; then
    echo "${candidate}"
  else
    echo "3000"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node.js v18 or newer: https://nodejs.org/"
  read -rp "Press Enter to exit..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js v18 or newer: https://nodejs.org/"
  read -rp "Press Enter to exit..." _
  exit 1
fi

echo "Starting djTRON player..."
APP_PORT="$(resolve_port)"
open "http://localhost:${APP_PORT}/"

# Start server
npm start
