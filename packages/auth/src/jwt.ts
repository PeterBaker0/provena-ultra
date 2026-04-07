import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getEnv } from "@provena/config";
import type { AuthenticatedUser } from "./types.js";

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return value
      .split(" ")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const extractRealmRoles = (payload: JWTPayload): string[] => {
  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  return toStringArray(realmAccess?.roles);
};

const extractClientRoles = (payload: JWTPayload): string[] => {
  const env = getEnv();
  const resourceAccess = payload.resource_access as
    | Record<string, { roles?: unknown }>
    | undefined;

  if (!resourceAccess) {
    return [];
  }

  const candidateClients = [env.KEYCLOAK_CLIENT_ID, env.KEYCLOAK_AUDIENCE];
  return candidateClients.flatMap((clientId) => toStringArray(resourceAccess[clientId]?.roles));
};

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

const getJwks = () => {
  if (jwks) {
    return jwks;
  }
  const env = getEnv();
  jwks = createRemoteJWKSet(new URL(env.KEYCLOAK_JWKS_URI));
  return jwks;
};

export const verifyBearerToken = async (token: string): Promise<AuthenticatedUser> => {
  const env = getEnv();
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: env.KEYCLOAK_ISSUER,
    audience: env.KEYCLOAK_AUDIENCE,
  });

  const preferredUsername =
    (typeof payload.preferred_username === "string" && payload.preferred_username) ||
    (typeof payload.sub === "string" && payload.sub) ||
    "unknown-user";

  const roles = dedupe([...extractRealmRoles(payload), ...extractClientRoles(payload)]);

  return {
    username: preferredUsername,
    roles,
    token,
    claims: payload,
  };
};

export const verifyJwtFromRequest = verifyBearerToken;
