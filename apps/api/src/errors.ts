/**
 * FastAPI-compatible error responses: HTTP errors carry `{"detail": ...}`.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export const badRequest = (detail: string): ApiError => new ApiError(400, detail);
export const unauthorized = (detail: string): ApiError => new ApiError(401, detail);
export const forbidden = (detail: string): ApiError => new ApiError(403, detail);
export const notFound = (detail: string): ApiError => new ApiError(404, detail);
export const internalError = (detail: string): ApiError => new ApiError(500, detail);
