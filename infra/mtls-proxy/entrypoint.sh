#!/usr/bin/env sh
set -eu

: "${VETIOS_MTLS_PROXY_SECRET_FILE:=/run/secrets/vetios_mtls_proxy_secret}"
: "${VETIOS_UPSTREAM_HOST:=www.vetios.tech}"
: "${VETIOS_UPSTREAM_PORT:=443}"
: "${VETIOS_MTLS_PROXY_CERT:=/etc/envoy/certs/server.crt}"
: "${VETIOS_MTLS_PROXY_KEY:=/etc/envoy/certs/server.key}"
: "${VETIOS_MTLS_CLIENT_CA:=/etc/envoy/certs/client-ca.crt}"

if [ -z "${VETIOS_MTLS_PROXY_SECRET:-}" ] && [ -f "$VETIOS_MTLS_PROXY_SECRET_FILE" ]; then
  VETIOS_MTLS_PROXY_SECRET="$(tr -d '\r\n' < "$VETIOS_MTLS_PROXY_SECRET_FILE")"
  export VETIOS_MTLS_PROXY_SECRET
fi

: "${VETIOS_MTLS_PROXY_SECRET:?VETIOS_MTLS_PROXY_SECRET or its secret file is required}"

if [ "${#VETIOS_MTLS_PROXY_SECRET}" -lt 32 ]; then
  echo "VETIOS_MTLS_PROXY_SECRET must be at least 32 characters" >&2
  exit 1
fi

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

envsubst '${VETIOS_MTLS_PROXY_SECRET} ${VETIOS_UPSTREAM_HOST} ${VETIOS_UPSTREAM_PORT} ${VETIOS_MTLS_PROXY_CERT} ${VETIOS_MTLS_PROXY_KEY} ${VETIOS_MTLS_CLIENT_CA}' \
  < /etc/envoy/envoy.yaml.template \
  > /tmp/envoy.yaml

exec envoy -c /tmp/envoy.yaml --log-level "${VETIOS_ENVOY_LOG_LEVEL:-info}"
