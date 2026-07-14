FROM envoyproxy/envoy:v1.31-latest

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext-base ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY envoy.yaml.template /etc/envoy/envoy.yaml.template
COPY entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh \
    && chmod +x /entrypoint.sh

EXPOSE 9443

ENTRYPOINT ["/entrypoint.sh"]
