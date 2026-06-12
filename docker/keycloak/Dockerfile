# Keycloak for Provena v2 - modern Keycloak with the restrict-client-auth
# SPI the legacy realm's authentication flows reference, plus (optionally)
# the legacy custom theme.
#
# The realm import file is produced by `pnpm keycloak:prepare-realm` from the
# legacy realm template and mounted at /opt/keycloak/data/import.
FROM quay.io/keycloak/keycloak:26.1 AS builder

# restrict-client-auth SPI (KC26-compatible release).
ADD --chown=keycloak:keycloak \
    https://github.com/sventorben/keycloak-restrict-client-auth/releases/download/v26.1.0/keycloak-restrict-client-auth.jar \
    /opt/keycloak/providers/keycloak-restrict-client-auth.jar

RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/

# Optional: copy the legacy theme by uncommenting (legacy FreeMarker themes
# may need adjustments for modern Keycloak):
# COPY ./themes/<theme-name> /opt/keycloak/themes/<theme-name>

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
