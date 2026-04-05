type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.wall-box.com";

export type WallboxRemoteAction = "start" | "stop";

export interface WallboxCharger {
  /** Stable charger ID. */
  id: string;
  /** Human-readable charger name. */
  name: string;
  /** Charger status code. */
  status: number;
  /** Maximum charging current in amps. */
  maxChargingCurrent: number;
  /** Whether this charger supports V2G bidirectional discharge. */
  v2gCapable: boolean;
}

export interface WallboxStatusPayload {
  chargerId: string;
  charging: boolean;
  powerW: number;
  /** EV state of charge percentage when reported by the charger. */
  socPercent?: number;
  /** Whether V2G discharge is currently active (supplyCurrent < 0). */
  v2gDischargeActive: boolean;
  /** Whether V2H local-load discharge is currently active (localLoad > 0). */
  localLoadActive: boolean;
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
  getChargers(token: string): Promise<WallboxCharger[]>;
  getChargerStatus(token: string, chargerId: string): Promise<WallboxStatusPayload>;
  setChargerAction(token: string, chargerId: string, action: WallboxRemoteAction): Promise<WallboxCommandResult>;
  /** Set the charging current for a charger (1–32 A depending on installation). */
  setChargingCurrent(token: string, chargerId: string, amps: number): Promise<WallboxCommandResult>;
  /** Enable or disable V2G discharge mode (Quasar 2 only). */
  setDischargeMode(token: string, chargerId: string, enabled: boolean): Promise<WallboxCommandResult>;
  /** Enable or disable V2H local-load mode — routes EV discharge to the home circuit. */
  setLocalLoadMode(token: string, chargerId: string, enabled: boolean): Promise<WallboxCommandResult>;
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
    const supplyCurrent = toFiniteNumber(data?.supplyCurrent) ?? 0;
    const v2gDischargeActive = supplyCurrent < 0;
    const localLoad = toFiniteNumber(data?.localLoad) ?? 0;
    const localLoadActive = localLoad > 0;
    const socPct = toFiniteNumber(data?.stateOfChargePercent) ?? toFiniteNumber(data?.soc) ?? null;

    return {
      chargerId,
      charging,
      powerW,
      socPercent: socPct !== null ? socPct : undefined,
      v2gDischargeActive,
      localLoadActive,
      raw: payload,
    };
  }

  async setChargerAction(token: string, chargerId: string, action: WallboxRemoteAction): Promise<WallboxCommandResult> {
    await this.callApi(`/v3/chargers/${encodeURIComponent(chargerId)}/remote-action`, {
      method: "POST",
      token,
      body: { action },
    });
    return { success: true, message: `Wallbox remote action ${action} accepted.` };
  }

  async setChargingCurrent(token: string, chargerId: string, amps: number): Promise<WallboxCommandResult> {
    await this.callApi(`/v2/charger/${encodeURIComponent(chargerId)}`, {
      method: "PUT",
      token,
      body: { maxChargingCurrent: Math.round(amps) },
    });
    return { success: true, message: `Wallbox charging current set to ${amps}A.` };
  }

  async setDischargeMode(token: string, chargerId: string, enabled: boolean): Promise<WallboxCommandResult> {
    // Wallbox Quasar 2: negative supplyCurrent enables V2G discharge; 0 returns to standby.
    const supplyCurrent = enabled ? -1 : 0;
    await this.callApi(`/v2/charger/${encodeURIComponent(chargerId)}`, {
      method: "PUT",
      token,
      body: { supplyCurrent },
    });
    return { success: true, message: `Wallbox V2G discharge ${enabled ? "enabled" : "disabled"}.` };
  }

  async setLocalLoadMode(token: string, chargerId: string, enabled: boolean): Promise<WallboxCommandResult> {
    await this.callApi(`/v2/charger/${encodeURIComponent(chargerId)}`, {
      method: "PUT",
      token,
      body: { localLoad: enabled ? 1 : 0 },
    });
    return { success: true, message: `Wallbox V2H local-load mode ${enabled ? "enabled" : "disabled"}.` };
  }

  async getChargers(token: string): Promise<WallboxCharger[]> {
    const payload = await this.callApi("/v2/charger", { method: "GET", token });
    const items = Array.isArray(payload)
      ? payload
      : ((payload as Record<string, unknown>)?.data as unknown[]) ?? [];
    if (!Array.isArray(items)) return [];
    return (items as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      status: Number(item.status ?? 0),
      maxChargingCurrent: Number(item.maxChargingCurrent ?? 32),
      v2gCapable: Boolean(item.v2gCapable ?? false),
    }));
  }

  private async callApi(path: string, options: { method: "GET" | "POST" | "PUT"; token?: string; body?: Record<string, unknown>; headers?: Record<string, string> }): Promise<unknown> {
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
