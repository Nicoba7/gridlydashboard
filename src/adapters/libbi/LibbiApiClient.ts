import * as crypto from "node:crypto";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_BASE_URL = "https://s18.myenergi.net";
const DIRECTOR_URL = "https://director.myenergi.com/cgi-jstatus-L";

export type LibbiChargeMode = 1 | 2 | 3 | 4;

export interface LibbiStatusPayload {
  libbiSerial: string;
  chargeMode: LibbiChargeMode;
  batteryPowerW: number;
  batterySocPercent: number;
  isCharging: boolean;
  raw: unknown;
}

export interface LibbiCommandResult {
  success: boolean;
  message?: string;
}

export type LibbiTransportErrorCode =
  | "AUTH_FAILURE"
  | "UNSUPPORTED_DEVICE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TEMPORARY_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "NETWORK_ERROR";

export class LibbiTransportError extends Error {
  constructor(
    public readonly code: LibbiTransportErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "LibbiTransportError";
  }
}

export interface LibbiApiClient {
  login(hubSerial: string, apiKey: string): Promise<{ directorBaseUrl: string }>;
  getStatus(hubSerial: string, libbiSerial: string): Promise<LibbiStatusPayload>;
  setChargeMode(hubSerial: string, libbiSerial: string, mode: LibbiChargeMode): Promise<LibbiCommandResult>;
}

export interface LibbiHttpApiClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function normaliseStatusError(status: number, message: string): LibbiTransportError {
  if (status === 401 || status === 403) {
    return new LibbiTransportError("AUTH_FAILURE", message, status, false);
  }
  if (status === 404) {
    return new LibbiTransportError("UNSUPPORTED_DEVICE", message, status, false);
  }
  if (status === 429) {
    return new LibbiTransportError("RATE_LIMIT", message, status, true);
  }
  if (status >= 500) {
    return new LibbiTransportError("TEMPORARY_UNAVAILABLE", message, status, true);
  }
  return new LibbiTransportError("NETWORK_ERROR", message, status, false);
}

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function parseDigestChallenge(header: string): Record<string, string> {
  const trimmed = header.replace(/^Digest\s+/i, "");
  const parts = trimmed.match(/(\w+)=(?:"([^"]*)"|([^,]+))/g) ?? [];
  const values: Record<string, string> = {};

  for (const part of parts) {
    const [key, value] = part.split("=");
    values[key.trim()] = value.trim().replace(/^"|"$/g, "");
  }

  return values;
}

function buildDigestAuthHeader(options: {
  challengeHeader: string;
  method: string;
  uriPathWithQuery: string;
  username: string;
  password: string;
  nc: string;
  cnonce: string;
}): string {
  const challenge = parseDigestChallenge(options.challengeHeader);
  const realm = challenge.realm;
  const nonce = challenge.nonce;

  if (!realm || !nonce) {
    throw new LibbiTransportError(
      "MALFORMED_RESPONSE",
      "Digest challenge missing realm or nonce.",
      undefined,
      false,
    );
  }

  const algorithm = (challenge.algorithm ?? "MD5").toUpperCase();
  if (algorithm !== "MD5") {
    throw new LibbiTransportError(
      "MALFORMED_RESPONSE",
      `Unsupported digest algorithm: ${algorithm}`,
      undefined,
      false,
    );
  }

  const qop = challenge.qop?.includes("auth") ? "auth" : undefined;
  const ha1 = md5(`${options.username}:${realm}:${options.password}`);
  const ha2 = md5(`${options.method}:${options.uriPathWithQuery}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${options.nc}:${options.cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const fragments = [
    `Digest username="${options.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${options.uriPathWithQuery}"`,
    `response="${response}"`,
    `algorithm=MD5`,
  ];

  if (challenge.opaque) {
    fragments.push(`opaque="${challenge.opaque}"`);
  }

  if (qop) {
    fragments.push(`qop=${qop}`);
    fragments.push(`nc=${options.nc}`);
    fragments.push(`cnonce="${options.cnonce}"`);
  }

  return fragments.join(", ");
}

function assertLibbiStatusShape(payload: unknown, libbiSerial: string): LibbiStatusPayload {
  const root = payload as Record<string, unknown> | undefined;
  const libbiEntries = root?.libbi;

  if (!Array.isArray(libbiEntries)) {
    throw new LibbiTransportError(
      "MALFORMED_RESPONSE",
      "myenergi status response missing libbi list.",
      undefined,
      false,
    );
  }

  const target = (libbiEntries as Record<string, unknown>[]).find((entry) => {
    const sno = String(entry.sno ?? "");
    return sno === libbiSerial;
  }) ?? (libbiEntries[0] as Record<string, unknown> | undefined);

  if (!target) {
    throw new LibbiTransportError(
      "UNSUPPORTED_DEVICE",
      `Libbi serial "${libbiSerial}" not found in myenergi response.`,
      404,
      false,
    );
  }

  const mode = Number(target.lmo ?? target.mode ?? 4);
  // lba = Libbi battery power W; ectp1 = CT clamp reading; div = diversion power
  const batteryPowerW = Number(target.lba ?? target.ectp1 ?? target.div ?? 0);
  // soc/lsoc = state of charge percentage reported by the Libbi
  const socRaw = target.soc ?? target.lsoc ?? target.bat ?? 0;
  const batterySocPercent = Number(socRaw);
  // cha: 1 = charging, sta: charging state flags
  const chaRaw = Number(target.cha ?? target.sta ?? 0);
  const isCharging = chaRaw > 0 || batteryPowerW > 0;

  return {
    libbiSerial: String(target.sno ?? libbiSerial),
    chargeMode: (Number.isFinite(mode) ? Math.max(1, Math.min(4, Math.round(mode))) : 4) as LibbiChargeMode,
    batteryPowerW: Number.isFinite(batteryPowerW) ? batteryPowerW : 0,
    batterySocPercent: Number.isFinite(batterySocPercent) ? Math.max(0, Math.min(100, batterySocPercent)) : 0,
    isCharging,
    raw: payload,
  };
}

export class LibbiHttpApiClient implements LibbiApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private directorBaseUrl: string | null = null;

  constructor(options: LibbiHttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async login(hubSerial: string, apiKey: string): Promise<{ directorBaseUrl: string }> {
    const response = await this.callDigestApi({
      absoluteUrl: DIRECTOR_URL,
      method: "GET",
      hubSerial,
      apiKey,
    });

    const directorHeader =
      response.headers.get("X-MYENERGI-ASBN") ??
      response.headers.get("x-myenergi-asbn");

    const directorBaseUrl = directorHeader?.trim();
    if (!directorBaseUrl) {
      throw new LibbiTransportError(
        "MALFORMED_RESPONSE",
        "myenergi director response missing X-MYENERGI-ASBN header.",
        response.status,
        false,
      );
    }

    this.directorBaseUrl = directorBaseUrl.startsWith("http")
      ? directorBaseUrl
      : `${this.baseUrl}`;

    return { directorBaseUrl: this.directorBaseUrl };
  }

  async getStatus(hubSerial: string, libbiSerial: string): Promise<LibbiStatusPayload> {
    const response = await this.callWithResolvedDirector({
      path: `/cgi-jstatus-L${encodeURIComponent(libbiSerial)}`,
      method: "GET",
      hubSerial,
    });

    const payload = await this.parseJsonOrThrow(response, "myenergi libbi status");
    return assertLibbiStatusShape(payload, libbiSerial);
  }

  async setChargeMode(
    hubSerial: string,
    libbiSerial: string,
    mode: LibbiChargeMode,
  ): Promise<LibbiCommandResult> {
    await this.callWithResolvedDirector({
      path: `/cgi-libbi-mode-L${encodeURIComponent(libbiSerial)}-${mode}`,
      method: "GET",
      hubSerial,
    });

    return { success: true, message: `Libbi mode set to ${mode}` };
  }

  private async callWithResolvedDirector(options: {
    path: string;
    method: "GET" | "POST";
    hubSerial: string;
    body?: string;
  }): Promise<Response> {
    const apiKey = process.env.ZAPPI_API_KEY?.trim();
    if (!apiKey) {
      throw new LibbiTransportError("AUTH_FAILURE", "Missing ZAPPI_API_KEY env var.", undefined, false);
    }

    if (!this.directorBaseUrl) {
      await this.login(options.hubSerial, apiKey);
    }

    const base = this.directorBaseUrl ?? this.baseUrl;
    const absoluteUrl = `${base}${options.path}`;

    return this.callDigestApi({
      absoluteUrl,
      method: options.method,
      hubSerial: options.hubSerial,
      apiKey,
      body: options.body,
    });
  }

  private async callDigestApi(options: {
    absoluteUrl: string;
    method: "GET" | "POST";
    hubSerial: string;
    apiKey: string;
    body?: string;
  }): Promise<Response> {
    const url = new URL(options.absoluteUrl);
    const uriPathWithQuery = `${url.pathname}${url.search}`;

    let challengeResponse: Response;
    try {
      challengeResponse = await this.fetchFn(url.toString(), {
        method: options.method,
        body: options.body,
      });
    } catch {
      throw new LibbiTransportError("NETWORK_ERROR", "myenergi request failed.", undefined, true);
    }

    const digestChallenge = challengeResponse.headers.get("www-authenticate");

    if (challengeResponse.status !== 401 && challengeResponse.ok) {
      return challengeResponse;
    }

    if (!digestChallenge || !/^Digest/i.test(digestChallenge)) {
      throw normaliseStatusError(
        challengeResponse.status,
        `myenergi request failed with status ${challengeResponse.status} and no digest challenge.`,
      );
    }

    const cnonce = randomHex(12);
    const nc = "00000001";
    const authorization = buildDigestAuthHeader({
      challengeHeader: digestChallenge,
      method: options.method,
      uriPathWithQuery,
      username: options.hubSerial,
      password: options.apiKey,
      nc,
      cnonce,
    });

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: options.method,
        body: options.body,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
      });
    } catch {
      throw new LibbiTransportError("NETWORK_ERROR", "myenergi request failed.", undefined, true);
    }

    if (!response.ok) {
      throw normaliseStatusError(
        response.status,
        `myenergi request to ${uriPathWithQuery} failed with status ${response.status}.`,
      );
    }

    return response;
  }

  private async parseJsonOrThrow(response: Response, operationLabel: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new LibbiTransportError(
        "MALFORMED_RESPONSE",
        `${operationLabel} response was not valid JSON.`,
        response.status,
        false,
      );
    }
  }
}
