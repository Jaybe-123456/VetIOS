#!/usr/bin/env bash
set -euo pipefail

: "${VETIOS_MTLS_DOMAIN:=mtls.vetios.tech}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL is required}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --keep-until-expiring \
  --preferred-challenges http \
  --email "$LETSENCRYPT_EMAIL" \
  --domain "$VETIOS_MTLS_DOMAIN"

bash "$(dirname "$0")/sync-production-certs.sh"

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 "$(dirname "$0")/sync-production-certs.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/vetios-mtls-sync

echo "Server certificate installed for $VETIOS_MTLS_DOMAIN."
