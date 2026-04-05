import { beforeEach, describe, expect, it, vi } from "vitest";
import { SamsungAdapter } from "../adapters/samsung/SamsungAdapter";
import {
  SamsungHttpApiClient,
  SamsungTransportError,
  type SamsungApiClient,
  type SamsungDeviceStatus,
} from "../adapters/samsung/SamsungApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "samsung-ehs-hp-1";
const OTHER_DEVICE_ID = "other-device-1";
const PAT = "smartthings-personal-access-token";
const SMARTTHINGS_DEVICE_ID = "st-device-uuid-abc";

const deviceStatusPayload: SamsungDeviceStatus = {
  heatingSetpointCelsius: 20,
  currentTemperatureCelsius: 19.5,
  thermostatMode: "heat",
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

function makeClient(overrides: Partial<SamsungApiClient> = {}): SamsungApiClient {
  return {
    getDevices: vi.fn(async () => [{ deviceId: SMARTTHINGS_DEVICE_ID, name: "Samsung EHS", label: "Samsung EHS Heat Pump" }]),
    getDeviceStatus: vi.fn(async () => deviceStatusPayload),
    setHeatingSetpoint: vi.fn(async () => ({ success: true, message: "Setpoint updated." })),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<SamsungApiClient> = {}): SamsungAdapter {
  return new SamsungAdapter({
    deviceId: DEVICE_ID,
    smartthingsToken: PAT,
    smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
    client: makeClient(overrides),
  });
}

// ── Contract harness ──────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "SamsungAdapter contract harness",
  createAdapter: () => makeAdapter(),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: deviceStatusPayload,
  vendorErrorSample: new SamsungTransportError("AUTH_FAILURE", "Invalid PAT.", 401, false),
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("SamsungAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Capabilities ────────────────────────────────────────────────────────────

  it("declares expected capabilities", () => {
    expect(makeAdapter().capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reports stable adapter id", () => {
    expect(makeAdapter().adapterId).toBe("samsung-smartthings-adapter.v1");
  });

  // ── canHandle ───────────────────────────────────────────────────────────────

  it("handles the configured device id", () => {
    expect(makeAdapter().canHandle(DEVICE_ID)).toBe(true);
  });

  it("rejects a foreign device id", () => {
    expect(makeAdapter().canHandle(OTHER_DEVICE_ID)).toBe(false);
  });

  // ── readTelemetry ───────────────────────────────────────────────────────────

  it("calls getDeviceStatus with the PAT and smartthingsDeviceId", async () => {
    const client = makeClient();
    const adapter = new SamsungAdapter({
      deviceId: DEVICE_ID,
      smartthingsToken: PAT,
      smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
      client,
    });

    await adapter.readTelemetry();

    // No login needed for SmartThings — PAT used directly.
    expect(client.getDeviceStatus).toHaveBeenCalledWith(PAT, SMARTTHINGS_DEVICE_ID);
  });

  it("maps thermostatMode=heat to 5000W evChargingPowerW", async () => {
    const telemetry = await makeAdapter().readTelemetry();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].evChargingPowerW).toBe(5000);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
  });

  it("maps thermostatMode=off to 0W", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...deviceStatusPayload,
      thermostatMode: "off",
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  it("maps thermostatMode=cool to 0W", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...deviceStatusPayload,
      thermostatMode: "cool",
    });
    expect(event.evChargingPowerW).toBe(0);
  });

  // ── dispatchVendorCommand ───────────────────────────────────────────────────

  it("accepts non schedule_window commands as a no-op", async () => {
    const client = makeClient();
    const adapter = makeAdapter();

    const result = await (adapter as SamsungAdapter).dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setHeatingSetpoint).not.toHaveBeenCalled();
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

  it("reads current setpoint at dispatch time to capture prevSetpoint for restore", async () => {
    const client = makeClient({
      getDeviceStatus: vi.fn(async () => ({ ...deviceStatusPayload, heatingSetpointCelsius: 18 })),
    });
    const adapter = new SamsungAdapter({
      deviceId: DEVICE_ID,
      smartthingsToken: PAT,
      smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
      client,
    });

    const result = await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.getDeviceStatus).toHaveBeenCalledWith(PAT, SMARTTHINGS_DEVICE_ID);
    expect(result.message).toContain("18°C");
  });

  it("schedules setHeatingSetpoint(21) at start and setHeatingSetpoint(prevSetpoint) at end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient({
      getDeviceStatus: vi.fn(async () => ({ ...deviceStatusPayload, heatingSetpointCelsius: 19 })),
    });
    const adapter = new SamsungAdapter({
      deviceId: DEVICE_ID,
      smartthingsToken: PAT,
      smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    // Nothing fired yet.
    expect(client.setHeatingSetpoint).not.toHaveBeenCalled();

    // Advance to window start (30 min).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setHeatingSetpoint).toHaveBeenCalledWith(PAT, SMARTTHINGS_DEVICE_ID, 21);

    // Advance to window end (2 h later).
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(client.setHeatingSetpoint).toHaveBeenCalledWith(PAT, SMARTTHINGS_DEVICE_ID, 19);
  });

  it("executes both actions immediately when window is entirely in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new SamsungAdapter({
      deviceId: DEVICE_ID,
      smartthingsToken: PAT,
      smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setHeatingSetpoint).toHaveBeenCalledTimes(2);
  });

  it("restores the previous setpoint (not a hard-coded fallback) at window end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient({
      getDeviceStatus: vi.fn(async () => ({ ...deviceStatusPayload, heatingSetpointCelsius: 17.5 })),
    });
    const adapter = new SamsungAdapter({
      deviceId: DEVICE_ID,
      smartthingsToken: PAT,
      smartthingsDeviceId: SMARTTHINGS_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    const calls = (client.setHeatingSetpoint as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][2]).toBe(21);
    expect(calls[1][2]).toBe(17.5);
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
      new SamsungTransportError("AUTH_FAILURE", "invalid PAT", 401, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("TEMPORARY_UNAVAILABLE", "503", 503, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("RATE_LIMIT", "slow down", 429, true),
      "telemetry_translation",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
    expect(mapped.operation).toBe("telemetry_translation");
  });

  it("maps UNSUPPORTED_DEVICE to UNSUPPORTED_DEVICE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("UNSUPPORTED_DEVICE", "not found", 404, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNSUPPORTED_DEVICE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps NETWORK_ERROR to UNKNOWN (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("NETWORK_ERROR", "connection refused", 0, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TIMEOUT to TIMEOUT (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("TIMEOUT", "timed out", undefined, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("preserves vendor code in mapped error", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new SamsungTransportError("AUTH_FAILURE", "msg", 401, false),
      "command_dispatch",
    );
    expect(mapped.vendorCode).toBe("AUTH_FAILURE");
  });
});

// ── SamsungHttpApiClient unit tests ───────────────────────────────────────────

describe("SamsungHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getDevices sends GET with Bearer PAT and capability filter", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          items: [
            { deviceId: SMARTTHINGS_DEVICE_ID, name: "Samsung EHS", label: "Samsung EHS Heat Pump" },
          ],
        }),
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const devices = await client.getDevices(PAT);

    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe(SMARTTHINGS_DEVICE_ID);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("smartthings.com");
    expect(String(url)).toContain("thermostatHeatingSetpoint");
    const authHeader = ((init as RequestInit)?.headers as Record<string, string>)?.Authorization ?? "";
    expect(authHeader).toContain(PAT);
  });

  it("getDevices throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getDevices(PAT)).rejects.toBeInstanceOf(SamsungTransportError);
  });

  it("getDevices throws MALFORMED_RESPONSE when items array is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ count: 0 }),
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getDevices(PAT)).rejects.toThrow(/items array/i);
  });

  it("getDeviceStatus extracts heatingSetpoint, temperature and mode", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          components: {
            main: {
              thermostatHeatingSetpoint: { heatingSetpoint: { value: 20, unit: "C" } },
              temperatureMeasurement: { temperature: { value: 19.5, unit: "C" } },
              thermostatMode: { thermostatMode: { value: "heat" } },
            },
          },
        }),
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getDeviceStatus(PAT, SMARTTHINGS_DEVICE_ID);

    expect(status.heatingSetpointCelsius).toBe(20);
    expect(status.currentTemperatureCelsius).toBe(19.5);
    expect(status.thermostatMode).toBe("heat");

    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(SMARTTHINGS_DEVICE_ID);
    expect(String(url)).toContain("status");
  });

  it("getDeviceStatus defaults missing fields to 0 / off", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ components: { main: {} } }),
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const status = await client.getDeviceStatus(PAT, SMARTTHINGS_DEVICE_ID);

    expect(status.heatingSetpointCelsius).toBe(0);
    expect(status.currentTemperatureCelsius).toBe(0);
    expect(status.thermostatMode).toBe("off");
  });

  it("setHeatingSetpoint sends POST with correct command body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ status: "ACCEPTED" }] }),
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setHeatingSetpoint(PAT, SMARTTHINGS_DEVICE_ID, 21);

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(SMARTTHINGS_DEVICE_ID);
    expect(String(url)).toContain("commands");
    expect((init as RequestInit)?.method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit)?.body));
    expect(body.commands[0].capability).toBe("thermostatHeatingSetpoint");
    expect(body.commands[0].command).toBe("setHeatingSetpoint");
    expect(body.commands[0].arguments[0]).toBe(21);
  });

  it("setHeatingSetpoint throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setHeatingSetpoint(PAT, SMARTTHINGS_DEVICE_ID, 21)).rejects.toBeInstanceOf(SamsungTransportError);
  });

  it("setHeatingSetpoint throws TEMPORARY_UNAVAILABLE on 503", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const client = new SamsungHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.setHeatingSetpoint(PAT, SMARTTHINGS_DEVICE_ID, 21).catch((e) => e) as SamsungTransportError;
    expect(err.code).toBe("TEMPORARY_UNAVAILABLE");
    expect(err.retryable).toBe(true);
  });

  it("SamsungTransportError carries correct code and retryable flag", () => {
    const err = new SamsungTransportError("RATE_LIMIT", "Too many requests", 429, true);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("SamsungTransportError");
    expect(err instanceof Error).toBe(true);
  });
});
