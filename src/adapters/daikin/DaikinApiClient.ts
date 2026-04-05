type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AUTH_URL = "https://idp.onecta.daikineurope.com/v1/oidc/token";
const API_BASE = "https://api.onecta.daikineurope.com/v1";

// ── Transport error ───────────────────────────────────────────────────────────

export type DaikinTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class DaikinTransportError extends Error {
  constructor(
    public readonly code: DaikinTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "DaikinTransportError";
  }
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface DaikinGatewayDevice {
  /** Gateway device ID, referenced in per-device API calls. */
  id: string;
  name: string;
  /** Parsed operationMode from the climateControl management point. */
  operationMode: string; // "heating" | "cooling" | "auto" | "off" | "fanOnly" | "dry"
  /** Current indoor temperature in °C. */
  indoorTemperatureCelsius: number;
  /** Target temperature setpoint in °C. */
  targetTemperatureCelsius: number;
  raw: unknown;
}

export interface DaikinCommandResult {
  success: boolean;
  message?: string;
}

// ── Client interface ──────────────────────────────────────────────────────────

export interface DaikinApiClient {
  /** Exchange client credentials for an access token. */
  login(clientId: string, clientSecret: string): Promise<string>;
  /** List all gateway devices associated with the account. */
  getGatewayDevices(token: string): Promise<DaikinGatewayDevice[]>;
  /**
   * Set the operation mode for a specific management point.
   * Use "heating" to pre-heat, "off" to return the unit to its schedule.
   */
  setOperationMode(
    token: string,
    gatewayDeviceId: string,
    managementPointId: string,
    mode: "heating" | "cooling" | "auto" | "off",
  ): Promise<DaikinCommandResult>;
  /** Set the room-temperature setpoint for the given management point. */
  setTemperature(
    token: string,
    gatewayDeviceId: string,
    managementPointId: string,
    celsius: number,
  ): Promise<DaikinCommandResult>;
}

export interface DaikinHttpApiClientOptions {
  fetchFn?: FetchLike;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseStatusError(status: number, body: string): DaikinTransportError {
  if (status === 401 || status === 403) {
    return new DaikinTransportError("AUTH_FAILURE", `Daikin auth failed (status ${status}): ${body}`, status, false);
  }
  if (status === 404) {
    return new DaikinTransportError("UNSUPPORTED_DEVICE", `Daikin resource not found (status 404): ${body}`, status, false);
  }
  if (status === 429) {
    return new DaikinTransportError("RATE_LIMIT", `Daikin rate limit exceeded (status 429): ${body}`, status, true);
  }
  if (status >= 500) {
    return new DaikinTransportError("TEMPORARY_UNAVAILABLE", `Daikin server error (status ${status}): ${body}`, status, true);
  }
  return new DaikinTransportError("NETWORK_ERROR", `Daikin request failed (status ${status}): ${body}`, status, false);
}

function assertResponse(response: { ok: boolean; status: number }, body: string): void {
  if (!response.ok) {
    throw normaliseStatusError(response.status, body);
  }
}

/**
 * Parse a raw Daikin gateway-devices array element into a DaikinGatewayDevice.
 * Looks for the first management point with a `operationMode` characteristic.
 */
function parseGatewayDevice(raw: Record<string, unknown>): DaikinGatewayDevice {
  const id = String(raw.id ?? "");
  const name = String(raw.name ?? raw.type ?? "");
  const managementPoints = (raw.managementPoints ?? []) as Record<string, unknown>[];

  let operationMode = "off";
  let indoorTemperatureCelsius = 0;
  let targetTemperatureCelsius = 0;

  for (const mp of managementPoints) {
    const characteristics = (mp.characteristics ?? []) as Record<string, unknown>[];

    for (const char of characteristics) {
      const charName = String(char.name ?? "");
      if (charName === "operationMode" && typeof char.value === "string") {
        operationMode = char.value;
      }
      if (charName === "sensoryData") {
        const value = char.value as Record<string, unknown> | undefined;
        const roomTemp = (value?.roomTemperature as Record<string, unknown> | undefined)?.value;
        if (typeof roomTemp === "number") indoorTemperatureCelsius = roomTemp;
      }
      if (charName === "temperatureControl") {
        const value = char.value as Record<string, unknown> | undefined;
        const setpoints = (
          (value?.operationModes as Record<string, unknown> | undefined)?.heating as Record<string, unknown> | undefined
        )?.setpoints as Record<string, unknown> | undefined;
        const setpoint = (setpoints?.roomTemperature as Record<string, unknown> | undefined)?.value;
        if (typeof setpoint === "number") targetTemperatureCelsius = setpoint;
      }
    }
  }

  return { id, name, operationMode, indoorTemperatureCelsius, targetTemperatureCelsius, raw };
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class DaikinHttpApiClient implements DaikinApiClient {
  private readonly fetchFn: FetchLike;

  constructor(options: DaikinHttpApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async login(clientId: string, clientSecret: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid",
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
      throw new DaikinTransportError("MALFORMED_RESPONSE", "Daikin token response was not valid JSON.", undefined, false);
    }

    const token = (data as Record<string, unknown>)?.access_token;
    if (typeof token !== "string" || !token) {
      throw new DaikinTransportError("MALFORMED_RESPONSE", "Daikin token response missing access_token.", undefined, false);
    }

    return token;
  }

  async getGatewayDevices(token: string): Promise<DaikinGatewayDevice[]> {
    const response = await this.fetchFn(`${API_BASE}/gateway-devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new DaikinTransportError("MALFORMED_RESPONSE", "Daikin gateway-devices response was not valid JSON.", undefined, false);
    }

    if (!Array.isArray(data)) {
      throw new DaikinTransportError("MALFORMED_RESPONSE", "Daikin gateway-devices response is not an array.", undefined, false);
    }

    return (data as Record<string, unknown>[]).map(parseGatewayDevice);
  }

  async setOperationMode(
    token: string,
    gatewayDeviceId: string,
    managementPointId: string,
    mode: "heating" | "cooling" | "auto" | "off",
  ): Promise<DaikinCommandResult> {
    const url = `${API_BASE}/gateway-devices/${encodeURIComponent(gatewayDeviceId)}/management-points/${encodeURIComponent(managementPointId)}/characteristics/operationMode`;

    const response = await this.fetchFn(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: mode }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `Operation mode set to "${mode}".` };
  }

  async setTemperature(
    token: string,
    gatewayDeviceId: string,
    managementPointId: string,
    celsius: number,
  ): Promise<DaikinCommandResult> {
    const url = `${API_BASE}/gateway-devices/${encodeURIComponent(gatewayDeviceId)}/management-points/${encodeURIComponent(managementPointId)}/characteristics/temperatureControl`;

    const response = await this.fetchFn(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: "/operationModes/heating/setpoints/roomTemperature",
        value: celsius,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `Temperature set to ${celsius}°C.` };
  }
}
