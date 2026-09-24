/**
 * Browser-side calls to the app's API routes.
 *
 * Every call carries the Odoo session and fails with an ApiError that keeps
 * the HTTP status, which the connection banner and the retry policy read.
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
  sessionId: string | null;
  method?: "GET" | "POST";
  /** A plain object is sent as JSON, FormData as is */
  body?: Record<string, unknown> | FormData;
  signal?: AbortSignal;
};

export const apiFetch = async <T>(
  path: string,
  { sessionId, method = "GET", body, signal }: ApiFetchOptions
): Promise<T> => {
  if (!sessionId) {
    throw new ApiError(401, "You are not authenticated");
  }
  const headers: Record<string, string> = { "x-session-id": sessionId };
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
