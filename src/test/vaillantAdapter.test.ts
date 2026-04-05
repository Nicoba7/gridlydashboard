import { beforeEach, describe, expect, it, vi } from "vitest";
import { VaillantAdapter } from "../adapters/vaillant/VaillantAdapter";
import {
  VaillantHttpApiClient,
  VaillantTransportError,
  type VaillantApiClient,
  type VaillantSystemStatus,
} from "../adapters/vaillant/VaillantApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "vaillant-hp-1";
const OTHER_DEVICE_ID = "other-device-1";
const USERNAME = "user@example.com";
const PASSWORD = "s3cr3t";
const HOME_ID = "home-abc-123";
const ACCESS_TOKEN = "vaillant-access-token";

const systemStatusPayload: VaillantSystemStatus = {
  homeId: HOME_ID,
  currentTemperatureCelsius: 20.5,
  targetTemperatureCelsius: 21.0,
  heatingActive: true,
  hotWaterTemperatureCelsius: 55.0,
  raw: {},
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    startAt: "2026-04-02T00:30:00.000Z",
    endAt: "2026-04-02T02:30:00.000Z",
  },
};

function makeClient(overrides: Partial<VaillantApiClient> = {}): VaillantApiClient {
  return {
    login: vi.fn(async () => ACCESS_TOKEN),
    getHomes: vi.fn(async () => [{ homeId: HOME_ID, name: "My Home" }]),
    getSystemStatus: vi.fn(async () => systemStatusPayload),
    setQuickMode: vi.fn(async () => ({ success: true, message: "Quick mode set." })),
    clearQuickMode: vi.fn(async () => ({ success: true, message: "Quick mode cleared." })),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<VaillantApiClient> = {}): VaillantAdapter {
  return new VaillantAdapter({
    deviceId: DEVICE_ID,
    username: USERNAME,
    password: PASSWORD,
    homeId: HOME_ID,
    client: makeClient(overrides),
  });
}

// ── Contract harness ──────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "VaillantAdapter contract harness",
  createAdapter: () => makeAdapter(),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: systemStatusPayload,
  vendorErrorSample: new VaillantTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("VaillantAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Capabilities ────────────────────────────────────────────────────────────

  it("declares expected capabilities", () => {
    expect(makeAdapter().capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reports stable adapter id", () => {
    expect(makeAdapter().adapterId).toBe("vaillant-adapter.v1");
  });

  // ── canHandle ───────────────────────────────────────────────────────────────

  it("handles the configured device id", () => {
    expect(makeAdapter().canHandle(DEVICE_ID)).toBe(true);
  });

  it("rejects a foreign device id", () => {
    expect(makeAdapter().canHandle(OTHER_DEVICE_ID)).toBe(false);
  });

  // ── readTelemetry ───────────────────────────────────────────────────────────

  it("calls login and getSystemStatus before returning telemetry", async () => {
    const client = makeClient();
    const adapter = new VaillantAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      client,
    });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledWith(USERNAME, PASSWORD);
    expect(client.getSystemStatus).toHaveBeenCalledWith(ACCESS_TOKEN, HOME_ID);
  });

  it("maps heatingActive=true to 5000 W", async () => {
    const telemetry = await makeAdapter().readTelemetry();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].evChargingPowerW).toBe(5000);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
    expect(telemetry[0].timestamp).toBeTruthy();
  });

  it("maps heatingActive=false to 0 W", () => {
    const [event] = makeAdapter().mapVendorTelemetryToCanonicalTelemetry({
      ...systemStatusPayload,
      heatingActive: false,
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  // ── dispatchVendorCommand ───────────────────────────────────────────────────

  it("accepts non schedule_window commands as a no-op", async () => {
    const client = makeClient();
    const result = await makeAdapter().dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });
    expect(result.success).toBe(true);
    expect(client.setQuickMode).not.toHaveBeenCalled();
  });

  it("throws for a command targeting an unsupported device", async () => {
    await expect(
      makeAdapter().dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("returns success message containing QUICK_VETO for schedule_window", async () => {
    const result = await makeAdapter().dispatchVendorCommand(scheduleCommand);
    expect(result.success).toBe(true);
    expect(result.message).toContain("QUICK_VETO");
  });

  it("schedules setQuickMode at window start and clearQuickMode at window end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new VaillantAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    // Window start (00:30) and end (02:30) are both in the future — nothing fired yet.
    expect(client.setQuickMode).not.toHaveBeenCalled();
    expect(client.clearQuickMode).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setQuickMode).toHaveBeenCalledWith(ACCESS_TOKEN, HOME_ID, "QUICK_VETO", expect.any(Number));

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(client.clearQuickMode).toHaveBeenCalledWith(ACCESS_TOKEN, HOME_ID);
  });

  it("executes both actions immediately when window is entirely in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new VaillantAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setQuickMode).toHaveBeenCalled();
    expect(client.clearQuickMode).toHaveBeenCalled();
  });

  it("calculates duration correctly from window boundaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new VaillantAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      client,
    });

    // start=00:30, end=02:30 → 120 minutes.
    await adapter.dispatchVendorCommand(scheduleCommand);
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    const [, , , durationArg] = (client.setQuickMode as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(durationArg).toBe(120);
  });

  // ── mapVendorCommandResultToCanonical ───────────────────────────────────────

  it("maps successful vendor result to accepted canonical result", () => {
    const mapped = makeAdapter().mapVendorCommandResultToCanonical(
      scheduleCommand,
      { success: true, message: "ok" },
    );
    expect(mapped.status).toBe("accepted");
    expect(mapped.targetDeviceId).toBe(DEVICE_ID);
    expect(mapped.canonicalCommand).toBe(scheduleCommand);
  });

  it("maps failed vendor result to rejected canonical result", () => {
    const mapped = makeAdapter().mapVendorCommandResultToCanonical(
      scheduleCommand,
      { success: false, message: "API error" },
    );
    expect(mapped.status).toBe("rejected");
    expect(mapped.failureReasonCode).toBe("COMMAND_REJECTED");
  });

  // ── mapVendorErrorToCanonical ───────────────────────────────────────────────

  it("maps AUTH_FAILURE to UNAUTHORIZED (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("AUTH_FAILURE", "bad creds", 401, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("TEMPORARY_UNAVAILABLE", "503", 503, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("RATE_LIMIT", "slow down", 429, true),
      "telemetry_translation",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
    expect(mapped.operation).toBe("telemetry_translation");
  });

  it("maps UNSUPPORTED_DEVICE to UNSUPPORTED_DEVICE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("UNSUPPORTED_DEVICE", "not found", 404, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNSUPPORTED_DEVICE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps NETWORK_ERROR to UNKNOWN (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("NETWORK_ERROR", "connection reset", 0, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TIMEOUT to TIMEOUT (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("TIMEOUT", "timed out", undefined, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("preserves vendor code in mapped error", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new VaillantTransportError("AUTH_FAILURE", "msg", 401, false),
      "command_dispatch",
    );
    expect(mapped.vendorCode).toBe("AUTH_FAILURE");
  });
});

// ── VaillantHttpApiClient unit tests ──────────────────────────────────────────

describe("VaillantHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("login sends POST to token endpoint and returns access token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "tok123", expires_in: 600 }),
    });

    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const token = await client.login(USERNAME, PASSWORD);

    expect(token).toBe("tok123");
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("oauth/token");
    expect(String((init as RequestInit)?.body)).toContain("grant_type=password");
  });

  it("login throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false, status: 401, text: async () => "Unauthorized",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/AUTH_FAILURE|status 401/i);
  });

  it("login throws MALFORMED_RESPONSE when access_token is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ expires_in: 600 }),
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/missing access_token/i);
  });

  it("login throws MALFORMED_RESPONSE on non-JSON response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => "not json",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/not valid JSON/i);
  });

  it("getHomes calls /homes and returns mapped array", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ homeId: HOME_ID, name: "My Home" }]),
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const homes = await client.getHomes(ACCESS_TOKEN);

    expect(homes).toHaveLength(1);
    expect(homes[0].homeId).toBe(HOME_ID);
    expect(String(fetchFn.mock.calls[0][0])).toContain("/homes");
  });

  it("getHomes throws MALFORMED_RESPONSE when response is not an array", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ homes: [] }),
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getHomes(ACCESS_TOKEN)).rejects.toThrow(/not an array/i);
  });

  it("getSystemStatus extracts temperatures and heating state", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        state: {
          currentRoomTemperature: 20.5,
          desiredRoomTemperature: 21.0,
          systemOperationMode: "HEATING",
          currentDomesticHotWaterTemperature: 55.0,
        },
      }),
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getSystemStatus(ACCESS_TOKEN, HOME_ID);

    expect(status.currentTemperatureCelsius).toBe(20.5);
    expect(status.targetTemperatureCelsius).toBe(21.0);
    expect(status.heatingActive).toBe(true);
    expect(status.hotWaterTemperatureCelsius).toBe(55.0);
    expect(String(fetchFn.mock.calls[0][0])).toContain(`/homes/${HOME_ID}/system`);
  });

  it("getSystemStatus defaults temperatures to 0 when fields are absent", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({}),
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getSystemStatus(ACCESS_TOKEN, HOME_ID);
    expect(status.currentTemperatureCelsius).toBe(0);
    expect(status.heatingActive).toBe(false);
  });

  it("setQuickMode sends POST to /quick-mode with mode and duration", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, text: async () => "{}",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setQuickMode(ACCESS_TOKEN, HOME_ID, "QUICK_VETO", 90);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/quick-mode`);
    expect((init as RequestInit)?.method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit)?.body));
    expect(body.quickMode).toBe("QUICK_VETO");
    expect(body.duration).toBe(90);
  });

  it("setQuickMode throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false, status: 422, text: async () => "Unprocessable",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setQuickMode(ACCESS_TOKEN, HOME_ID, "QUICK_VETO", 60)).rejects.toBeInstanceOf(VaillantTransportError);
  });

  it("clearQuickMode sends DELETE to /quick-mode and returns success", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true, status: 204, text: async () => "",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.clearQuickMode(ACCESS_TOKEN, HOME_ID);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/quick-mode`);
    expect((init as RequestInit)?.method).toBe("DELETE");
  });

  it("clearQuickMode throws on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false, status: 401, text: async () => "Unauthorized",
    });
    const client = new VaillantHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.clearQuickMode(ACCESS_TOKEN, HOME_ID)).rejects.toBeInstanceOf(VaillantTransportError);
  });

  it("VaillantTransportError carries correct code and retryable flag", () => {
    const err = new VaillantTransportError("RATE_LIMIT", "Too many requests", 429, true);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("VaillantTransportError");
    expect(err instanceof Error).toBe(true);
  });
});
