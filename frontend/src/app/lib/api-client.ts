/**
 * Browser-side calls to the app's API routes.
 *
 * The session travels in its HttpOnly cookie. A call fails with an ApiError
 * that keeps the HTTP status, which the connection banner and the retry
 * policy read.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiFetchOptions = {
  method?: "GET" | "POST";
  /** A plain object is sent as JSON, FormData as is */
  body?: Record<string, unknown> | FormData;
  signal?: AbortSignal;
};

// Refusals from Odoo (UserError, AccessError): their text is written for
// the user, in the user's language
const ODOO_REFUSAL_STATUSES = new Set([400, 403]);

/**
 * What to tell the user about a failed request: Odoo's own message when it
 * refused the action, otherwise the caller's translated fallback.
 */
export const userErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError && ODOO_REFUSAL_STATUSES.has(error.status)
    ? error.message
    : fallback;

export const apiFetch = async <T>(
  path: string,
  { method = "GET", body, signal }: ApiFetchOptions = {}
): Promise<T> => {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
};
