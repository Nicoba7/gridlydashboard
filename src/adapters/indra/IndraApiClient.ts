type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.indra.co.uk";

export interface IndraSchedule {
  startAt: string;
  endAt: string;
}

export interface IndraStatusPayload {
  deviceId: string;
  charging: boolean;
  powerW: number;
  raw: unknown;
}

export interface IndraCommandResult {
  success: boolean;
  message?: string;
}

export type IndraTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class IndraTransportError extends Error {
  constructor(
    public readonly code: IndraTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "IndraTransportError";
  }
}

export interface IndraApiClient {
  login(email: string, password: string): Promise<string>;
  getChargerStatus(token: string, deviceId: string): Promise<IndraStatusPayload>;
  setChargeSchedule(token: string, deviceId: string, schedule: IndraSchedule): Promise<IndraCommandResult>;
}

export interface IndraHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): IndraTransportError {
  if (status === 401 || status === 403) return new IndraTransportError("AUTH_FAILURE", message, status, false);
  if (status === 404) return new IndraTransportError("UNSUPPORTED_DEVICE", message, status, false);
  if (status === 408) return new IndraTransportError("TIMEOUT", message, status, true);
  if (status === 429) return new IndraTransportError("RATE_LIMIT", message, status, true);
  if (status >= 500) return new IndraTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  return new IndraTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export class IndraHttpApiClient implements IndraApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: IndraHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(email: string, password: string): Promise<string> {
    const payload = await this.callApi("/api/v1/auth/login", { method: "POST", body: { email, password } });
    const root = payload as Record<string, unknown> | undefined;
    const token = String(root?.token ?? (root?.data as Record<string, unknown> | undefined)?.token ?? "").trim();
    if (!token) throw new IndraTransportError("MALFORMED_RESPONSE", "Indra login response missing token.");
    return token;
  }

  async getChargerStatus(token: string, deviceId: string): Promise<IndraStatusPayload> {
    const payload = await this.callApi(`/api/v1/devices/${encodeURIComponent(deviceId)}`, { method: "GET", token });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;
    const powerW = toFiniteNumber(data?.powerW) ?? toFiniteNumber(data?.currentPower) ?? toFiniteNumber(data?.chargingPower) ?? 0;
    const charging = Boolean(data?.charging ?? data?.isCharging ?? (powerW > 0));
    return { deviceId, charging, powerW, raw: payload };
  }

  async setChargeSchedule(token: string, deviceId: string, schedule: IndraSchedule): Promise<IndraCommandResult> {
    await this.callApi(`/api/v1/devices/${encodeURIComponent(deviceId)}/schedule`, { method: "POST", token, body: schedule });
    return { success: true, message: `Indra schedule set ${schedule.startAt} -> ${schedule.endAt}.` };
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
      throw new IndraTransportError("NETWORK_ERROR", "Indra API network request failed.", undefined, true);
    }

    if (!response.ok) throw normaliseStatusError(response.status, `Indra API request to ${path} failed with status ${response.status}.`);

    try {
      return await response.json();
    } catch {
      throw new IndraTransportError("MALFORMED_RESPONSE", "Indra API returned non-JSON response.", response.status, false);
    }
  }
}
