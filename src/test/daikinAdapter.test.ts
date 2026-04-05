import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaikinAdapter } from "../adapters/daikin/DaikinAdapter";
import {
  DaikinHttpApiClient,
  DaikinTransportError,
  type DaikinApiClient,
  type DaikinGatewayDevice,
} from "../adapters/daikin/DaikinApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "daikin-onecta-hp-1";
const OTHER_DEVICE_ID = "other-device-1";
const CLIENT_ID = "daikin-client-id";
const CLIENT_SECRET = "daikin-secret";
const GATEWAY_DEVICE_ID = "daikin-gw-id-abc";
const MANAGEMENT_POINT_ID = "climateControl";
const ACCESS_TOKEN = "daikin-access-token";

const gatewayDevicePayload: DaikinGatewayDevice = {
  id: GATEWAY_DEVICE_ID,
  name: "Daikin Heat Pump",
  operationMode: "heating",
  indoorTemperatureCelsius: 20.5,
  targetTemperatureCelsius: 21,
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

function makeClient(overrides: Partial<DaikinApiClient> = {}): DaikinApiClient {
  return {
    login: vi.fn(async () => ACCESS_TOKEN),
    getGatewayDevices: vi.fn(async () => [gatewayDevicePayload]),
    setOperationMode: vi.fn(async () => ({ success: true, message: "Mode set." })),
    setTemperature: vi.fn(async () => ({ success: true, message: "Temperature set." })),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<DaikinApiClient> = {}): DaikinAdapter {
  return new DaikinAdapter({
    deviceId: DEVICE_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    gatewayDeviceId: GATEWAY_DEVICE_ID,
    managementPointId: MANAGEMENT_POINT_ID,
    client: makeClient(overrides),
  });
}

// ── Contract harness ──────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "DaikinAdapter contract harness",
  createAdapter: () => makeAdapter(),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: gatewayDevicePayload,
  vendorErrorSample: new DaikinTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("DaikinAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Capabilities ────────────────────────────────────────────────────────────

  it("declares expected capabilities", () => {
    expect(makeAdapter().capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reports stable adapter id", () => {
    expect(makeAdapter().adapterId).toBe("daikin-adapter.v1");
  });

  // ── canHandle ───────────────────────────────────────────────────────────────

  it("handles the configured device id", () => {
    expect(makeAdapter().canHandle(DEVICE_ID)).toBe(true);
  });

  it("rejects a foreign device id", () => {
    expect(makeAdapter().canHandle(OTHER_DEVICE_ID)).toBe(false);
  });

  // ── readTelemetry ───────────────────────────────────────────────────────────

  it("calls login and getGatewayDevices before returning telemetry", async () => {
    const client = makeClient();
    const adapter = new DaikinAdapter({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      gatewayDeviceId: GATEWAY_DEVICE_ID,
      managementPointId: MANAGEMENT_POINT_ID,
      client,
    });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledWith(CLIENT_ID, CLIENT_SECRET);
    expect(client.getGatewayDevices).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("maps operationMode=heating to 5000W evChargingPowerW", async () => {
    const telemetry = await makeAdapter().readTelemetry();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].evChargingPowerW).toBe(5000);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
  });

  it("maps operationMode=off to 0W", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...gatewayDevicePayload,
      operationMode: "off",
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  it("maps non-heating operationMode to 0W", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...gatewayDevicePayload,
      operationMode: "cooling",
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  it("throws UNSUPPORTED_DEVICE when gatewayDeviceId not found in account", async () => {
    const client = makeClient({ getGatewayDevices: vi.fn(async () => [gatewayDevicePayload]) });
    const adapter = new DaikinAdapter({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      gatewayDeviceId: "unknown-gateway",
      managementPointId: MANAGEMENT_POINT_ID,
      client,
    });
    await expect(adapter.readTelemetry()).rejects.toThrow(/not found/i);
  });

  // ── dispatchVendorCommand ───────────────────────────────────────────────────

  it("accepts non schedule_window commands as a no-op", async () => {
    const client = makeClient();
    const adapter = makeAdapter();

    const result = await (adapter as DaikinAdapter).dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setOperationMode).not.toHaveBeenCalled();
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

  it("schedules setOperationMode+setTemperature at start and setOperationMode(off) at end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new DaikinAdapter({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      gatewayDeviceId: GATEWAY_DEVICE_ID,
      managementPointId: MANAGEMENT_POINT_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    // Nothing fired yet.
    expect(client.setOperationMode).not.toHaveBeenCalled();
    expect(client.setTemperature).not.toHaveBeenCalled();

    // Advance to window start (30 min).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setOperationMode).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      GATEWAY_DEVICE_ID,
      MANAGEMENT_POINT_ID,
      "heating",
    );
    expect(client.setTemperature).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      GATEWAY_DEVICE_ID,
      MANAGEMENT_POINT_ID,
      21,
    );

    // Advance to window end (2 h later).
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(client.setOperationMode).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      GATEWAY_DEVICE_ID,
      MANAGEMENT_POINT_ID,
      "off",
    );
  });

  it("executes both actions immediately when window is entirely in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new DaikinAdapter({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      gatewayDeviceId: GATEWAY_DEVICE_ID,
      managementPointId: MANAGEMENT_POINT_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setOperationMode).toHaveBeenCalled();
    expect(client.setTemperature).toHaveBeenCalled();
    // Two setOperationMode calls: "heating" at start, "off" at end.
    expect(client.setOperationMode).toHaveBeenCalledTimes(2);
  });

  it("restores mode to off at window end (not heating)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new DaikinAdapter({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      gatewayDeviceId: GATEWAY_DEVICE_ID,
      managementPointId: MANAGEMENT_POINT_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    const calls = (client.setOperationMode as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][3]).toBe("heating");
    expect(calls[1][3]).toBe("off");
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
      new DaikinTransportError("AUTH_FAILURE", "bad creds", 401, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("TEMPORARY_UNAVAILABLE", "503", 503, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("RATE_LIMIT", "slow down", 429, true),
      "telemetry_translation",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
    expect(mapped.operation).toBe("telemetry_translation");
  });

  it("maps UNSUPPORTED_DEVICE to UNSUPPORTED_DEVICE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("UNSUPPORTED_DEVICE", "not found", 404, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNSUPPORTED_DEVICE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps NETWORK_ERROR to UNKNOWN (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("NETWORK_ERROR", "connection refused", 0, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TIMEOUT to TIMEOUT (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("TIMEOUT", "timed out", undefined, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("preserves vendor code in mapped error", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new DaikinTransportError("AUTH_FAILURE", "msg", 401, false),
      "command_dispatch",
    );
    expect(mapped.vendorCode).toBe("AUTH_FAILURE");
  });
});

// ── DaikinHttpApiClient unit tests ────────────────────────────────────────────

describe("DaikinHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("login sends POST with client_credentials grant to OIDC token endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: "daikin-tok", token_type: "Bearer", expires_in: 3600 }),
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const token = await client.login(CLIENT_ID, CLIENT_SECRET);

    expect(token).toBe("daikin-tok");
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("daikineurope.com");
    expect(String(url)).toContain("token");
    expect(String((init as RequestInit)?.body)).toContain("grant_type=client_credentials");
    expect(String((init as RequestInit)?.body)).toContain(CLIENT_ID);
  });

  it("login throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(CLIENT_ID, CLIENT_SECRET)).rejects.toBeInstanceOf(DaikinTransportError);
  });

  it("login throws MALFORMED_RESPONSE when access_token is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token_type: "Bearer" }),
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(CLIENT_ID, CLIENT_SECRET)).rejects.toThrow(/missing access_token/i);
  });

  it("getGatewayDevices returns parsed device list", async () => {
    const rawDevices = [
      {
        id: GATEWAY_DEVICE_ID,
        name: "Daikin HP",
        managementPoints: [
          {
            embeddedId: "climateControl",
            characteristics: [
              { name: "operationMode", value: "heating" },
              { name: "sensoryData", value: { roomTemperature: { value: 20.5 } } },
              {
                name: "temperatureControl",
                value: {
                  operationModes: {
                    heating: { setpoints: { roomTemperature: { value: 21 } } },
                  },
                },
              },
            ],
          },
        ],
      },
    ];

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rawDevices),
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const devices = await client.getGatewayDevices(ACCESS_TOKEN);

    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe(GATEWAY_DEVICE_ID);
    expect(devices[0].operationMode).toBe("heating");
    expect(devices[0].indoorTemperatureCelsius).toBe(20.5);
    expect(devices[0].targetTemperatureCelsius).toBe(21);

    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("gateway-devices");
  });

  it("getGatewayDevices throws MALFORMED_RESPONSE when response is not an array", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ devices: [] }),
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getGatewayDevices(ACCESS_TOKEN)).rejects.toThrow(/not an array/i);
  });

  it("setOperationMode sends PATCH to operationMode endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setOperationMode(ACCESS_TOKEN, GATEWAY_DEVICE_ID, MANAGEMENT_POINT_ID, "heating");

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(GATEWAY_DEVICE_ID);
    expect(String(url)).toContain("operationMode");
    expect((init as RequestInit)?.method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit)?.body)).value).toBe("heating");
  });

  it("setOperationMode throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setOperationMode(ACCESS_TOKEN, GATEWAY_DEVICE_ID, MANAGEMENT_POINT_ID, "heating")).rejects.toBeInstanceOf(DaikinTransportError);
  });

  it("setTemperature sends PATCH to temperatureControl endpoint with correct body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setTemperature(ACCESS_TOKEN, GATEWAY_DEVICE_ID, MANAGEMENT_POINT_ID, 21);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("temperatureControl");
    expect((init as RequestInit)?.method).toBe("PATCH");
    const body = JSON.parse(String((init as RequestInit)?.body));
    expect(body.value).toBe(21);
    expect(body.path).toContain("roomTemperature");
  });

  it("setTemperature throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    });

    const client = new DaikinHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setTemperature(ACCESS_TOKEN, GATEWAY_DEVICE_ID, MANAGEMENT_POINT_ID, 21)).rejects.toBeInstanceOf(DaikinTransportError);
  });

  it("DaikinTransportError carries correct code and retryable flag", () => {
    const err = new DaikinTransportError("RATE_LIMIT", "Too many requests", 429, true);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("DaikinTransportError");
    expect(err instanceof Error).toBe(true);
  });
});
