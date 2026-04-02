type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://www.foxesscloud.com/op/v0";

export interface FoxESSDevice {
  deviceSN: string;
  raw: unknown;
}

export interface FoxESSRealTimeData {
  deviceSN: string;
  batterySocPercent: number;
  solarPowerW: number;
  gridPowerW: number;
  loadPowerW: number;
  batteryPowerW?: number;
  raw: unknown;
}

export interface FoxESSCommandResult {
  success: boolean;
  message?: string;
}

export interface FoxESSChargeTimes {
  startAt: string;
  endAt: string;
}

export type FoxESSTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class FoxESSTransportError extends Error {
  constructor(
    public readonly code: FoxESSTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "FoxESSTransportError";
  }
}

export interface FoxESSApiClient {
  getDeviceList(apiKey: string): Promise<FoxESSDevice[]>;
  getRealTimeData(apiKey: string, deviceSN: string): Promise<FoxESSRealTimeData>;
  setChargeTimes(apiKey: string, deviceSN: string, times: FoxESSChargeTimes): Promise<FoxESSCommandResult>;
}

export interface FoxESSHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): FoxESSTransportError {
  if (status === 401 || status === 403) {
    return new FoxESSTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 404) {
    return new FoxESSTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 408) {
    return new FoxESSTransportError("TIMEOUT", message, status, true);
  }
  if (status === 429) {
    return new FoxESSTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new FoxESSTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new FoxESSTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseDeviceList(payload: unknown): FoxESSDevice[] {
  const root = payload as Record<string, unknown> | undefined;
  const result = (root?.result as Record<string, unknown> | undefined) ?? root;
  const rows =
    (result?.data as unknown[] | undefined) ??
    (result?.list as unknown[] | undefined) ??
    (root?.data as unknown[] | undefined) ??
    (root?.list as unknown[] | undefined);

  if (!Array.isArray(rows)) {
    throw new FoxESSTransportError(
      "MALFORMED_RESPONSE",
      "FoxESS device list response missing device array.",
      undefined,
      false,
    );
  }

  return rows
    .map((row) => {
      const item = row as Record<string, unknown>;
      const deviceSN = String(item.deviceSN ?? item.deviceSn ?? item.sn ?? "").trim();
      if (!deviceSN) return null;
      return { deviceSN, raw: row } as FoxESSDevice;
    })
    .filter((item): item is FoxESSDevice => item !== null);
}

function parseRealTimeData(payload: unknown, deviceSN: string): FoxESSRealTimeData {
  const root = payload as Record<string, unknown> | undefined;
  const result = (root?.result as Record<string, unknown> | undefined) ?? root;
  const data = (result?.data as Record<string, unknown> | undefined) ?? result;

  const batterySocPercent =
    toFiniteNumber(data?.batterySocPercent) ??
    toFiniteNumber(data?.batterySoc) ??
    toFiniteNumber(data?.soc);

  const solarPowerW =
    toFiniteNumber(data?.solarPower) ??
    toFiniteNumber(data?.pvPower) ??
    toFiniteNumber(data?.generationPower) ??
    0;

  const gridPowerW =
    toFiniteNumber(data?.gridPower) ??
    toFiniteNumber(data?.grid) ??
    0;

  const loadPowerW =
    toFiniteNumber(data?.loadPower) ??
    toFiniteNumber(data?.loadsPower) ??
    0;

  const batteryPowerW =
    toFiniteNumber(data?.batteryPower) ??
    toFiniteNumber(data?.chargeDischargePower) ??
    undefined;

  if (batterySocPercent === null) {
    throw new FoxESSTransportError(
      "MALFORMED_RESPONSE",
      "FoxESS real-time response missing battery SoC.",
      undefined,
      false,
    );
  }

  return {
    deviceSN,
    batterySocPercent,
    solarPowerW,
    gridPowerW,
    loadPowerW,
    batteryPowerW,
    raw: payload,
  };
}

export class FoxESSHttpApiClient implements FoxESSApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: FoxESSHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getDeviceList(apiKey: string): Promise<FoxESSDevice[]> {
    const payload = await this.callApi("/device/list", apiKey, {
      method: "GET",
    });
    return parseDeviceList(payload);
  }

  async getRealTimeData(apiKey: string, deviceSN: string): Promise<FoxESSRealTimeData> {
    const payload = await this.callApi("/device/real/query", apiKey, {
      method: "POST",
      body: { deviceSN },
    });
    return parseRealTimeData(payload, deviceSN);
  }

  async setChargeTimes(apiKey: string, deviceSN: string, times: FoxESSChargeTimes): Promise<FoxESSCommandResult> {
    await this.callApi("/device/battery/forceChargeTime/set", apiKey, {
      method: "POST",
      body: {
        deviceSN,
        ...times,
      },
    });

    return {
      success: true,
      message: `FoxESS force charge scheduled ${times.startAt} -> ${times.endAt}.`,
    };
  }

  private async callApi(
    path: string,
    apiKey: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown> },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method,
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          Accept: "application/json",
          token: apiKey,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new FoxESSTransportError(
        "NETWORK_ERROR",
        "FoxESS Cloud API network request failed.",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      throw normaliseStatusError(
        response.status,
        `FoxESS Cloud API request to ${path} failed with status ${response.status}.`,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new FoxESSTransportError(
        "MALFORMED_RESPONSE",
        "FoxESS Cloud API returned non-JSON response.",
        response.status,
        false,
      );
    }
  }
}
