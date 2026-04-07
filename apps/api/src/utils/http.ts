import type { Context } from "hono";

export interface StatusPayload {
  success: boolean;
  details?: string;
}

export const statusPayload = (success: boolean, details?: string): StatusPayload => ({
  success,
  ...(details ? { details } : {}),
});

export const statusResponse = (
  success: boolean,
  details?: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> => ({
  status: statusPayload(success, details),
  ...(extra ?? {}),
});

export const status = statusPayload;

export const ok = (payload: Record<string, unknown> = {}): Record<string, unknown> =>
  statusResponse(true, undefined, payload);

export const badRequest = (c: Context, details: string): Response =>
  c.json(statusResponse(false, details), 400);

export const parseJson = async (c: Context): Promise<Record<string, unknown>> => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON payload.");
  }
  return body as Record<string, unknown>;
};

export const parseJsonBody = parseJson;
export const parseJsonObject = parseJson;

export const parsePagination = (
  payload: Record<string, unknown>,
): { limit: number; offset: number } => {
  const pagination =
    payload.pagination && typeof payload.pagination === "object" && !Array.isArray(payload.pagination)
      ? (payload.pagination as Record<string, unknown>)
      : {};
  const limitRaw = Number(pagination.limit ?? payload.limit ?? 20);
  const offsetRaw = Number(pagination.offset ?? payload.offset ?? 0);
  return {
    limit: Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 20,
    offset: Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0,
  };
};

export const readPagination = parsePagination;

export const readStringQuery = (c: Context, key: string): string | undefined => {
  const value = c.req.query(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
};

export const withDatasetAlias = (payload: {
  status: unknown;
  records: unknown[];
  count: number;
}): Record<string, unknown> => ({
  ...payload,
  datasets: payload.records,
  items: payload.records,
  total: payload.count,
});

export const toIsoString = (value: Date): string => value.toISOString();
