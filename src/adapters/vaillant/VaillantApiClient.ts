type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AUTH_URL = "https://api.vaillant-group.com/service-connected-home/end-user-app-api/v1/oauth/token";
const API_BASE = "https://api.vaillant-group.com/service-connected-home/end-user-app-api/v1";

// Standard client ID used by the official myvaillant consumer app.
const VAILLANT_CLIENT_ID = "myvaillant";

// ── Transport error ───────────────────────────────────────────────────────────

export type VaillantTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class VaillantTransportError extends Error {
  constructor(
    public readonly code: VaillantTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "VaillantTransportError";
  }
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface VaillantHome {
  homeId: string;
  name: string;
}

export interface VaillantSystemStatus {
  homeId: string;
  currentTemperatureCelsius: number;
  targetTemperatureCelsius: number;
  heatingActive: boolean;
  hotWaterTemperatureCelsius: number;
  raw: unknown;
}

export interface VaillantCommandResult {
  success: boolean;
  message?: string;
}

export type VaillantQuickMode = "QUICK_VETO" | "SYSTEM_OFF";

// ── Client interface ──────────────────────────────────────────────────────────

export interface VaillantApiClient {
  login(username: string, password: string): Promise<string>;
  getHomes(token: string): Promise<VaillantHome[]>;
  getSystemStatus(token: string, homeId: string): Promise<VaillantSystemStatus>;
  setQuickMode(
    token: string,
    homeId: string,
    mode: VaillantQuickMode,
    durationMinutes: number,
  ): Promise<VaillantCommandResult>;
  clearQuickMode(token: string, homeId: string): Promise<VaillantCommandResult>;
}

export interface VaillantHttpApiClientOptions {
  fetchFn?: FetchLike;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseStatusError(status: number, body: string): VaillantTransportError {
  if (status === 401 || status === 403) {
    return new VaillantTransportError("AUTH_FAILURE", `Vaillant auth failed (status ${status}): ${body}`, status, false);
  }
  if (status === 404) {
    return new VaillantTransportError("UNSUPPORTED_DEVICE", `Vaillant resource not found (status 404): ${body}`, status, false);
  }
  if (status === 429) {
    return new VaillantTransportError("RATE_LIMIT", `Vaillant rate limit exceeded (status 429): ${body}`, status, true);
  }
  if (status >= 500) {
    return new VaillantTransportError("TEMPORARY_UNAVAILABLE", `Vaillant server error (status ${status}): ${body}`, status, true);
  }
  return new VaillantTransportError("NETWORK_ERROR", `Vaillant request failed (status ${status}): ${body}`, status, false);
}

function assertResponse(response: { ok: boolean; status: number }, body: string): void {
  if (!response.ok) {
    throw normaliseStatusError(response.status, body);
  }
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class VaillantHttpApiClient implements VaillantApiClient {
  private readonly fetchFn: FetchLike;

  constructor(options: VaillantHttpApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async login(username: string, password: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: VAILLANT_CLIENT_ID,
      grant_type: "password",
      username,
      password,
      scope: "openid offline_access email profile",
    });

    const response = await this.fetchFn(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new VaillantTransportError("MALFORMED_RESPONSE", "Vaillant token response was not valid JSON.", undefined, false);
    }

    const token = (data as Record<string, unknown>)?.access_token;
    if (typeof token !== "string" || !token) {
      throw new VaillantTransportError("MALFORMED_RESPONSE", "Vaillant token response missing access_token.", undefined, false);
    }

    return token;
  }

  async getHomes(token: string): Promise<VaillantHome[]> {
    const response = await this.fetchFn(`${API_BASE}/homes`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new VaillantTransportError("MALFORMED_RESPONSE", "Vaillant homes response was not valid JSON.", undefined, false);
    }

    if (!Array.isArray(data)) {
      throw new VaillantTransportError("MALFORMED_RESPONSE", "Vaillant homes response is not an array.", undefined, false);
    }

    return (data as Record<string, unknown>[]).map((home) => ({
      homeId: String(home.homeId ?? home.id ?? ""),
      name: String(home.name ?? ""),
    }));
  }

  async getSystemStatus(token: string, homeId: string): Promise<VaillantSystemStatus> {
    const response = await this.fetchFn(`${API_BASE}/homes/${encodeURIComponent(homeId)}/system`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new VaillantTransportError("MALFORMED_RESPONSE", "Vaillant system status response was not valid JSON.", undefined, false);
    }

    const root = data as Record<string, unknown>;
    // Accept both a top-level `state` wrapper and a flat structure.
    const state = (root.state ?? root) as Record<string, unknown>;

    const currentTemperatureCelsius =
      typeof state.currentRoomTemperature === "number" ? state.currentRoomTemperature : 0;
    const targetTemperatureCelsius =
      typeof state.desiredRoomTemperature === "number" ? state.desiredRoomTemperature : 0;
    const heatingActive =
      state.systemOperationMode === "HEATING" || Boolean(state.heatingActive);
    const hotWaterTemperatureCelsius =
      typeof state.currentDomesticHotWaterTemperature === "number"
        ? state.currentDomesticHotWaterTemperature
        : 0;

    return {
      homeId,
      currentTemperatureCelsius,
      targetTemperatureCelsius,
      heatingActive,
      hotWaterTemperatureCelsius,
      raw: data,
    };
  }

  async setQuickMode(
    token: string,
    homeId: string,
    mode: VaillantQuickMode,
    durationMinutes: number,
  ): Promise<VaillantCommandResult> {
    const response = await this.fetchFn(`${API_BASE}/homes/${encodeURIComponent(homeId)}/quick-mode`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quickMode: mode, duration: durationMinutes }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `Quick mode ${mode} set for ${durationMinutes} minutes.` };
  }

  async clearQuickMode(token: string, homeId: string): Promise<VaillantCommandResult> {
    const response = await this.fetchFn(`${API_BASE}/homes/${encodeURIComponent(homeId)}/quick-mode`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true, message: "Quick mode cleared — system returned to schedule." };
    }

    const text = await response.text();
    throw normaliseStatusError(response.status, text);
  }
}
