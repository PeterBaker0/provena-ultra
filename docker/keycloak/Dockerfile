# Local Keycloak for docker compose — mirrors legacy provena/infrastructure/provena/keycloak/Dockerfile:
# - SPI providers from modules/*.jar → /opt/keycloak/providers/
# - Custom theme from themes/<name> → /opt/keycloak/themes/<name>
# Quarkus Keycloak (17+) requires `kc.sh build` so custom providers are baked into the server.
FROM quay.io/keycloak/keycloak:26.1

COPY provena/infrastructure/provena/keycloak/modules/*.jar /opt/keycloak/providers/

# Same layout as legacy WildFly image: themes copied by folder name (here: default).
COPY provena/infrastructure/provena/keycloak/themes/default /opt/keycloak/themes/default

RUN /opt/keycloak/bin/kc.sh build
