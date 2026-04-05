import { beforeEach, describe, expect, it, vi } from "vitest";
import { TadoAdapter } from "../adapters/tado/TadoAdapter";
import {
  TadoHttpApiClient,
  TadoTransportError,
  type TadoApiClient,
  type TadoZoneState,
} from "../adapters/tado/TadoApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "tado-zone-1";
const OTHER_DEVICE_ID = "other-device-1";
const USERNAME = "test@example.com";
const PASSWORD = "s3cr3t";
const HOME_ID = 12345;
const ZONE_ID = 1;
const ACCESS_TOKEN = "test-access-token";

const zoneStatePayload: TadoZoneState = {
  zoneId: ZONE_ID,
  currentTemperatureCelsius: 19.5,
  targetTemperatureCelsius: 21,
  heatingPowerPercent: 60,
  raw: {},
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    start: "2026-04-02T00:30:00.000Z",
    end: "2026-04-02T02:30:00.000Z",
  },
};

function makeClient(overrides: Partial<TadoApiClient> = {}): TadoApiClient {
  return {
    login: vi.fn(async () => ACCESS_TOKEN),
    getHome: vi.fn(async () => HOME_ID),
    getZones: vi.fn(async () => [{ id: ZONE_ID, name: "Living Room", type: "HEATING" }]),
    getZoneState: vi.fn(async () => zoneStatePayload),
    setTemperature: vi.fn(async () => ({ success: true, message: "Temperature set." })),
    deleteOverlay: vi.fn(async () => ({ success: true, message: "Zone returned to auto mode." })),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<TadoApiClient> = {}): TadoAdapter {
  return new TadoAdapter({
    deviceId: DEVICE_ID,
    username: USERNAME,
    password: PASSWORD,
    homeId: HOME_ID,
    zoneId: ZONE_ID,
    client: makeClient(overrides),
  });
}

// ── Contract harness ──────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "TadoAdapter contract harness",
  createAdapter: () => makeAdapter(),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: zoneStatePayload,
  vendorErrorSample: new TadoTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("TadoAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Capabilities ────────────────────────────────────────────────────────────

  it("declares expected capabilities", () => {
    const adapter = makeAdapter();
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reports stable adapter id", () => {
    expect(makeAdapter().adapterId).toBe("tado-adapter.v1");
  });

  // ── canHandle ───────────────────────────────────────────────────────────────

  it("handles the configured device id", () => {
    expect(makeAdapter().canHandle(DEVICE_ID)).toBe(true);
  });

  it("rejects a foreign device id", () => {
    expect(makeAdapter().canHandle(OTHER_DEVICE_ID)).toBe(false);
  });

  // ── readTelemetry ───────────────────────────────────────────────────────────

  it("calls login and getZoneState before returning telemetry", async () => {
    const client = makeClient();
    const adapter = new TadoAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      zoneId: ZONE_ID,
      client,
    });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledWith(USERNAME, PASSWORD);
    expect(client.getZoneState).toHaveBeenCalledWith(ACCESS_TOKEN, HOME_ID, ZONE_ID);
  });

  it("maps heatingPowerPercent to heatingPowerW in canonical telemetry", async () => {
    const telemetry = await makeAdapter().readTelemetry();

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    // 60% of 15 000 W = 9 000 W
    expect(telemetry[0].evChargingPowerW).toBe(9000);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
    expect(telemetry[0].timestamp).toBeTruthy();
  });

  it("maps zero heatingPowerPercent to zero watts", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...zoneStatePayload,
      heatingPowerPercent: 0,
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  it("maps 100% heatingPowerPercent to 15000 W", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...zoneStatePayload,
      heatingPowerPercent: 100,
    });
    expect(event.evChargingPowerW).toBe(15000);
  });

  // ── dispatchVendorCommand ───────────────────────────────────────────────────

  it("accepts non schedule_window commands as a no-op", async () => {
    const client = makeClient();
    const adapter = makeAdapter();

    const result = await (adapter as TadoAdapter).dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setTemperature).not.toHaveBeenCalled();
  });

  it("throws for a command targeting an unsupported device", async () => {
    await expect(
      makeAdapter().dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("returns success for a valid schedule_window command", async () => {
    const result = await makeAdapter().dispatchVendorCommand(scheduleCommand);
    expect(result.success).toBe(true);
    expect(result.message).toContain("21°C");
  });

  it("schedules setTemperature at window start and deleteOverlay at window end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new TadoAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      zoneId: ZONE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    // Nothing fired yet — both window boundaries are in the future.
    expect(client.setTemperature).not.toHaveBeenCalled();
    expect(client.deleteOverlay).not.toHaveBeenCalled();

    // Advance to window start (30 min).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setTemperature).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      HOME_ID,
      ZONE_ID,
      21,
      expect.any(Number),
    );

    // Advance to window end (2 h later).
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(client.deleteOverlay).toHaveBeenCalledWith(ACCESS_TOKEN, HOME_ID, ZONE_ID);
  });

  it("executes both actions immediately when window is entirely in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new TadoAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      zoneId: ZONE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setTemperature).toHaveBeenCalled();
    expect(client.deleteOverlay).toHaveBeenCalled();
  });

  it("calculates duration correctly from window boundaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new TadoAdapter({
      deviceId: DEVICE_ID,
      username: USERNAME,
      password: PASSWORD,
      homeId: HOME_ID,
      zoneId: ZONE_ID,
      client,
    });

    // start=00:30, end=02:30 → 120 minutes.
    await adapter.dispatchVendorCommand(scheduleCommand);
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    const [, , , , durationArg] = (client.setTemperature as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(durationArg).toBe(120);
  });

  // ── mapVendorCommandResultToCanonical ───────────────────────────────────────

  it("maps successful vendor result to accepted canonical result", () => {
    const adapter = makeAdapter();
    const mapped = adapter.mapVendorCommandResultToCanonical(
      scheduleCommand,
      { success: true, message: "done" },
    );
    expect(mapped.status).toBe("accepted");
    expect(mapped.targetDeviceId).toBe(DEVICE_ID);
    expect(mapped.canonicalCommand).toBe(scheduleCommand);
  });

  it("maps failed vendor result to rejected canonical result", () => {
    const adapter = makeAdapter();
    const mapped = adapter.mapVendorCommandResultToCanonical(
      scheduleCommand,
      { success: false, message: "API error" },
    );
    expect(mapped.status).toBe("rejected");
    expect(mapped.failureReasonCode).toBe("COMMAND_REJECTED");
  });

  // ── mapVendorErrorToCanonical ───────────────────────────────────────────────

  it("maps AUTH_FAILURE to UNAUTHORIZED (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("AUTH_FAILURE", "bad creds", 401, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("TEMPORARY_UNAVAILABLE", "503", 503, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("RATE_LIMIT", "slow down", 429, true),
      "telemetry_translation",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
    expect(mapped.operation).toBe("telemetry_translation");
  });

  it("maps UNSUPPORTED_DEVICE to UNSUPPORTED_DEVICE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("UNSUPPORTED_DEVICE", "not found", 404, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNSUPPORTED_DEVICE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps NETWORK_ERROR to UNKNOWN (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("NETWORK_ERROR", "connection refused", 0, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TIMEOUT to TIMEOUT (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("TIMEOUT", "timed out", undefined, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("preserves vendor code in mapped error", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new TadoTransportError("AUTH_FAILURE", "msg", 401, false),
      "command_dispatch",
    );
    expect(mapped.vendorCode).toBe("AUTH_FAILURE");
  });
});

// ── TadoHttpApiClient unit tests ──────────────────────────────────────────────

describe("TadoHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("login sends POST to auth endpoint and returns access token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "tok123", expires_in: 600, token_type: "Bearer" }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const token = await client.login(USERNAME, PASSWORD);

    expect(token).toBe("tok123");
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("auth.tado.com/oauth/token");
    expect(String((init as RequestInit)?.body)).toContain("grant_type=password");
  });

  it("login throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/AUTH_FAILURE|auth fail|status 401/i);
  });

  it("login throws MALFORMED_RESPONSE when token is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ expires_in: 600 }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/missing access_token/i);
  });

  it("login throws MALFORMED_RESPONSE on non-JSON response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "not json",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USERNAME, PASSWORD)).rejects.toThrow(/not valid JSON/i);
  });

  it("getHome calls /api/v2/me and extracts homeId", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ homes: [{ id: HOME_ID, name: "My Home" }] }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const homeId = await client.getHome(ACCESS_TOKEN);

    expect(homeId).toBe(HOME_ID);
    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("/api/v2/me");
  });

  it("getHome throws MALFORMED_RESPONSE when homes array is empty", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ homes: [] }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getHome(ACCESS_TOKEN)).rejects.toThrow(/no homes/i);
  });

  it("getZones returns mapped zone list", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          { id: 1, name: "Living Room", type: "HEATING" },
          { id: 2, name: "Bedroom", type: "HEATING" },
        ]),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const zones = await client.getZones(ACCESS_TOKEN, HOME_ID);

    expect(zones).toHaveLength(2);
    expect(zones[0]).toEqual({ id: 1, name: "Living Room", type: "HEATING" });
    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/zones`);
  });

  it("getZones throws MALFORMED_RESPONSE when response is not an array", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ zones: [] }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getZones(ACCESS_TOKEN, HOME_ID)).rejects.toThrow(/not an array/i);
  });

  it("getZoneState extracts temperatures and heating power", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          sensorDataPoints: { insideTemperature: { celsius: 19.5 } },
          setting: { type: "HEATING", power: "ON", temperature: { celsius: 21 } },
          activityDataPoints: { heatingPower: { percentage: 60 } },
        }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const state = await client.getZoneState(ACCESS_TOKEN, HOME_ID, ZONE_ID);

    expect(state.zoneId).toBe(ZONE_ID);
    expect(state.currentTemperatureCelsius).toBe(19.5);
    expect(state.targetTemperatureCelsius).toBe(21);
    expect(state.heatingPowerPercent).toBe(60);
    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/zones/${ZONE_ID}/state`);
  });

  it("getZoneState tolerates missing activityDataPoints (heatingPower defaults to 0)", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          sensorDataPoints: { insideTemperature: { celsius: 20 } },
          setting: { type: "HEATING", power: "OFF" },
        }),
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const state = await client.getZoneState(ACCESS_TOKEN, HOME_ID, ZONE_ID);

    expect(state.heatingPowerPercent).toBe(0);
    expect(state.targetTemperatureCelsius).toBeNull();
  });

  it("setTemperature sends PUT to /overlay endpoint with correct body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setTemperature(ACCESS_TOKEN, HOME_ID, ZONE_ID, 21, 120);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/zones/${ZONE_ID}/overlay`);
    expect((init as RequestInit)?.method).toBe("PUT");
    const body = JSON.parse(String((init as RequestInit)?.body));
    expect(body.setting.temperature.celsius).toBe(21);
    expect(body.termination.durationInSeconds).toBe(7200);
  });

  it("setTemperature throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "Unprocessable",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setTemperature(ACCESS_TOKEN, HOME_ID, ZONE_ID, 21, 60)).rejects.toBeInstanceOf(TadoTransportError);
  });

  it("deleteOverlay sends DELETE to /overlay and returns success", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: async () => "",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.deleteOverlay(ACCESS_TOKEN, HOME_ID, ZONE_ID);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/homes/${HOME_ID}/zones/${ZONE_ID}/overlay`);
    expect((init as RequestInit)?.method).toBe("DELETE");
  });

  it("deleteOverlay throws on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new TadoHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.deleteOverlay(ACCESS_TOKEN, HOME_ID, ZONE_ID)).rejects.toBeInstanceOf(TadoTransportError);
  });

  it("TadoTransportError carries correct code and retryable flag", () => {
    const err = new TadoTransportError("RATE_LIMIT", "Too many requests", 429, true);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("TadoTransportError");
    expect(err instanceof Error).toBe(true);
  });
});
