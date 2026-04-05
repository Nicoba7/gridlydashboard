type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://api.smartthings.com/v1";

// ── Transport error ───────────────────────────────────────────────────────────

export type SamsungTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class SamsungTransportError extends Error {
  constructor(
    public readonly code: SamsungTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SamsungTransportError";
  }
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface SamsungDevice {
  deviceId: string;
  name: string;
  label: string;
}

export interface SamsungDeviceStatus {
  /** Current heating setpoint in °C from thermostatHeatingSetpoint capability. */
  heatingSetpointCelsius: number;
  /** Current measured room temperature in °C from temperatureMeasurement capability. */
  currentTemperatureCelsius: number;
  /** Current thermostat mode: "heat" | "cool" | "off" | "auto" | "emergency heat". */
  thermostatMode: string;
  raw: unknown;
}

export interface SamsungCommandResult {
  success: boolean;
  message?: string;
}

// ── Client interface ──────────────────────────────────────────────────────────

export interface SamsungApiClient {
  /**
   * Retrieve all devices with the thermostatHeatingSetpoint capability.
   * Uses the SmartThings Personal Access Token (PAT) as a Bearer token.
   */
  getDevices(token: string): Promise<SamsungDevice[]>;
  /** Read the current status of a specific device. */
  getDeviceStatus(token: string, deviceId: string): Promise<SamsungDeviceStatus>;
  /**
   * Set the heating setpoint via the thermostatHeatingSetpoint capability.
   * Posts a command to the "main" component.
   */
  setHeatingSetpoint(token: string, deviceId: string, celsius: number): Promise<SamsungCommandResult>;
}

export interface SamsungHttpApiClientOptions {
  fetchFn?: FetchLike;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseStatusError(status: number, body: string): SamsungTransportError {
  if (status === 401 || status === 403) {
    return new SamsungTransportError("AUTH_FAILURE", `SmartThings auth failed (status ${status}): ${body}`, status, false);
  }
  if (status === 404) {
    return new SamsungTransportError("UNSUPPORTED_DEVICE", `SmartThings device not found (status 404): ${body}`, status, false);
  }
  if (status === 429) {
    return new SamsungTransportError("RATE_LIMIT", `SmartThings rate limit exceeded (status 429): ${body}`, status, true);
  }
  if (status >= 500) {
    return new SamsungTransportError("TEMPORARY_UNAVAILABLE", `SmartThings server error (status ${status}): ${body}`, status, true);
  }
  return new SamsungTransportError("NETWORK_ERROR", `SmartThings request failed (status ${status}): ${body}`, status, false);
}

function assertResponse(response: { ok: boolean; status: number }, body: string): void {
  if (!response.ok) {
    throw normaliseStatusError(response.status, body);
  }
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class SamsungHttpApiClient implements SamsungApiClient {
  private readonly fetchFn: FetchLike;

  constructor(options: SamsungHttpApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async getDevices(token: string): Promise<SamsungDevice[]> {
    const response = await this.fetchFn(
      `${API_BASE}/devices?capability=thermostatHeatingSetpoint`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SamsungTransportError("MALFORMED_RESPONSE", "SmartThings devices response was not valid JSON.", undefined, false);
    }

    const items = (data as Record<string, unknown>)?.items;
    if (!Array.isArray(items)) {
      throw new SamsungTransportError("MALFORMED_RESPONSE", "SmartThings devices response has no items array.", undefined, false);
    }

    return (items as Record<string, unknown>[]).map((item) => ({
      deviceId: String(item.deviceId ?? ""),
      name: String(item.name ?? ""),
      label: String(item.label ?? item.name ?? ""),
    }));
  }

  async getDeviceStatus(token: string, deviceId: string): Promise<SamsungDeviceStatus> {
    const response = await this.fetchFn(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SamsungTransportError("MALFORMED_RESPONSE", "SmartThings device status response was not valid JSON.", undefined, false);
    }

    const components = (data as Record<string, unknown>)?.components as Record<string, unknown> | undefined;
    const main = components?.main as Record<string, unknown> | undefined;

    const heatingSetpointAttr = (main?.thermostatHeatingSetpoint as Record<string, unknown> | undefined)?.heatingSetpoint as Record<string, unknown> | undefined;
    const heatingSetpointCelsius = typeof heatingSetpointAttr?.value === "number" ? heatingSetpointAttr.value : 0;

    const temperatureAttr = (main?.temperatureMeasurement as Record<string, unknown> | undefined)?.temperature as Record<string, unknown> | undefined;
    const currentTemperatureCelsius = typeof temperatureAttr?.value === "number" ? temperatureAttr.value : 0;

    const modeAttr = (main?.thermostatMode as Record<string, unknown> | undefined)?.thermostatMode as Record<string, unknown> | undefined;
    const thermostatMode = typeof modeAttr?.value === "string" ? modeAttr.value : "off";

    return {
      heatingSetpointCelsius,
      currentTemperatureCelsius,
      thermostatMode,
      raw: data,
    };
  }

  async setHeatingSetpoint(token: string, deviceId: string, celsius: number): Promise<SamsungCommandResult> {
    const response = await this.fetchFn(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commands: [
            {
              component: "main",
              capability: "thermostatHeatingSetpoint",
              command: "setHeatingSetpoint",
              arguments: [celsius],
            },
          ],
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `Heating setpoint set to ${celsius}°C.` };
  }
}
