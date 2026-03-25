import type { DeviceMode } from "../../domain";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── Response shapes ────────────────────────────────────────────────────────────

export interface GivEnergySystemDataPayload {
  /** Inverter serial used as the canonical device ID. */
  inverterSerial: string;
  /** ISO-8601 timestamp from the API response. */
  timestamp: string;
  /** Battery state of charge, 0–100. */
  batterySocPercent: number;
  /** Net battery power in watts: positive = charging, negative = discharging. */
  batteryPowerW: number;
  /** Usable battery capacity in kWh. */
  batteryCapacityKwh: number;
  /** AC solar generation in watts. */
  solarPowerW: number;
  /** Net grid power in watts: positive = importing. */
  gridPowerW: number;
}

export interface GivEnergyCommandResult {
  /** True when the inverter acknowledged the command. */
  success: boolean;
  /** Raw message returned by the API. */
  message?: string;
}

// ── Error types ────────────────────────────────────────────────────────────────

export type GivEnergyTransportErrorCode =
  | "UNSUPPORTED_DEVICE"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class GivEnergyTransportError extends Error {
  constructor(
    public readonly code: GivEnergyTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "GivEnergyTransportError";
  }
}

// ── Client interface ───────────────────────────────────────────────────────────

export interface GivEnergyApiClient {
  readSystemData(inverterSerial: string): Promise<GivEnergySystemDataPayload>;
  setChargeTarget(inverterSerial: string, mode: DeviceMode): Promise<GivEnergyCommandResult>;
}

// ── HTTP transport ─────────────────────────────────────────────────────────────

export interface GivEnergyHttpApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normalizeStatusError(status: number, message: string): GivEnergyTransportError {
  if (status === 401 || status === 403) {
    return new GivEnergyTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 422) {
    return new GivEnergyTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 429) {
    return new GivEnergyTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new GivEnergyTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new GivEnergyTransportError("NETWORK_ERROR", message, status, false);
}

/**
 * Maps a canonical DeviceMode to the `target_soc` and `enable_charge` /
 * `enable_discharge` flags that GivEnergy's set-charge-target command accepts.
 *
 * - charge  → enable charging at full target (100 %)
 * - discharge → disable charging so the battery self-discharges to load
 * - hold / anything else → target current SoC (no net charge or discharge)
 */
function modeToCommandBody(mode: DeviceMode): Record<string, unknown> {
  if (mode === "charge") {
    return { target_soc: 100, enable_charge: true, enable_discharge: false };
  }
  if (mode === "discharge") {
    return { target_soc: 5, enable_charge: false, enable_discharge: true };
  }
  // hold / eco / auto / stop → keep at current level, no forced cycling
  return { enable_charge: false, enable_discharge: false };
}

function assertSystemDataShape(
  inverterSerial: string,
  payload: unknown,
): GivEnergySystemDataPayload {
  const data = (payload as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") {
    throw new GivEnergyTransportError(
      "MALFORMED_RESPONSE",
      "GivEnergy system-data response missing `data` object.",
      undefined,
      false,
    );
  }

  const battery = data["battery"] as Record<string, unknown> | undefined;
  const solar = data["solar"] as Record<string, unknown> | undefined;
  const grid = data["grid"] as Record<string, unknown> | undefined;
  const time = data["time"];

  if (!battery || typeof battery !== "object") {
    throw new GivEnergyTransportError(
      "MALFORMED_RESPONSE",
      "GivEnergy system-data missing battery object.",
      undefined,
      false,
    );
  }

  const socPercent = battery["percent"];
  const batteryPower = battery["power"];

  if (typeof socPercent !== "number" || !Number.isFinite(socPercent)) {
    throw new GivEnergyTransportError(
      "MALFORMED_RESPONSE",
      "GivEnergy system-data battery.percent is not a finite number.",
      undefined,
      false,
    );
  }

  // GivEnergy returns a time string like "2024-01-15 10:30:00"; normalise to ISO-8601.
  const rawTime = typeof time === "string" ? time : new Date().toISOString();
  const timestamp = rawTime.includes("T") ? rawTime : rawTime.replace(" ", "T") + "Z";

  const inverter = data["inverter"] as Record<string, unknown> | undefined;
  const capacityKwh =
    typeof inverter?.["battery_capacity"] === "number"
      ? (inverter["battery_capacity"] as number)
      : 9.5; // sensible default for a GivEnergy 9.5 kWh unit

  return {
    inverterSerial,
    timestamp,
    batterySocPercent: socPercent,
    batteryPowerW: typeof batteryPower === "number" ? batteryPower : 0,
    batteryCapacityKwh: capacityKwh,
    solarPowerW:
      typeof (solar as Record<string, unknown> | undefined)?.["power"] === "number"
        ? ((solar as Record<string, unknown>)["power"] as number)
        : 0,
    gridPowerW:
      typeof (grid as Record<string, unknown> | undefined)?.["power"] === "number"
        ? ((grid as Record<string, unknown>)["power"] as number)
        : 0,
  };
}

function assertCommandResultShape(payload: unknown): GivEnergyCommandResult {
  const data = (payload as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") {
    throw new GivEnergyTransportError(
      "MALFORMED_RESPONSE",
      "GivEnergy command response missing `data` object.",
      undefined,
      false,
    );
  }

  const success = (data as Record<string, unknown>)["success"];
  return {
    success: success === true,
    message:
      typeof (data as Record<string, unknown>)["message"] === "string"
        ? String((data as Record<string, unknown>)["message"])
        : undefined,
  };
}

/**
 * Production HTTP transport for the GivEnergy Cloud API v1.
 */
export class GivEnergyHttpApiClient implements GivEnergyApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: GivEnergyHttpApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.givenergy.cloud/v1";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async readSystemData(inverterSerial: string): Promise<GivEnergySystemDataPayload> {
    const payload = await this.callApi(
      `/inverter/${encodeURIComponent(inverterSerial)}/system-data/latest`,
      { method: "GET" },
    );
    return assertSystemDataShape(inverterSerial, payload);
  }

  async setChargeTarget(inverterSerial: string, mode: DeviceMode): Promise<GivEnergyCommandResult> {
    const body = modeToCommandBody(mode);
    const payload = await this.callApi(
      `/inverter/${encodeURIComponent(inverterSerial)}/commands/set-charge-target`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    return assertCommandResultShape(payload);
  }

  private async callApi(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch {
      throw new GivEnergyTransportError(
        "NETWORK_ERROR",
        "GivEnergy API network request failed.",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      throw normalizeStatusError(
        response.status,
        `GivEnergy API request failed with status ${response.status}.`,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new GivEnergyTransportError(
        "MALFORMED_RESPONSE",
        "GivEnergy API returned non-JSON response.",
        response.status,
        false,
      );
    }
  }
}
