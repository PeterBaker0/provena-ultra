/**
 * Test-token signing helper. Only honoured when AUTH_TEST_SHARED_SECRET is
 * configured (integration tests / local development without Keycloak).
 */
import { SignJWT } from "jose";

export interface TestTokenInput {
  username: string;
  email?: string;
  roles?: string[];
  secret: string;
  expiresInSeconds?: number;
}

export const signTestToken = async (input: TestTokenInput): Promise<string> => {
  const secret = new TextEncoder().encode(input.secret);
  return new SignJWT({
    preferred_username: input.username,
    email: input.email ?? `${input.username}@test.local`,
    realm_access: { roles: input.roles ?? [] },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${input.expiresInSeconds ?? 3600}s`)
    .sign(secret);
};
