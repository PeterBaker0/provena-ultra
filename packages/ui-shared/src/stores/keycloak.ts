import Keycloak from "keycloak-js";
import { KEYCLOAK_AUTH_ENDPOINT } from "../queries/endpoints";
import { KEYCLOAK_CLIENT_ID, KEYCLOAK_REALM } from "../config";

// Setup Keycloak instance as needed
// Pass initialization options as required or leave blank to load from 'keycloak.json'

const keycloakConfig = {
  realm: KEYCLOAK_REALM,
  url: KEYCLOAK_AUTH_ENDPOINT,
  clientId: KEYCLOAK_CLIENT_ID,
};

export const keycloak = new Keycloak(keycloakConfig);

/**
 * Redirect URI without the URL hash. keycloak-js defaults to `location.href`, which includes
 * `#...`; OIDC responses add `iss` (and other params) in the fragment, so the next login
 * request can send a `redirect_uri` that repeats `iss` and breaks PKCE / nonce validation —
 * the token endpoint may succeed while keycloak-js then clears tokens and leaves the UI logged out.
 */
export function getKeycloakRedirectUri(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

/**
 * Passed to `ReactKeycloakProvider` + `keycloak.init()`.
 * - PKCE is required for public clients on modern Keycloak.
 * - `checkLoginIframe: false` avoids third-party cookie / iframe issues after redirect that
 *   leave the client stuck on "login" (token callback never completes reliably).
 * - Explicit `openid` scope ensures an ID token (react-keycloak core treats session as
 *   authenticated only when both access + ID tokens exist).
 * - Merge `redirectUri: getKeycloakRedirectUri()` in the app (see App.tsx); do not put it here
 *   so it is evaluated when the provider mounts, not at module load.
 */
export const KEYCLOAK_INIT_OPTIONS = {
  onLoad: "check-sso" as const,
  pkceMethod: "S256" as const,
  checkLoginIframe: false,
  scope: "openid profile email",
};
