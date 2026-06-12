/**
 * CORS policy for browser UIs (four dev ports + optional remote hostname).
 *
 * When `PUBLIC_HOST` / `CORS_ALLOWED_HOSTS` are set, any origin on those hostnames
 * is allowed (all ports). This covers SSH port-forward access via e.g.
 * `http://adria.it.csiro.au:8001` → API on `:8080` without listing every port in
 * `CORS_ORIGINS`.
 */
import type { ProvenaConfig } from "@provena/config";

const ALLOW_HEADERS = ["Authorization", "Content-Type", "X-Requested-With"];
const ALLOW_METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];

export const parseAllowedHosts = (config: ProvenaConfig): string[] => {
  const hosts = new Set<string>();
  if (config.PUBLIC_HOST) {
    hosts.add(config.PUBLIC_HOST.trim());
  }
  if (config.CORS_ALLOWED_HOSTS) {
    for (const host of config.CORS_ALLOWED_HOSTS.split(",")) {
      const trimmed = host.trim();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return [...hosts];
};

export const buildCorsMiddlewareOptions = (config: ProvenaConfig) => {
  const origins = config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  const allowedHosts = parseAllowedHosts(config);

  if (allowedHosts.length > 0) {
    return {
      origin: (origin: string) => {
        if (!origin) {
          return undefined;
        }
        try {
          const { hostname } = new URL(origin);
          if (allowedHosts.includes(hostname)) {
            return origin;
          }
        } catch {
          /* ignore invalid Origin */
        }
        return null;
      },
      credentials: true,
      allowHeaders: ALLOW_HEADERS,
      allowMethods: ALLOW_METHODS,
    };
  }

  if (origins.includes("*")) {
    return {
      origin: "*",
      credentials: false,
      allowHeaders: ALLOW_HEADERS,
      allowMethods: ALLOW_METHODS,
    };
  }

  return {
    origin: origins,
    credentials: true,
    allowHeaders: ALLOW_HEADERS,
    allowMethods: ALLOW_METHODS,
  };
};
