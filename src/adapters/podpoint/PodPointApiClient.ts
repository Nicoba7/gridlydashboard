type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.pod-point.com/v4";

export interface PodPointSchedule {
  startAt: string;
  endAt: string;
}

export interface PodPointAuthSession {
  token: string;
  userId: string;
}

export interface PodPointUnitPayload {
  unitId: string;
  connected: boolean;
  charging: boolean;
  powerW: number;
  raw: unknown;
}

export interface PodPointCommandResult {
  success: boolean;
  message?: string;
}

export type PodPointTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class PodPointTransportError extends Error {
  constructor(
    public readonly code: PodPointTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "PodPointTransportError";
  }
}

export interface PodPointApiClient {
  login(email: string, password: string): Promise<PodPointAuthSession>;
  getUnit(token: string, unitId: string): Promise<PodPointUnitPayload>;
  setSchedule(token: string, unitId: string, schedule: PodPointSchedule): Promise<PodPointCommandResult>;
}

export interface PodPointHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): PodPointTransportError {
  if (status === 401 || status === 403) return new PodPointTransportError("AUTH_FAILURE", message, status, false);
  if (status === 404) return new PodPointTransportError("UNSUPPORTED_DEVICE", message, status, false);
  if (status === 408) return new PodPointTransportError("TIMEOUT", message, status, true);
  if (status === 429) return new PodPointTransportError("RATE_LIMIT", message, status, true);
  if (status >= 500) return new PodPointTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  return new PodPointTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export class PodPointHttpApiClient implements PodPointApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private userId: string | null = null;

  constructor(options: PodPointHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(email: string, password: string): Promise<PodPointAuthSession> {
    const payload = await this.callApi("/sessions", { method: "POST", body: { email, password } });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;
    const token = String(data?.token ?? root?.token ?? "").trim();
    const userId = String(data?.userId ?? data?.id ?? root?.userId ?? "").trim();
    if (!token || !userId) throw new PodPointTransportError("MALFORMED_RESPONSE", "Pod Point login response missing token or userId.");
    this.userId = userId;
    return { token, userId };
  }

  async getUnit(token: string, unitId: string): Promise<PodPointUnitPayload> {
    if (!this.userId) throw new PodPointTransportError("AUTH_FAILURE", "Pod Point userId unavailable. Call login first.");
    const payload = await this.callApi(`/users/${encodeURIComponent(this.userId)}/units/${encodeURIComponent(unitId)}`, {
      method: "GET",
      token,
    });
    const root = payload as Record<string, unknown> | undefined;
    const data = (root?.data as Record<string, unknown> | undefined) ?? root;
    const status = String(data?.chargeStatus ?? data?.status ?? "").toLowerCase();
    const connectivity = String(data?.connectivityStatus ?? data?.connectivity ?? "").toLowerCase();
    const powerW = toFiniteNumber(data?.powerW) ?? toFiniteNumber(data?.chargingPower) ?? 0;
    const charging = status.includes("charge") || powerW > 0;
    const connected = connectivity.includes("online") || connectivity.includes("connected") || charging;
    return { unitId, connected, charging, powerW, raw: payload };
  }

  async setSchedule(token: string, unitId: string, schedule: PodPointSchedule): Promise<PodPointCommandResult> {
    await this.callApi(`/units/${encodeURIComponent(unitId)}/schedules`, {
      method: "POST",
      token,
      body: schedule,
    });
    return { success: true, message: `Pod Point schedule set ${schedule.startAt} -> ${schedule.endAt}.` };
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
      throw new PodPointTransportError("NETWORK_ERROR", "Pod Point API network request failed.", undefined, true);
    }

    if (!response.ok) throw normaliseStatusError(response.status, `Pod Point API request to ${path} failed with status ${response.status}.`);

    try {
      return await response.json();
    } catch {
      throw new PodPointTransportError("MALFORMED_RESPONSE", "Pod Point API returned non-JSON response.", response.status, false);
    }
  }
}
