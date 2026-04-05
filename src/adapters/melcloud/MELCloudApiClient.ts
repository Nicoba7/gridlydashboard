type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://app.melcloud.com/Mitsubishi.Wifi.Client";
const APP_VERSION = "1.26.2.0";

// EffectiveFlags bitmask values for ATW (Air-To-Water) setpoint fields.
const EFFECTIVE_FLAG_ZONE1_TEMPERATURE = 0x200000080;

// ── Transport error ───────────────────────────────────────────────────────────

export type MELCloudTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class MELCloudTransportError extends Error {
  constructor(
    public readonly code: MELCloudTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "MELCloudTransportError";
  }
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface MELCloudDevice {
  deviceId: number;
  deviceName: string;
  /** Current room temperature in zone 1 (RoomTemperatureZone1). */
  currentTemperatureCelsius: number;
  /** Target room temperature in zone 1 (SetTemperatureZone1). */
  targetTemperatureCelsius: number;
  /** Current domestic hot water tank temperature (TankWaterTemperature). */
  tankTemperatureCelsius: number;
  /** Target domestic hot water tank temperature (SetTankWaterTemperature). */
  targetTankTemperatureCelsius: number;
  /** Approximate heating electrical consumption in watts (HeatingEnergyConsumedRate1). */
  heatingPowerW: number;
  /** Whether the unit is powered on. */
  power: boolean;
  raw: unknown;
}

export interface MELCloudAtwSettings {
  DeviceID: number;
  EffectiveFlags: number;
  SetTemperatureZone1?: number;
  OperationModeZone1?: number;
  Power?: boolean;
}

export interface MELCloudCommandResult {
  success: boolean;
  message?: string;
}

// ── Client interface ──────────────────────────────────────────────────────────

export interface MELCloudApiClient {
  login(email: string, password: string): Promise<string>;
  getDevices(contextKey: string): Promise<MELCloudDevice[]>;
  setAtw(contextKey: string, settings: MELCloudAtwSettings): Promise<MELCloudCommandResult>;
}

export interface MELCloudHttpApiClientOptions {
  fetchFn?: FetchLike;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseStatusError(status: number, body: string): MELCloudTransportError {
  if (status === 401 || status === 403) {
    return new MELCloudTransportError("AUTH_FAILURE", `MELCloud auth failed (status ${status}): ${body}`, status, false);
  }
  if (status === 404) {
    return new MELCloudTransportError("UNSUPPORTED_DEVICE", `MELCloud resource not found (status 404): ${body}`, status, false);
  }
  if (status === 429) {
    return new MELCloudTransportError("RATE_LIMIT", `MELCloud rate limit exceeded (status 429): ${body}`, status, true);
  }
  if (status >= 500) {
    return new MELCloudTransportError("TEMPORARY_UNAVAILABLE", `MELCloud server error (status ${status}): ${body}`, status, true);
  }
  return new MELCloudTransportError("NETWORK_ERROR", `MELCloud request failed (status ${status}): ${body}`, status, false);
}

function assertResponse(response: { ok: boolean; status: number }, body: string): void {
  if (!response.ok) {
    throw normaliseStatusError(response.status, body);
  }
}

function flattenDevices(raw: unknown): MELCloudDevice[] {
  if (!Array.isArray(raw)) {
    throw new MELCloudTransportError("MALFORMED_RESPONSE", "MELCloud ListDevices response is not an array.", undefined, false);
  }

  const devices: MELCloudDevice[] = [];

  for (const building of raw as Record<string, unknown>[]) {
    // Try flat device list first (simplified structure), then nested Structure.Areas
    const structure = building.Structure as Record<string, unknown> | undefined;
    const areas = (structure?.Areas ?? structure?.Devices) as unknown[] | undefined;

    if (Array.isArray(areas)) {
      for (const area of areas as Record<string, unknown>[]) {
        const areaDevices = (area.Devices ?? []) as Record<string, unknown>[];
        for (const entry of areaDevices) {
          const device = (entry.Device ?? entry) as Record<string, unknown>;
          const deviceId = Number(entry.DeviceID ?? device.DeviceID ?? entry.ID ?? device.ID ?? 0);
          if (deviceId) {
            devices.push(mapDevice(deviceId, entry.DeviceName ?? device.DeviceName, device));
          }
        }
      }
    } else {
      // Flat list item — the building IS the device
      const device = (building.Device ?? building) as Record<string, unknown>;
      const deviceId = Number(building.DeviceID ?? building.ID ?? 0);
      if (deviceId) {
        devices.push(mapDevice(deviceId, building.DeviceName ?? building.Name, device));
      }
    }
  }

  return devices;
}

function mapDevice(deviceId: number, nameRaw: unknown, device: Record<string, unknown>): MELCloudDevice {
  return {
    deviceId,
    deviceName: String(nameRaw ?? ""),
    currentTemperatureCelsius: Number(device.RoomTemperatureZone1 ?? 0),
    targetTemperatureCelsius: Number(device.SetTemperatureZone1 ?? 0),
    tankTemperatureCelsius: Number(device.TankWaterTemperature ?? 0),
    targetTankTemperatureCelsius: Number(device.SetTankWaterTemperature ?? 50),
    heatingPowerW: Number(device.HeatingEnergyConsumedRate1 ?? 0),
    power: Boolean(device.Power),
    raw: device,
  };
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class MELCloudHttpApiClient implements MELCloudApiClient {
  private readonly fetchFn: FetchLike;

  constructor(options: MELCloudHttpApiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? (fetch as FetchLike);
  }

  async login(email: string, password: string): Promise<string> {
    const response = await this.fetchFn(`${API_BASE}/Login/ClientLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Email: email,
        Password: password,
        Language: 0,
        AppVersion: APP_VERSION,
        Persist: false,
        CaptchaResponse: null,
      }),
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new MELCloudTransportError("MALFORMED_RESPONSE", "MELCloud login response was not valid JSON.", undefined, false);
    }

    const loginData = (data as Record<string, unknown>)?.LoginData as Record<string, unknown> | undefined;
    const contextKey = loginData?.ContextKey;

    if (typeof contextKey !== "string" || !contextKey) {
      throw new MELCloudTransportError("MALFORMED_RESPONSE", "MELCloud login response missing LoginData.ContextKey.", undefined, false);
    }

    return contextKey;
  }

  async getDevices(contextKey: string): Promise<MELCloudDevice[]> {
    const response = await this.fetchFn(`${API_BASE}/User/ListDevices`, {
      headers: { "X-MitsContextKey": contextKey },
    });

    const text = await response.text();
    assertResponse(response, text);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new MELCloudTransportError("MALFORMED_RESPONSE", "MELCloud ListDevices response was not valid JSON.", undefined, false);
    }

    return flattenDevices(data);
  }

  async setAtw(contextKey: string, settings: MELCloudAtwSettings): Promise<MELCloudCommandResult> {
    const response = await this.fetchFn(`${API_BASE}/Device/SetAtw`, {
      method: "POST",
      headers: {
        "X-MitsContextKey": contextKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    const text = await response.text();
    if (!response.ok) {
      throw normaliseStatusError(response.status, text);
    }

    return { success: true, message: `ATW settings applied for device ${settings.DeviceID}.` };
  }
}

// Export the flag constant for use in adapters.
export { EFFECTIVE_FLAG_ZONE1_TEMPERATURE };
