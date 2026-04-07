import type { JWTPayload } from "jose";

export type AccessLevel = "general" | "read" | "write" | "admin";

export interface AuthenticatedUser {
  username: string;
  roles: string[];
  token: string;
  claims: JWTPayload;
}

export interface AppBindings {
  Variables: {
    user?: AuthenticatedUser;
  };
}
