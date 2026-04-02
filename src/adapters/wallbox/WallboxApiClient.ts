type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.wall-box.com";

export type WallboxRemoteAction = "start" | "stop";

export interface WallboxStatusPayload {
  chargerId: string;
  charging: boolean;
  powerW: number;
  raw: unknown;
}

export interface WallboxCommandResult {
  success: boolean;
  message?: string;
}

export type WallboxTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class WallboxTransportError extends Error {
  constructor(
    public readonly code: WallboxTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "WallboxTransportError";
  }
}

export interface WallboxApiClient {
  login(email: string, password: string): Promise<string>;
  getChargerStatus(token: string, chargerId: string): Promise<WallboxStatusPayload>;
  setChargerAction(token: string, chargerId: string, action: WallboxRemoteAction): Promise<WallboxCommandResult>;
}

export interface WallboxHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): WallboxTransportError {
  if (status === 401 || status === 403) return new WallboxTransportError("AUTH_FAILURE", message, status, false);
  if (status === 404) return new WallboxTransportError("UNSUPPORTED_DEVICE", message, status, false);
  if (status === 408) return new WallboxTransportError("TIMEOUT", message, status, true);
  if (status === 429) return new WallboxTransportError("RATE_LIMIT", message, status, true);
  if (status >= 500) return new WallboxTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  return new WallboxTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export class WallboxHttpApiClient implements WallboxApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: WallboxHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(email: string, password: string): Promise<string> {
    const encoded = Buffer.from(`${email}:${password}`).toString("base64");
    const payload = await this.callApi("/auth/token/user", {
      method: "POST",
      headers: { Authorization: `Basic ${encoded}` },
    });
    const root = payload as Record<string, unknown> | undefined;
    const token = String(root?.jwt ?? root?.access_token ?? (root?.data as Record<string, unknown> | undefined)?.token ?? "").trim();
    if (!token) throw new WallboxTransportError("MALFORMED_RESPONSE", "Wallbox login response missing token.");
    return token;
  }

  async getChargerStatus(token: string, chargerId: string): Promise<WallboxStatusPayload> {
    const payload = await this.callApi(`/v2/charger/${encodeURIComponent(chargerId)}`, {
      method: "GET",
      token,
    });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;
    const powerW = toFiniteNumber(data?.charging_power) ?? toFiniteNumber(data?.power) ?? toFiniteNumber(data?.currentPower) ?? 0;
    const statusRaw = String(data?.status ?? data?.chargerStatus ?? "").toLowerCase();
    const charging = statusRaw.includes("charge") || powerW > 0;
    return { chargerId, charging, powerW, raw: payload };
  }

  async setChargerAction(token: string, chargerId: string, action: WallboxRemoteAction): Promise<WallboxCommandResult> {
    await this.callApi(`/v3/chargers/${encodeURIComponent(chargerId)}/remote-action`, {
      method: "POST",
      token,
      body: { action },
    });
    return { success: true, message: `Wallbox remote action ${action} accepted.` };
  }

  private async callApi(path: string, options: { method: "GET" | "POST"; token?: string; body?: Record<string, unknown>; headers?: Record<string, string> }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method,
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.headers ?? {}),
        },
      });
    } catch {
      throw new WallboxTransportError("NETWORK_ERROR", "Wallbox API network request failed.", undefined, true);
    }

    if (!response.ok) {
      throw normaliseStatusError(response.status, `Wallbox API request to ${path} failed with status ${response.status}.`);
    }

    try {
      return await response.json();
    } catch {
      throw new WallboxTransportError("MALFORMED_RESPONSE", "Wallbox API returned non-JSON response.", response.status, false);
    }
  }
}
