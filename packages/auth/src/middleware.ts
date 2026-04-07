import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppBindings, AuthenticatedUser } from "./types";
import { verifyJwtFromRequest } from "./jwt";

const parseBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
};

export const optionalAuthMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) {
    await next();
    return;
  }

  const user = await verifyJwtFromRequest(token);
  c.set("user", user);

  await next();
});

export const requiredAuthMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const token = parseBearerToken(c.req.header("authorization"));
  if (!token) {
    throw new HTTPException(401, { message: "Missing bearer token" });
  }

  const user = await verifyJwtFromRequest(token);
  c.set("user", user);

  await next();
});

export const getCurrentUser = (c: {
  get: (key: "user") => AuthenticatedUser | undefined;
}): AuthenticatedUser => {
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return user;
};

export const requireAnyRole = (
  user: AuthenticatedUser,
  roles: readonly string[],
): void => {
  if (roles.length === 0) {
    return;
  }
  const hasRole = roles.some((role) => user.roles.includes(role));
  if (!hasRole) {
    throw new HTTPException(403, {
      message: `Missing required role. One of [${roles.join(", ")}] is required.`,
    });
  }
};
