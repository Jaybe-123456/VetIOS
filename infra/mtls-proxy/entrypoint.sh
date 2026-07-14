#!/usr/bin/env sh
set -eu

: "${VETIOS_MTLS_PROXY_SECRET:?VETIOS_MTLS_PROXY_SECRET is required}"
: "${VETIOS_UPSTREAM_HOST:=www.vetios.tech}"
: "${VETIOS_UPSTREAM_PORT:=443}"
: "${VETIOS_MTLS_PROXY_CERT:=/etc/envoy/certs/server.crt}"
: "${VETIOS_MTLS_PROXY_KEY:=/etc/envoy/certs/server.key}"
: "${VETIOS_MTLS_CLIENT_CA:=/etc/envoy/certs/client-ca.crt}"

if [ ! -f "$VETIOS_MTLS_PROXY_CERT" ]; then
  echo "Missing server certificate: $VETIOS_MTLS_PROXY_CERT" >&2
  exit 1
fi

if [ ! -f "$VETIOS_MTLS_PROXY_KEY" ]; then
  echo "Missing server private key: $VETIOS_MTLS_PROXY_KEY" >&2
  exit 1
fi

if [ ! -f "$VETIOS_MTLS_CLIENT_CA" ]; then
  echo "Missing client CA certificate bundle: $VETIOS_MTLS_CLIENT_CA" >&2
  exit 1
fi

envsubst < /etc/envoy/envoy.yaml.template > /tmp/envoy.yaml
exec envoy -c /tmp/envoy.yaml --log-level info
