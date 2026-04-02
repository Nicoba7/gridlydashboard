type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.easee.com";

export type EaseeCommand = "start_charging" | "stop_charging";

export interface EaseeStatePayload {
  chargerId: string;
  charging: boolean;
  powerW: number;
  raw: unknown;
}

export interface EaseeCommandResult {
  success: boolean;
  message?: string;
}

export type EaseeTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class EaseeTransportError extends Error {
  constructor(
    public readonly code: EaseeTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "EaseeTransportError";
  }
}

export interface EaseeApiClient {
  login(userName: string, password: string): Promise<string>;
  getChargerState(token: string, chargerId: string): Promise<EaseeStatePayload>;
  sendCommand(token: string, chargerId: string, command: EaseeCommand): Promise<EaseeCommandResult>;
}

export interface EaseeHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): EaseeTransportError {
  if (status === 401 || status === 403) return new EaseeTransportError("AUTH_FAILURE", message, status, false);
  if (status === 404) return new EaseeTransportError("UNSUPPORTED_DEVICE", message, status, false);
  if (status === 408) return new EaseeTransportError("TIMEOUT", message, status, true);
  if (status === 429) return new EaseeTransportError("RATE_LIMIT", message, status, true);
  if (status >= 500) return new EaseeTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  return new EaseeTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export class EaseeHttpApiClient implements EaseeApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: EaseeHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(userName: string, password: string): Promise<string> {
    const payload = await this.callApi("/api/accounts/login", { method: "POST", body: { userName, password } });
    const root = payload as Record<string, unknown> | undefined;
    const token = String(root?.accessToken ?? root?.token ?? (root?.data as Record<string, unknown> | undefined)?.token ?? "").trim();
    if (!token) throw new EaseeTransportError("MALFORMED_RESPONSE", "Easee login response missing token.");
    return token;
  }

  async getChargerState(token: string, chargerId: string): Promise<EaseeStatePayload> {
    const payload = await this.callApi(`/api/chargers/${encodeURIComponent(chargerId)}/state`, { method: "GET", token });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;
    const powerW = toFiniteNumber(data?.totalPower) ?? toFiniteNumber(data?.power) ?? 0;
    const mode = String(data?.chargerOpMode ?? data?.status ?? "").toLowerCase();
    const charging = mode.includes("charge") || powerW > 0;
    return { chargerId, charging, powerW, raw: payload };
  }

  async sendCommand(token: string, chargerId: string, command: EaseeCommand): Promise<EaseeCommandResult> {
    await this.callApi(`/api/chargers/${encodeURIComponent(chargerId)}/commands/${command}`, { method: "POST", token, body: {} });
    return { success: true, message: `Easee command ${command} sent.` };
  }

  private async callApi(path: string, options: { method: "GET" | "POST"; token?: string; body?: Record<string, unknown> }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method,
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      });
    } catch {
      throw new EaseeTransportError("NETWORK_ERROR", "Easee API network request failed.", undefined, true);
    }

    if (!response.ok) throw normaliseStatusError(response.status, `Easee API request to ${path} failed with status ${response.status}.`);

    try {
      return await response.json();
    } catch {
      throw new EaseeTransportError("MALFORMED_RESPONSE", "Easee API returned non-JSON response.", response.status, false);
    }
  }
}
