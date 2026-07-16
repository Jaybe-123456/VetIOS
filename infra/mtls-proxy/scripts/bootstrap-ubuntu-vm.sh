#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  certbot \
  curl \
  docker.io \
  docker-compose-v2 \
  openssl \
  ufw

systemctl enable --now docker

install -d -m 0750 /opt/vetios/mtls-proxy
install -d -m 0750 /opt/vetios/mtls/certs
install -d -m 0700 /opt/vetios/mtls/secrets

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "VM prerequisites are ready. Copy infra/mtls-proxy into /opt/vetios/mtls-proxy next."
