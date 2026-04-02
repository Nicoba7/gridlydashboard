type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.hypervolt.co.uk";

export interface HypervoltStatusPayload {
  chargerId: string;
  charging: boolean;
  powerW: number;
  raw: unknown;
}

export interface HypervoltCommandResult {
  success: boolean;
  message?: string;
}

export type HypervoltTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class HypervoltTransportError extends Error {
  constructor(
    public readonly code: HypervoltTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "HypervoltTransportError";
  }
}

export interface HypervoltApiClient {
  login(email: string, password: string): Promise<string>;
  getChargerStatus(token: string, chargerId: string): Promise<HypervoltStatusPayload>;
  setChargeSession(token: string, chargerId: string, enabled: boolean): Promise<HypervoltCommandResult>;
}

export interface HypervoltHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): HypervoltTransportError {
  if (status === 401 || status === 403) return new HypervoltTransportError("AUTH_FAILURE", message, status, false);
  if (status === 404) return new HypervoltTransportError("UNSUPPORTED_DEVICE", message, status, false);
  if (status === 408) return new HypervoltTransportError("TIMEOUT", message, status, true);
  if (status === 429) return new HypervoltTransportError("RATE_LIMIT", message, status, true);
  if (status >= 500) return new HypervoltTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  return new HypervoltTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export class HypervoltHttpApiClient implements HypervoltApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: HypervoltHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(email: string, password: string): Promise<string> {
    const payload = await this.callApi("/login", { method: "POST", body: { email, password } });
    const root = payload as Record<string, unknown> | undefined;
    const token = String(root?.token ?? (root?.data as Record<string, unknown> | undefined)?.token ?? "").trim();
    if (!token) {
      throw new HypervoltTransportError("MALFORMED_RESPONSE", "Hypervolt login response missing token.");
    }
    return token;
  }

  async getChargerStatus(token: string, chargerId: string): Promise<HypervoltStatusPayload> {
    const payload = await this.callApi(`/charger/${encodeURIComponent(chargerId)}`, {
      method: "GET",
      token,
    });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;

    const powerW = toFiniteNumber(data?.powerW) ?? toFiniteNumber(data?.power) ?? toFiniteNumber(data?.currentPower) ?? 0;
    const charging = Boolean(data?.charging ?? data?.isCharging ?? (powerW > 0));

    return { chargerId, charging, powerW, raw: payload };
  }

  async setChargeSession(token: string, chargerId: string, enabled: boolean): Promise<HypervoltCommandResult> {
    await this.callApi(`/charger/${encodeURIComponent(chargerId)}/session`, {
      method: "POST",
      token,
      body: { enabled },
    });
    return { success: true, message: `Hypervolt charging ${enabled ? "started" : "stopped"}.` };
  }

  private async callApi(
    path: string,
    options: { method: "GET" | "POST"; token?: string; body?: Record<string, unknown> },
  ): Promise<unknown> {
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
      throw new HypervoltTransportError("NETWORK_ERROR", "Hypervolt API network request failed.", undefined, true);
    }

    if (!response.ok) {
      throw normaliseStatusError(response.status, `Hypervolt API request to ${path} failed with status ${response.status}.`);
    }

    try {
      return await response.json();
    } catch {
      throw new HypervoltTransportError("MALFORMED_RESPONSE", "Hypervolt API returned non-JSON response.", response.status, false);
    }
  }
}
