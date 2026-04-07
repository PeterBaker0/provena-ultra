import { z } from "zod";

export const UiEnvironmentSchema = z.object({
  VITE_AUTH_API_ENDPOINT: z.string().url(),
  VITE_DATA_STORE_API_ENDPOINT: z.string().url(),
  VITE_REGISTRY_API_ENDPOINT: z.string().url(),
  VITE_PROV_API_ENDPOINT: z.string().url(),
  VITE_SEARCH_API_ENDPOINT: z.string().url(),
  VITE_JOB_API_ENDPOINT: z.string().url(),
  VITE_WARMER_API_ENDPOINT: z.string().url(),
  VITE_KEYCLOAK_AUTH_ENDPOINT: z.string().url(),
  VITE_LANDING_PAGE_LINK: z.string().url(),
  VITE_DATA_STORE_LINK: z.string().url(),
  VITE_PROV_STORE_LINK: z.string().url(),
  VITE_REGISTRY_LINK: z.string().url(),
  VITE_DOCUMENTATION_BASE_LINK: z.string().url(),
  VITE_CONTACT_US_LINK: z.string().url(),
  VITE_KEYCLOAK_CLIENT_ID: z.string().optional(),
  VITE_KEYCLOAK_REALM: z.string().optional(),
  VITE_STAGE: z.string().optional(),
  VITE_THEME_ID: z.string().optional(),
});

export type UiEnvironment = z.infer<typeof UiEnvironmentSchema>;

export const resolveUiEnvironment = (
  source: Record<string, unknown>,
): UiEnvironment =>
  UiEnvironmentSchema.parse(source);

export const endpointKeys = {
  auth: "VITE_AUTH_API_ENDPOINT",
  dataStore: "VITE_DATA_STORE_API_ENDPOINT",
  registry: "VITE_REGISTRY_API_ENDPOINT",
  prov: "VITE_PROV_API_ENDPOINT",
  search: "VITE_SEARCH_API_ENDPOINT",
  jobs: "VITE_JOB_API_ENDPOINT",
  warmer: "VITE_WARMER_API_ENDPOINT",
} as const;
