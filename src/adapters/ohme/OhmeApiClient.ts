/**
 * OhmeApiClient — HTTP transport for the Ohme EV charger.
 *
 * ⚠️  UNOFFICIAL API — Ohme does not publish a public API specification.
 * This client was reverse-engineered from the Ohme mobile app's network traffic
 * and community documentation. Endpoint paths, request/response shapes, and auth
 * mechanisms may change without notice if Ohme updates their backend.
 *
 * Tested against Ohme Home Pro firmware running api.ohme.io v1 circa 2025.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.ohme.io/v1";

// ── Response shapes ────────────────────────────────────────────────────────────

export interface OhmeLoginPayload {
  token: string;
  userId: string;
}

export interface OhmeChargeDevicePayload {
  /** Stable device identifier — used as canonical device ID. */
  id: string;
  serialNumber: string;
  model: string;
  online: boolean;
  /** Current charger mode as reported by the device. */
  mode: "CHARGE" | "MAX_CHARGE" | "SMART_CHARGE" | "PAUSED" | "DISCONNECTED" | string;
  /** Active power draw in watts (null when car not connected). */
  power: number | null;
  /** True when a car is plugged in. */
  carConnected: boolean;
  car?: {
    /** Total battery capacity in watt-hours. */
    batteryCapacityWh?: number;
    /** Current battery level as a percentage 0–100. */
    carBatteryLevel?: number;
  };
}

export interface OhmeCommandResult {
  success: boolean;
  message?: string;
}

// ── Error types ────────────────────────────────────────────────────────────────

export type OhmeTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class OhmeTransportError extends Error {
  constructor(
    public readonly code: OhmeTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "OhmeTransportError";
  }
}

// ── Client interface ───────────────────────────────────────────────────────────

export interface OhmeApiClient {
  /** Authenticate and return a fresh Bearer token. */
  login(): Promise<OhmeLoginPayload>;
  /** Fetch all charge devices registered to this account. */
  getChargeDevices(token: string): Promise<OhmeChargeDevicePayload[]>;
  /** Post a charge schedule window to the specified device. */
  postSchedule(
    token: string,
    deviceId: string,
    startEpochSeconds: number,
    endEpochSeconds: number,
  ): Promise<OhmeCommandResult>;
}

// ── HTTP transport ─────────────────────────────────────────────────────────────

export interface OhmeHttpApiClientOptions {
  email: string;
  password: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): OhmeTransportError {
  if (status === 401 || status === 403) {
    return new OhmeTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 404) {
    return new OhmeTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 429) {
    return new OhmeTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new OhmeTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new OhmeTransportError("NETWORK_ERROR", message, status, false);
}

function assertLoginShape(payload: unknown): OhmeLoginPayload {
  const data = payload as Record<string, unknown> | undefined;
  if (!data || typeof data["token"] !== "string") {
    throw new OhmeTransportError(
      "MALFORMED_RESPONSE",
      "Ohme login response missing token.",
      undefined,
      false,
    );
  }
  return {
    token: data["token"] as string,
    userId: typeof data["userId"] === "string" ? (data["userId"] as string) : "",
  };
}

function assertDeviceListShape(payload: unknown): OhmeChargeDevicePayload[] {
  if (!Array.isArray(payload)) {
    throw new OhmeTransportError(
      "MALFORMED_RESPONSE",
      "Ohme chargeDevices response is not an array.",
      undefined,
      false,
    );
  }

  return (payload as Record<string, unknown>[]).map((raw) => {
    if (typeof raw["id"] !== "string") {
      throw new OhmeTransportError(
        "MALFORMED_RESPONSE",
        "Ohme chargeDevice entry missing string id.",
        undefined,
        false,
      );
    }

    const car = raw["car"] as Record<string, unknown> | undefined;

    return {
      id: raw["id"] as string,
      serialNumber: typeof raw["serialNumber"] === "string" ? (raw["serialNumber"] as string) : "",
      model: typeof raw["model"] === "string" ? (raw["model"] as string) : "Ohme Charger",
      online: raw["online"] === true,
      mode: typeof raw["mode"] === "string" ? (raw["mode"] as string) : "UNKNOWN",
      power: typeof raw["power"] === "number" ? (raw["power"] as number) : null,
      carConnected: raw["carConnected"] === true,
      car: car
        ? {
            batteryCapacityWh:
              typeof car["batteryCapacityWh"] === "number"
                ? (car["batteryCapacityWh"] as number)
                : undefined,
            carBatteryLevel:
              typeof car["carBatteryLevel"] === "number"
                ? (car["carBatteryLevel"] as number)
                : undefined,
          }
        : undefined,
    };
  });
}

/**
 * Production HTTP transport for the Ohme unofficial API v1.
 */
export class OhmeHttpApiClient implements OhmeApiClient {
  private readonly email: string;
  private readonly password: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: OhmeHttpApiClientOptions) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(): Promise<OhmeLoginPayload> {
    const payload = await this.callApi("/users/me/login", {
      method: "POST",
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    return assertLoginShape(payload);
  }

  async getChargeDevices(token: string): Promise<OhmeChargeDevicePayload[]> {
    const payload = await this.callApi("/users/me/chargeDevices", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    return assertDeviceListShape(payload);
  }

  async postSchedule(
    token: string,
    deviceId: string,
    startEpochSeconds: number,
    endEpochSeconds: number,
  ): Promise<OhmeCommandResult> {
    await this.callApi(`/users/me/chargeDevices/${encodeURIComponent(deviceId)}/schedule`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        chargeSlots: [{ startTime: startEpochSeconds, endTime: endEpochSeconds }],
      }),
    });
    // Ohme returns 204 No Content on success; any non-error response counts as accepted.
    return { success: true };
  }

  private async callApi(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...((init.headers as Record<string, string>) ?? {}),
        },
      });
    } catch {
      throw new OhmeTransportError(
        "NETWORK_ERROR",
        "Ohme API network request failed.",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      throw normaliseStatusError(
        response.status,
        `Ohme API request to ${path} failed with status ${response.status}.`,
      );
    }

    // 204 No Content — return empty object
    if (response.status === 204) return {};

    try {
      return await response.json();
    } catch {
      throw new OhmeTransportError(
        "MALFORMED_RESPONSE",
        "Ohme API returned non-JSON response.",
        response.status,
        false,
      );
    }
  }
}
