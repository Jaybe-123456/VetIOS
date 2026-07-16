FROM envoyproxy/envoy:v1.36.9@sha256:7b5269f49edb8d6265826837d89e96f66dc593e44963632754cf59127f8a7879

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY envoy.yaml.template /etc/envoy/envoy.yaml.template
COPY entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh \
    && chmod 0555 /entrypoint.sh \
    && chmod 0444 /etc/envoy/envoy.yaml.template

USER envoy

EXPOSE 9443 8080

ENTRYPOINT ["/entrypoint.sh"]
