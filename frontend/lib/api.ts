/**
 * Single place that talks to the REST API.
 * - Auth tokens live in httpOnly cookies set by the backend, so we only send
 *   `credentials: 'include'`. Never store tokens in localStorage/sessionStorage.
 * - Never talk to MongoDB (or Stripe secret / FXRatesAPI) from the frontend.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | null,
  ) {
    super(
      Array.isArray(body?.message)
        ? body.message.join(', ')
        : (body?.message ?? `Request failed with status ${status}`),
    );
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}
