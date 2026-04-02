import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibbiAdapter } from "../adapters/libbi/LibbiAdapter";
import {
  LibbiHttpApiClient,
  LibbiTransportError,
  type LibbiApiClient,
  type LibbiStatusPayload,
} from "../adapters/libbi/LibbiApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "libbi-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const HUB_SERIAL = "HUB123456";
const API_KEY = "api-key-123";
const LIBBI_SERIAL = "LIB123456";

const statusPayload: LibbiStatusPayload = {
  libbiSerial: LIBBI_SERIAL,
  chargeMode: 1,
  batteryPowerW: 2500,
  batterySocPercent: 62,
  isCharging: true,
  raw: { libbi: [{ sno: LIBBI_SERIAL }] },
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    startAt: "2026-04-02T00:30:00.000Z",
    endAt: "2026-04-02T03:30:00.000Z",
  },
};

function makeClient(overrides: Partial<LibbiApiClient> = {}): LibbiApiClient {
  return {
    login: vi.fn(async () => ({ directorBaseUrl: "https://s18.myenergi.net" })),
    getStatus: vi.fn(async () => statusPayload),
    setChargeMode: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "LibbiAdapter contract harness",
  createAdapter: () =>
    new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: statusPayload,
  vendorErrorSample: new LibbiTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

describe("LibbiAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("declares expected capabilities", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    expect(adapter.capabilities).toEqual(["read_soc", "read_power", "schedule_window"]);
  });

  it("calls login before reading telemetry", async () => {
    const client = makeClient();
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client,
    });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledWith(HUB_SERIAL, API_KEY);
    expect(client.getStatus).toHaveBeenCalledWith(HUB_SERIAL, LIBBI_SERIAL);
  });

  it("maps telemetry into canonical fields", async () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const telemetry = await adapter.readTelemetry();

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].batterySocPercent).toBe(62);
    expect(telemetry[0].batteryPowerW).toBe(2500);
    expect(telemetry[0].chargingState).toBe("charging");
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
  });

  it("maps isCharging=false and mode=4 to idle", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...statusPayload,
      batteryPowerW: 0,
      isCharging: false,
      chargeMode: 4,
    });

    expect(event.chargingState).toBe("idle");
  });

  it("maps isCharging=false and mode=1 to idle", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...statusPayload,
      batteryPowerW: 0,
      isCharging: false,
      chargeMode: 1,
    });

    expect(event.chargingState).toBe("idle");
  });

  it("maps correct SoC from status payload", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...statusPayload,
      batterySocPercent: 85,
    });

    expect(event.batterySocPercent).toBe(85);
  });

  it("dispatches non-schedule commands as accepted no-op", async () => {
    const client = makeClient();
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client,
    });

    const result = await adapter.dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setChargeMode).not.toHaveBeenCalled();
  });

  it("schedules charge mode and stop mode for schedule_window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    expect(client.setChargeMode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setChargeMode).toHaveBeenCalledWith(HUB_SERIAL, LIBBI_SERIAL, 1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 1);
    expect(client.setChargeMode).toHaveBeenCalledWith(HUB_SERIAL, LIBBI_SERIAL, 4);
    expect(client.setChargeMode).toHaveBeenCalledTimes(2);
  });

  it("executes immediately when schedule start is in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T04:00:00.000Z"));

    const client = makeClient();
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setChargeMode).toHaveBeenCalledWith(HUB_SERIAL, LIBBI_SERIAL, 1);
    expect(client.setChargeMode).toHaveBeenCalledWith(HUB_SERIAL, LIBBI_SERIAL, 4);
  });

  it("throws unsupported device for foreign target", async () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    await expect(
      adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("maps AUTH_FAILURE to UNAUTHORIZED", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new LibbiTransportError("AUTH_FAILURE", "bad auth", 401, false),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new LibbiTransportError("TEMPORARY_UNAVAILABLE", "down", 503, true),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new LibbiTransportError("RATE_LIMIT", "too many requests", 429, true),
      "telemetry_read",
    );

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE", () => {
    const adapter = new LibbiAdapter({
      deviceId: DEVICE_ID,
      hubSerial: HUB_SERIAL,
      apiKey: API_KEY,
      libbiSerial: LIBBI_SERIAL,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new LibbiTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "telemetry_read",
    );

    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });
});

describe("LibbiHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ZAPPI_API_KEY = API_KEY;
  });

  it("login resolves director URL from X-MYENERGI-ASBN header", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.login(HUB_SERIAL, API_KEY);

    expect(result.directorBaseUrl).toBe("https://s18.myenergi.net");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("getStatus calls cgi-jstatus-L endpoint for libbi serial", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce2", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          libbi: [{ sno: LIBBI_SERIAL, lmo: 1, lba: 2500, soc: 62, cha: 1 }],
        }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getStatus(HUB_SERIAL, LIBBI_SERIAL);

    expect(status.libbiSerial).toBe(LIBBI_SERIAL);
    expect(status.batteryPowerW).toBe(2500);
    expect(status.batterySocPercent).toBe(62);
    expect(status.isCharging).toBe(true);

    const calledUrls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(calledUrls.some((url) => String(url).includes(`/cgi-jstatus-L${LIBBI_SERIAL}`))).toBe(true);
  });

  it("setChargeMode calls cgi-libbi-mode endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce2", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargeMode(HUB_SERIAL, LIBBI_SERIAL, 4);

    const calledUrls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(calledUrls.some((url) => String(url).includes(`/cgi-libbi-mode-L${LIBBI_SERIAL}-4`))).toBe(true);
  });

  it("throws MALFORMED_RESPONSE when login response has no director header", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ libbi: [] }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(HUB_SERIAL, API_KEY)).rejects.toThrow(/missing X-MYENERGI-ASBN/);
  });

  it("throws AUTH_FAILURE on digest-authenticated 401", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(HUB_SERIAL, API_KEY)).rejects.toThrow(/status 401/);
  });

  it("throws MALFORMED_RESPONSE when status payload is not shaped correctly", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce2", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ bad: "shape" }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getStatus(HUB_SERIAL, LIBBI_SERIAL)).rejects.toThrow(/missing libbi list/);
  });

  it("throws AUTH_FAILURE when ZAPPI_API_KEY is missing", async () => {
    delete process.env.ZAPPI_API_KEY;
    const client = new LibbiHttpApiClient({ fetchFn: vi.fn() as unknown as typeof fetch });

    await expect(client.getStatus(HUB_SERIAL, LIBBI_SERIAL)).rejects.toThrow(/Missing ZAPPI_API_KEY/);
  });

  it("includes digest Authorization header on authenticated request", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.login(HUB_SERIAL, API_KEY);

    const authenticatedCallInit = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1][1] as RequestInit;
    const authHeader = (authenticatedCallInit.headers as Record<string, string>).Authorization;
    expect(authHeader).toContain("Digest username=");
    expect(authHeader).toContain("response=");
  });

  it("parses lsoc as fallback for battery SoC", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "https://s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce2", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          libbi: [{ sno: LIBBI_SERIAL, lmo: 1, lba: 1800, lsoc: 74, cha: 1 }],
        }),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getStatus(HUB_SERIAL, LIBBI_SERIAL);

    expect(status.batterySocPercent).toBe(74);
  });

  it("resolves director URL that does not start with http to base URL", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "X-MYENERGI-ASBN": "s18.myenergi.net" }),
        json: async () => ({ libbi: [] }),
      });

    const client = new LibbiHttpApiClient({
      baseUrl: "https://s18.myenergi.net",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await client.login(HUB_SERIAL, API_KEY);
    expect(result.directorBaseUrl).toBe("https://s18.myenergi.net");
  });

  it("uses custom baseUrl in constructor", async () => {
    const customBase = "https://custom.myenergi.net";
    const client = new LibbiHttpApiClient({
      baseUrl: customBase,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    expect(client).toBeDefined();
  });

  it("throws TEMPORARY_UNAVAILABLE on 500 response after digest auth", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ "www-authenticate": 'Digest realm="myenergi", nonce="nonce1", qop="auth"' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

    const client = new LibbiHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.login(HUB_SERIAL, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(LibbiTransportError);
    expect(err.code).toBe("TEMPORARY_UNAVAILABLE");
  });
});
