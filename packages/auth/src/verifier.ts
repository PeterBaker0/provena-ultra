/**
 * Keycloak JWT verification.
 *
 * Production: RS256 against the realm JWKS endpoint
 *   (`<issuer>/protocol/openid-connect/certs`), audience not enforced
 *   (matching legacy behaviour), expiry enforced.
 * Test mode: when `AUTH_TEST_SHARED_SECRET` is configured, HS256-signed
 *   tokens are also accepted - used by integration tests only.
 */
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { getConfig } from "@provena/config";
import type { AuthenticatedUser } from "./types.js";

export class TokenVerificationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

type JwksResolver = ReturnType<typeof createRemoteJWKSet>;

let jwks: JwksResolver | undefined;
let jwksIssuer: string | undefined;

const getJwks = (): JwksResolver => {
  const config = getConfig();
  if (!jwks || jwksIssuer !== config.KEYCLOAK_ISSUER) {
    const url =
      config.KEYCLOAK_JWKS_URL ??
      `${config.KEYCLOAK_ISSUER.replace(/\/$/, "")}/protocol/openid-connect/certs`;
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 10 * 60 * 1000,
    });
    jwksIssuer = config.KEYCLOAK_ISSUER;
  }
  return jwks;
};

const verifyToken = async (token: string): Promise<JWTPayload> => {
  const config = getConfig();

  /* Test-mode HS256 path (integration tests). */
  if (config.AUTH_TEST_SHARED_SECRET) {
    try {
      const secret = new TextEncoder().encode(config.AUTH_TEST_SHARED_SECRET);
      const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      return payload;
    } catch {
      /* fall through to JWKS verification */
    }
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      algorithms: ["RS256"],
      /* No audience verification - matches legacy verify_aud: False. */
    });
    return payload;
  } catch (error) {
    throw new TokenVerificationError(
      `Could not validate credentials: ${(error as Error).message}`,
    );
  }
};

interface RealmAccessClaim {
  roles?: string[];
}

export const userFromToken = async (token: string): Promise<AuthenticatedUser> => {
  const payload = await verifyToken(token);
  const username = payload.preferred_username;
  if (typeof username !== "string" || username.length === 0) {
    throw new TokenVerificationError("Token had incorrect structure.");
  }
  const realmAccess = (payload.realm_access ?? {}) as RealmAccessClaim;
  const roles = Array.isArray(realmAccess.roles) ? realmAccess.roles : [];
  const email = typeof payload.email === "string" ? payload.email : null;
  return { username, email, roles, accessToken: token };
};

/** Reset cached JWKS (tests / config changes). */
export const resetVerifierCache = (): void => {
  jwks = undefined;
  jwksIssuer = undefined;
};
