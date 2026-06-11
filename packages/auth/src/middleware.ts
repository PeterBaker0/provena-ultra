/**
 * Hono middlewares replicating the legacy KeycloakFastAPI dependencies:
 *  - `requireUser`: any authenticated user (general dependency)
 *  - `requireAllRoles([...])`: ALL listed realm roles required
 *  - `requireAnyRole([...])`: ANY listed realm role grants access
 */
import type { Context, MiddlewareHandler } from "hono";
import { TokenVerificationError, userFromToken } from "./verifier.js";
import type { AuthEnv, AuthenticatedUser } from "./types.js";

const unauthorized = (c: Context, detail: string) =>
  c.json({ detail }, 401, { "WWW-Authenticate": "Bearer" });

const extractBearer = (c: Context): string | null => {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
};

export const requireUser = (): MiddlewareHandler<AuthEnv> => {
  return async (c, next) => {
    const token = extractBearer(c);
    if (!token) return unauthorized(c, "Not authenticated");
    try {
      const user = await userFromToken(token);
      c.set("user", user);
      c.set("accessRoles", []);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        return unauthorized(c, error.message);
      }
      throw error;
    }
    return next();
  };
};

const roleError = (roles: string[]): string =>
  `You are missing the required role(s) to access this resource: ${roles.join(", ")}.`;

/** Requires ALL of the given realm roles (legacy get_all_protected_role_dependency). */
export const requireAllRoles = (requiredRoles: string[]): MiddlewareHandler<AuthEnv> => {
  return async (c, next) => {
    const token = extractBearer(c);
    if (!token) return unauthorized(c, "Not authenticated");
    let user: AuthenticatedUser;
    try {
      user = await userFromToken(token);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        return unauthorized(c, error.message);
      }
      throw error;
    }
    const missing = requiredRoles.filter((role) => !user.roles.includes(role));
    if (missing.length > 0) {
      return unauthorized(c, roleError(requiredRoles));
    }
    c.set("user", user);
    c.set("accessRoles", requiredRoles);
    return next();
  };
};

/** Requires ANY of the given realm roles (legacy get_any_protected_role_dependency). */
export const requireAnyRole = (allowedRoles: string[]): MiddlewareHandler<AuthEnv> => {
  return async (c, next) => {
    const token = extractBearer(c);
    if (!token) return unauthorized(c, "Not authenticated");
    let user: AuthenticatedUser;
    try {
      user = await userFromToken(token);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        return unauthorized(c, error.message);
      }
      throw error;
    }
    const granted = allowedRoles.filter((role) => user.roles.includes(role));
    if (granted.length === 0) {
      return unauthorized(c, roleError(allowedRoles));
    }
    c.set("user", user);
    c.set("accessRoles", granted);
    return next();
  };
};

export const getUser = (c: Context<AuthEnv>): AuthenticatedUser => {
  const user = c.get("user");
  if (!user) throw new Error("No authenticated user on context - missing middleware?");
  return user;
};
