#!/usr/bin/env bash
set -euo pipefail

: "${VETIOS_MTLS_DOMAIN:=mtls.vetios.tech}"
: "${VETIOS_MTLS_CERT_DIR:=/opt/vetios/mtls/certs}"
: "${VETIOS_MTLS_PROXY_DIR:=/opt/vetios/mtls-proxy}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

live_dir="/etc/letsencrypt/live/${VETIOS_MTLS_DOMAIN}"

install -d -o root -g 101 -m 0750 "${VETIOS_MTLS_CERT_DIR}"

if [[ ! -f "${live_dir}/fullchain.pem" || ! -f "${live_dir}/privkey.pem" ]]; then
  echo "Let's Encrypt certificate is missing for ${VETIOS_MTLS_DOMAIN}." >&2
  exit 1
fi

if [[ ! -f "${VETIOS_MTLS_CERT_DIR}/client-ca.crt" ]]; then
  echo "Client CA bundle is missing at ${VETIOS_MTLS_CERT_DIR}/client-ca.crt." >&2
  exit 1
fi

install -o root -g 101 -m 0644 "${live_dir}/fullchain.pem" "${VETIOS_MTLS_CERT_DIR}/server.crt"
install -o root -g 101 -m 0640 "${live_dir}/privkey.pem" "${VETIOS_MTLS_CERT_DIR}/server.key"
chown root:101 "${VETIOS_MTLS_CERT_DIR}/client-ca.crt"
chmod 0644 "${VETIOS_MTLS_CERT_DIR}/client-ca.crt"

if [[ -f "${VETIOS_MTLS_PROXY_DIR}/docker-compose.production.yml" ]]; then
  docker compose \
    --project-directory "${VETIOS_MTLS_PROXY_DIR}" \
    --env-file "${VETIOS_MTLS_PROXY_DIR}/.env.production" \
    -f "${VETIOS_MTLS_PROXY_DIR}/docker-compose.production.yml" \
    up -d --build --force-recreate
fi
