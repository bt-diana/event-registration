// Small fetch wrapper for the auth routes in api/openapi.yaml. Same origin (dev proxy in vite.config.ts).

export type Role = "user" | "organizer";
export type Me = { role: Role; id: string; email: string; name: string };
export type LoginBody = { email: string; password: string };
export type SignupBody = { email: string; name: string; password: string };

// The role word in the cookie and the answers is not the path word.
const ROLE_PATH: Record<Role, string> = { user: "users", organizer: "organizers" };

// status 0 means the request did not reach the server (network error).
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 0 ? "Network error" : `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, { ...init, credentials: "same-origin" });
  } catch {
    throw new ApiError(0);
  }
}

function post(path: string, body?: unknown): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function account(response: Response): Promise<Me> {
  if (!response.ok) throw new ApiError(response.status);
  return (await response.json()) as Me;
}

// 200 gives the account, 401 gives null (logged out), anything else throws.
export async function fetchMe(): Promise<Me | null> {
  const response = await request("/auth/me");
  if (response.status === 401) return null;
  return account(response);
}

export async function login(role: Role, body: LoginBody): Promise<Me> {
  return account(await post(`/auth/${ROLE_PATH[role]}/login`, body));
}

export async function signup(role: Role, body: SignupBody): Promise<Me> {
  return account(await post(`/auth/${ROLE_PATH[role]}/signup`, body));
}

export async function logout(role: Role): Promise<void> {
  const response = await post(`/auth/${ROLE_PATH[role]}/logout`);
  if (response.status !== 204) throw new ApiError(response.status);
}
