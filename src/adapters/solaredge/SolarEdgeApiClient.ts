type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://monitoringapi.solaredge.com";

export type SolarEdgeBatteryControlMode =
  | "maximize_self_consumption"
  | "time_of_use"
  | "backup";

export interface SolarEdgeSiteOverview {
  siteId: string;
  currentPowerW: number;
  energyTodayWh: number;
  siteStatus: string;
  raw: unknown;
}

export interface SolarEdgeCurrentPowerFlow {
  siteId: string;
  gridPowerW: number;
  loadPowerW: number;
  pvPowerW: number;
  storagePowerW: number;
  raw: unknown;
}

export interface SolarEdgeBatteryControlResult {
  success: boolean;
  message?: string;
}

export type SolarEdgeTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class SolarEdgeTransportError extends Error {
  constructor(
    public readonly code: SolarEdgeTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SolarEdgeTransportError";
  }
}

export interface SolarEdgeApiClient {
  getSiteOverview(siteId: string, apiKey: string): Promise<SolarEdgeSiteOverview>;
  getCurrentPowerFlow(siteId: string, apiKey: string): Promise<SolarEdgeCurrentPowerFlow>;
  setBatteryControl(
    siteId: string,
    apiKey: string,
    mode: SolarEdgeBatteryControlMode,
  ): Promise<SolarEdgeBatteryControlResult>;
}

export interface SolarEdgeHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): SolarEdgeTransportError {
  if (status === 401 || status === 403) {
    return new SolarEdgeTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 404) {
    return new SolarEdgeTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 408) {
    return new SolarEdgeTransportError("TIMEOUT", message, status, true);
  }
  if (status === 429) {
    return new SolarEdgeTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new SolarEdgeTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new SolarEdgeTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseSiteOverview(payload: unknown, siteId: string): SolarEdgeSiteOverview {
  const root = payload as Record<string, unknown> | undefined;
  const overview = (root?.overview as Record<string, unknown> | undefined) ?? root;

  const currentPowerNode = overview?.currentPower as Record<string, unknown> | undefined;
  const currentPowerW =
    toFiniteNumber(currentPowerNode?.power) ??
    toFiniteNumber(currentPowerNode?.value) ??
    toFiniteNumber(overview?.currentPower);

  const lastDayNode = overview?.lastDayData as Record<string, unknown> | undefined;
  const energyTodayWh =
    toFiniteNumber(lastDayNode?.energy) ??
    toFiniteNumber(lastDayNode?.energyWh) ??
    toFiniteNumber(overview?.energyToday) ??
    toFiniteNumber(overview?.lastDayEnergy) ??
    0;

  const siteStatus = String(overview?.status ?? overview?.siteStatus ?? "unknown");

  if (currentPowerW === null) {
    throw new SolarEdgeTransportError(
      "MALFORMED_RESPONSE",
      "SolarEdge site overview response missing current power.",
      undefined,
      false,
    );
  }

  return {
    siteId,
    currentPowerW,
    energyTodayWh,
    siteStatus,
    raw: payload,
  };
}

function parsePowerValue(node: unknown): number {
  const recordNode = node as Record<string, unknown> | undefined;
  return (
    toFiniteNumber(recordNode?.currentPower) ??
    toFiniteNumber(recordNode?.power) ??
    toFiniteNumber(recordNode?.value) ??
    0
  );
}

function parseCurrentPowerFlow(payload: unknown, siteId: string): SolarEdgeCurrentPowerFlow {
  const root = payload as Record<string, unknown> | undefined;
  const flow =
    (root?.siteCurrentPowerFlow as Record<string, unknown> | undefined) ??
    (root?.currentPowerFlow as Record<string, unknown> | undefined) ??
    root;

  const gridPowerW = parsePowerValue(flow?.GRID);
  const loadPowerW = parsePowerValue(flow?.LOAD);
  const pvPowerW = parsePowerValue(flow?.PV);
  const storagePowerW = parsePowerValue(flow?.STORAGE);

  const hasAnyPowerNode = flow?.GRID || flow?.LOAD || flow?.PV || flow?.STORAGE;
  if (!hasAnyPowerNode) {
    throw new SolarEdgeTransportError(
      "MALFORMED_RESPONSE",
      "SolarEdge power flow response missing GRID/LOAD/PV/STORAGE nodes.",
      undefined,
      false,
    );
  }

  return {
    siteId,
    gridPowerW,
    loadPowerW,
    pvPowerW,
    storagePowerW,
    raw: payload,
  };
}

export class SolarEdgeHttpApiClient implements SolarEdgeApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: SolarEdgeHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getSiteOverview(siteId: string, apiKey: string): Promise<SolarEdgeSiteOverview> {
    const payload = await this.callApi(`/site/${encodeURIComponent(siteId)}/overview`, apiKey, {
      method: "GET",
    });
    return parseSiteOverview(payload, siteId);
  }

  async getCurrentPowerFlow(siteId: string, apiKey: string): Promise<SolarEdgeCurrentPowerFlow> {
    const payload = await this.callApi(`/site/${encodeURIComponent(siteId)}/currentPowerFlow`, apiKey, {
      method: "GET",
    });
    return parseCurrentPowerFlow(payload, siteId);
  }

  async setBatteryControl(
    siteId: string,
    apiKey: string,
    mode: SolarEdgeBatteryControlMode,
  ): Promise<SolarEdgeBatteryControlResult> {
    await this.callApi(`/site/${encodeURIComponent(siteId)}/storageData`, apiKey, {
      method: "POST",
      body: { mode },
    });

    return {
      success: true,
      message: `Battery control mode set to ${mode}.`,
    };
  }

  private async callApi(
    path: string,
    apiKey: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown> },
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api_key", apiKey);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: options.method,
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new SolarEdgeTransportError(
        "NETWORK_ERROR",
        "SolarEdge API network request failed.",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      throw normaliseStatusError(
        response.status,
        `SolarEdge API request to ${path} failed with status ${response.status}.`,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new SolarEdgeTransportError(
        "MALFORMED_RESPONSE",
        "SolarEdge API returned non-JSON response.",
        response.status,
        false,
      );
    }
  }
}
