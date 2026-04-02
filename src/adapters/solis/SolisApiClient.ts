import * as crypto from "node:crypto";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://www.soliscloud.com:13333";

export interface SolisStation {
  stationId: string;
  raw: unknown;
}

export interface SolisInverterDetail {
  inverterId: string;
  currentPowerW: number;
  dailyYieldKwh: number;
  batterySocPercent: number;
  gridPowerW: number;
  batteryPowerW?: number;
  raw: unknown;
}

export interface SolisCommandResult {
  success: boolean;
  message?: string;
}

export type SolisScheduleMode = "charge" | "discharge";

export type SolisTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class SolisTransportError extends Error {
  constructor(
    public readonly code: SolisTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SolisTransportError";
  }
}

export interface SolisApiClient {
  getStationList(keyId: string, keySecret: string): Promise<SolisStation[]>;
  getInverterDetail(keyId: string, keySecret: string, inverterId: string): Promise<SolisInverterDetail>;
  setChargeDischargeTimes(
    keyId: string,
    keySecret: string,
    inverterId: string,
    startAt: string,
    endAt: string,
    mode: SolisScheduleMode,
  ): Promise<SolisCommandResult>;
}

export interface SolisHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): SolisTransportError {
  if (status === 401 || status === 403) {
    return new SolisTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 404) {
    return new SolisTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 408) {
    return new SolisTransportError("TIMEOUT", message, status, true);
  }
  if (status === 429) {
    return new SolisTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new SolisTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new SolisTransportError("NETWORK_ERROR", message, status, false);
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function md5Base64(content: string): string {
  return crypto.createHash("md5").update(content).digest("base64");
}

function hmacSha256Base64(secret: string, content: string): string {
  return crypto.createHmac("sha256", secret).update(content).digest("base64");
}

function parseStationList(payload: unknown): SolisStation[] {
  const root = payload as Record<string, unknown> | undefined;
  const data = (root?.data as Record<string, unknown> | undefined) ?? root;
  const page = data?.page as Record<string, unknown> | undefined;
  const rows =
    (page?.records as unknown[] | undefined) ??
    (data?.records as unknown[] | undefined) ??
    (data?.list as unknown[] | undefined) ??
    (root?.data as unknown[] | undefined);

  if (!Array.isArray(rows)) {
    throw new SolisTransportError(
      "MALFORMED_RESPONSE",
      "Solis station list response missing station array.",
      undefined,
      false,
    );
  }

  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      const stationId = String(record.stationId ?? record.id ?? record.stationID ?? "").trim();
      if (!stationId) return null;
      return { stationId, raw: row } as SolisStation;
    })
    .filter((row): row is SolisStation => row !== null);
}

function parseInverterDetail(payload: unknown, inverterId: string): SolisInverterDetail {
  const root = payload as Record<string, unknown> | undefined;
  const data = (root?.data as Record<string, unknown> | undefined) ?? root;

  const currentPowerW =
    toFiniteNumber(data?.currentPower) ??
    toFiniteNumber(data?.pac) ??
    toFiniteNumber(data?.power) ??
    toFiniteNumber(data?.pvPower);

  const dailyYieldKwh =
    toFiniteNumber(data?.dayEnergy) ??
    toFiniteNumber(data?.dailyYield) ??
    toFiniteNumber(data?.eToday) ??
    0;

  const batterySocPercent =
    toFiniteNumber(data?.batterySoc) ??
    toFiniteNumber(data?.soc) ??
    toFiniteNumber(data?.batterySOC);

  const gridPowerW =
    toFiniteNumber(data?.gridPower) ??
    toFiniteNumber(data?.meterPower) ??
    0;

  const batteryPowerW =
    toFiniteNumber(data?.batteryPower) ??
    toFiniteNumber(data?.chargeDischargePower) ??
    undefined;

  if (currentPowerW === null || batterySocPercent === null) {
    throw new SolisTransportError(
      "MALFORMED_RESPONSE",
      "Solis inverter detail missing current power or battery SoC.",
      undefined,
      false,
    );
  }

  return {
    inverterId,
    currentPowerW,
    dailyYieldKwh,
    batterySocPercent,
    gridPowerW,
    batteryPowerW,
    raw: payload,
  };
}

export class SolisHttpApiClient implements SolisApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: SolisHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getStationList(keyId: string, keySecret: string): Promise<SolisStation[]> {
    const payload = await this.callApi("/v1/api/stationList", keyId, keySecret, {
      method: "POST",
      body: {},
    });
    return parseStationList(payload);
  }

  async getInverterDetail(keyId: string, keySecret: string, inverterId: string): Promise<SolisInverterDetail> {
    const payload = await this.callApi("/v1/api/inverterDetail", keyId, keySecret, {
      method: "POST",
      body: { inverterId },
    });
    return parseInverterDetail(payload, inverterId);
  }

  async setChargeDischargeTimes(
    keyId: string,
    keySecret: string,
    inverterId: string,
    startAt: string,
    endAt: string,
    mode: SolisScheduleMode,
  ): Promise<SolisCommandResult> {
    await this.callApi("/v1/api/atWrite", keyId, keySecret, {
      method: "POST",
      body: {
        inverterId,
        mode,
        startAt,
        endAt,
      },
    });

    return {
      success: true,
      message: `Solis ${mode} schedule set from ${startAt} to ${endAt}.`,
    };
  }

  private async callApi(
    path: string,
    keyId: string,
    keySecret: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown> },
  ): Promise<unknown> {
    const body = options.body ? JSON.stringify(options.body) : "";
    const contentType = "application/json";
    const contentMd5 = md5Base64(body);
    const date = new Date().toUTCString();
    const stringToSign = [options.method, contentMd5, contentType, date, path].join("\n");
    const signature = hmacSha256Base64(keySecret, stringToSign);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: options.method,
        body: body || undefined,
        headers: {
          "Content-Type": contentType,
          "Content-MD5": contentMd5,
          Date: date,
          Authorization: `API ${keyId}:${signature}`,
          Accept: "application/json",
        },
      });
    } catch {
      throw new SolisTransportError(
        "NETWORK_ERROR",
        "Solis Cloud API network request failed.",
        undefined,
        true,
      );
    }

    if (!response.ok) {
      throw normaliseStatusError(
        response.status,
        `Solis Cloud API request to ${path} failed with status ${response.status}.`,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new SolisTransportError(
        "MALFORMED_RESPONSE",
        "Solis Cloud API returned non-JSON response.",
        response.status,
        false,
      );
    }
  }
}
