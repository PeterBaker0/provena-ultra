import { describe, expect, it } from "vitest";
import type { ProvenaConfig } from "@provena/config";
import { buildCorsMiddlewareOptions, parseAllowedHosts } from "./cors.js";

const baseConfig = {
  NODE_ENV: "development" as const,
  API_PORT: 8080,
  API_PUBLIC_URL: "http://localhost:8080",
  CORS_ORIGINS: "*",
  DATABASE_URL: "postgres://provena:provena@localhost:8432/provena",
  KEYCLOAK_ISSUER: "http://localhost:8081/realms/provena",
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_REGION: "us-east-1",
  STORAGE_ACCESS_KEY: "x",
  STORAGE_SECRET_KEY: "x",
  STORAGE_BUCKET: "b",
  STORAGE_DATASET_PATH: "datasets",
  STORAGE_STS_ROLE_ARN: "arn:aws:iam::000000000000:role/x",
  STORAGE_CREDENTIAL_DURATION_SECONDS: 3600,
  STORAGE_FORCE_PATH_STYLE: true,
  HANDLE_PREFIX: "10378.1",
  SMTP_HOST: "localhost",
  SMTP_PORT: 8125,
  SMTP_SECURE: false,
  EMAIL_FROM: "a@b",
  ACCESS_REQUEST_EMAIL_ADDRESS: "c@d",
  WORKER_EMBEDDED: true,
  VERSION_TAG: "2.0.0",
};

describe("parseAllowedHosts", () => {
  it("merges PUBLIC_HOST and CORS_ALLOWED_HOSTS", () => {
    const config: ProvenaConfig = {
      ...baseConfig,
      PUBLIC_HOST: "adria.it.csiro.au",
      CORS_ALLOWED_HOSTS: "localhost",
    };
    expect(parseAllowedHosts(config)).toEqual(["adria.it.csiro.au", "localhost"]);
  });
});

describe("buildCorsMiddlewareOptions", () => {
  it("allows any port on configured hostnames", () => {
    const config: ProvenaConfig = {
      ...baseConfig,
      PUBLIC_HOST: "adria.it.csiro.au",
      CORS_ALLOWED_HOSTS: "localhost",
    };
    const { origin } = buildCorsMiddlewareOptions(config);
    expect(typeof origin).toBe("function");
    const matcher = origin as (origin: string) => string | null | undefined;
    expect(matcher("http://adria.it.csiro.au:8001")).toBe("http://adria.it.csiro.au:8001");
    expect(matcher("http://adria.it.csiro.au:8080")).toBe("http://adria.it.csiro.au:8080");
    expect(matcher("http://evil.example:8001")).toBeNull();
  });
});
