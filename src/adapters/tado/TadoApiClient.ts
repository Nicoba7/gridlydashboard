type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AUTH_URL = "https://auth.tado.com/oauth/token";
const API_BASE = "https://my.tado.com/api/v2";

// tado OAuth2 client credentials used by all official tado apps.
const TADO_CLIENT_ID = "tado-web-app";
const TADO_CLIENT_SECRET = "wZaRN7rpjn3FoNyF5IFuxg9uMzYJcvOoQ8QWiIqS3hfk6gLhVlG57j5YHoZg9GQKrGjFQcB";

// ── Transport error ───────────────────────────────────────────────────────────

export type TadoTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class TadoTransportError extends Error {
  constructor(
    public readonly code: TadoTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "TadoTransportError";
  }
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface TadoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface TadoZone {
  id: number;
  name: string;
  type: string;
}

export interface TadoZoneState {
  zoneId: number;
  currentTemperatureCelsius: number;
  targetTemperatureCelsius: number | null;
  heatingPowerPercent: number;
  raw: unknown;
}

export interface TadoCommandResult {
  success: boolean;
  message?: string;
}

// ── Client interface ──────────────────────────────────────────────────────────

export interface TadoApiClient {
  login(username: string, password: string): Promise<string>;
  getHome(token: string): Promise<number>;
  getZones(token: string, homeId: number): Promise<TadoZone[]>;
  getZoneState(token: string, homeId: number, zoneId: number): Promise<TadoZoneState>;
  setTemperature(
    token: string,
    homeId: number,
    zoneId: number,
    temperatureCelsius: number,
    durationMinutes: number,
  ): Promise<TadoCommandResult>;
  deleteOverlay(token: string, homeId: number, zoneId: number): Promise<TadoCommandResult>;
}

export interface TadoHttpApiClientOptions {
  fetchFn?: FetchLike;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseStatusError(status: number, body: string): TadoTransportError {
  if (status === 401 || status === 403) {
    return new TadoTransportError("AUTH_FAILURE", `Tado auth failed (status ${status}): ${body}`, status, false);
  }
  if (status === 404) {
    return new TadoTransportError("UNSUPPORTED_DEVICE", `Tado resource not found (status 404): ${body}`, status, false);
  }
  if (status === 429) {
    return new TadoTransportError("RATE_LIMIT", `Tado rate limit exceeded (status 429): ${body}`, status, true);
  }
  if (status >= 500) {
    return new TadoTransportError("TEMPORARY_UNAVAILABLE", `Tado server error (status ${status}): ${body}`, status, true);
  }
  return new TadoTransportError("NETWORK_ERROR", `Tado request failed (status ${status}): ${body}`, status, false);
}

function assertResponse(response: { ok: boolean; status: number }, body: string): void {
  if (!response.ok) {
    throw normaliseStatusError(response.status, body);
  }
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class TadoHttpApiClient implements TadoApiClient {
  private readonly fetchFn: FetchLike;

  constructor(options: TadoHttpApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async login(username: string, password: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: TADO_CLIENT_ID,
      client_secret: TADO_CLIENT_SECRET,
      grant_type: "password",
      username,
      password,
      scope: "home.user",
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
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado token response was not valid JSON.", undefined, false);
    }

    const token = (data as Record<string, unknown>)?.access_token;
    if (typeof token !== "string" || !token) {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado token response missing access_token.", undefined, false);
    }

    return token;
  }

  async getHome(token: string): Promise<number> {
    const response = await this.fetchFn(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado /me response was not valid JSON.", undefined, false);
    }

    const homes = (data as Record<string, unknown>)?.homes;
    if (!Array.isArray(homes) || homes.length === 0) {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado /me response contains no homes.", undefined, false);
    }

    const homeId = (homes[0] as Record<string, unknown>)?.id;
    if (typeof homeId !== "number") {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado home id is missing or not a number.", undefined, false);
    }

    return homeId;
  }

  async getZones(token: string, homeId: number): Promise<TadoZone[]> {
    const response = await this.fetchFn(`${API_BASE}/homes/${homeId}/zones`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado zones response was not valid JSON.", undefined, false);
    }

    if (!Array.isArray(data)) {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado zones response is not an array.", undefined, false);
    }

    return (data as Record<string, unknown>[]).map((zone) => ({
      id: Number(zone.id),
      name: String(zone.name ?? ""),
      type: String(zone.type ?? ""),
    }));
  }

  async getZoneState(token: string, homeId: number, zoneId: number): Promise<TadoZoneState> {
    const response = await this.fetchFn(`${API_BASE}/homes/${homeId}/zones/${zoneId}/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new TadoTransportError("MALFORMED_RESPONSE", "Tado zone state response was not valid JSON.", undefined, false);
    }

    const root = data as Record<string, unknown>;
    const sensorRaw = (root.sensorDataPoints as Record<string, unknown> | undefined)?.insideTemperature as Record<string, unknown> | undefined;
    const currentTemperatureCelsius = typeof sensorRaw?.celsius === "number" ? sensorRaw.celsius : 0;

    const settingRaw = root.setting as Record<string, unknown> | undefined;
    const targetTemperatureRaw = (settingRaw?.temperature as Record<string, unknown> | undefined)?.celsius;
    const targetTemperatureCelsius = typeof targetTemperatureRaw === "number" ? targetTemperatureRaw : null;

    const activityRaw = root.activityDataPoints as Record<string, unknown> | undefined;
    const heatingPowerPercent =
      typeof (activityRaw?.heatingPower as Record<string, unknown> | undefined)?.percentage === "number"
        ? Number((activityRaw!.heatingPower as Record<string, unknown>).percentage)
        : 0;

    return {
      zoneId,
      currentTemperatureCelsius,
      targetTemperatureCelsius,
      heatingPowerPercent,
      raw: data,
    };
  }

  async setTemperature(
    token: string,
    homeId: number,
    zoneId: number,
    temperatureCelsius: number,
    durationMinutes: number,
  ): Promise<TadoCommandResult> {
    const body = JSON.stringify({
      setting: {
        type: "HEATING",
        power: "ON",
        temperature: { celsius: temperatureCelsius },
      },
      termination: {
        typeSkillBased: "TIMER",
        durationInSeconds: durationMinutes * 60,
      },
    });

    const response = await this.fetchFn(`${API_BASE}/homes/${homeId}/zones/${zoneId}/overlay`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });

    const text = await response.text();

    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `Temperature set to ${temperatureCelsius}°C for ${durationMinutes} min.` };
  }

  async deleteOverlay(token: string, homeId: number, zoneId: number): Promise<TadoCommandResult> {
    const response = await this.fetchFn(`${API_BASE}/homes/${homeId}/zones/${zoneId}/overlay`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true, message: "Zone returned to auto mode." };
    }

    const text = await response.text();
    throw normaliseStatusError(response.status, text);
  }
}
