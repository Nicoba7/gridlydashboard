import { beforeEach, describe, expect, it, vi } from "vitest";
import { MELCloudAdapter } from "../adapters/melcloud/MELCloudAdapter";
import {
  MELCloudHttpApiClient,
  MELCloudTransportError,
  type MELCloudApiClient,
  type MELCloudDevice,
} from "../adapters/melcloud/MELCloudApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "melcloud-hp-zxq";
const OTHER_DEVICE_ID = "other-device-1";
const EMAIL = "user@example.com";
const PASSWORD = "s3cr3t";
const MEL_DEVICE_ID = 67890;
const CONTEXT_KEY = "test-context-key";

const devicePayload: MELCloudDevice = {
  deviceId: MEL_DEVICE_ID,
  deviceName: "Ecodan",
  currentTemperatureCelsius: 20.5,
  targetTemperatureCelsius: 21,
  tankTemperatureCelsius: 48,
  targetTankTemperatureCelsius: 55,
  heatingPowerW: 1500,
  power: true,
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

function makeClient(overrides: Partial<MELCloudApiClient> = {}): MELCloudApiClient {
  return {
    login: vi.fn(async () => CONTEXT_KEY),
    getDevices: vi.fn(async () => [devicePayload]),
    setAtw: vi.fn(async () => ({ success: true, message: "Settings applied." })),
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<MELCloudApiClient> = {}): MELCloudAdapter {
  return new MELCloudAdapter({
    deviceId: DEVICE_ID,
    email: EMAIL,
    password: PASSWORD,
    melcloudDeviceId: MEL_DEVICE_ID,
    client: makeClient(overrides),
  });
}

// ── Contract harness ──────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "MELCloudAdapter contract harness",
  createAdapter: () => makeAdapter(),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: devicePayload,
  vendorErrorSample: new MELCloudTransportError("AUTH_FAILURE", "Context key expired.", 401, false),
});

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("MELCloudAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // ── Capabilities ────────────────────────────────────────────────────────────

  it("declares expected capabilities including read_soc", () => {
    expect(makeAdapter().capabilities).toEqual(["read_soc", "read_power", "schedule_window"]);
  });

  it("reports stable adapter id", () => {
    expect(makeAdapter().adapterId).toBe("melcloud-adapter.v1");
  });

  // ── canHandle ───────────────────────────────────────────────────────────────

  it("handles the configured device id", () => {
    expect(makeAdapter().canHandle(DEVICE_ID)).toBe(true);
  });

  it("rejects a foreign device id", () => {
    expect(makeAdapter().canHandle(OTHER_DEVICE_ID)).toBe(false);
  });

  // ── readTelemetry ───────────────────────────────────────────────────────────

  it("calls login and getDevices before returning telemetry", async () => {
    const client = makeClient();
    const adapter = new MELCloudAdapter({
      deviceId: DEVICE_ID,
      email: EMAIL,
      password: PASSWORD,
      melcloudDeviceId: MEL_DEVICE_ID,
      client,
    });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(client.getDevices).toHaveBeenCalledWith(CONTEXT_KEY);
  });

  it("maps tankTemperatureCelsius / targetTankTemperatureCelsius to batterySocPercent", async () => {
    // 48 / 55 * 100 = 87.27... → rounds to 87
    const telemetry = await makeAdapter().readTelemetry();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].batterySocPercent).toBe(87);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
  });

  it("maps heatingPowerW directly to evChargingPowerW", async () => {
    const telemetry = await makeAdapter().readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(1500);
  });

  it("caps batterySocPercent at 100 when tank exceeds target", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...devicePayload,
      tankTemperatureCelsius: 60,
      targetTankTemperatureCelsius: 55,
    });
    expect(event.batterySocPercent).toBe(100);
  });

  it("returns 0 batterySocPercent when targetTankTemperatureCelsius is zero", () => {
    const adapter = makeAdapter();
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...devicePayload,
      targetTankTemperatureCelsius: 0,
    });
    expect(event.batterySocPercent).toBe(0);
  });

  it("throws UNSUPPORTED_DEVICE when device is not found in account", async () => {
    const client = makeClient({ getDevices: vi.fn(async () => [devicePayload]) });
    const adapter = new MELCloudAdapter({
      deviceId: DEVICE_ID,
      email: EMAIL,
      password: PASSWORD,
      melcloudDeviceId: 99999, // not in the mock list
      client,
    });
    await expect(adapter.readTelemetry()).rejects.toThrow(/not found/i);
  });

  // ── dispatchVendorCommand ───────────────────────────────────────────────────

  it("accepts non schedule_window commands as a no-op", async () => {
    const client = makeClient();
    const adapter = makeAdapter();

    const result = await (adapter as MELCloudAdapter).dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setAtw).not.toHaveBeenCalled();
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

  it("schedules setAtw (pre-heat) at window start and temperature restore at window end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient({
      // Device has targetTemperatureCelsius: 19 so we can verify restore.
      getDevices: vi.fn(async () => [{ ...devicePayload, targetTemperatureCelsius: 19 }]),
    });
    const adapter = new MELCloudAdapter({
      deviceId: DEVICE_ID,
      email: EMAIL,
      password: PASSWORD,
      melcloudDeviceId: MEL_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    // Nothing fired yet.
    expect(client.setAtw).not.toHaveBeenCalled();

    // Advance to window start (30 min).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setAtw).toHaveBeenCalledWith(
      CONTEXT_KEY,
      expect.objectContaining({ SetTemperatureZone1: 21, DeviceID: MEL_DEVICE_ID }),
    );

    // Advance to window end (2 h later).
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 1);
    expect(client.setAtw).toHaveBeenCalledWith(
      CONTEXT_KEY,
      expect.objectContaining({ SetTemperatureZone1: 19, DeviceID: MEL_DEVICE_ID }),
    );
  });

  it("executes both actions immediately when window is entirely in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient();
    const adapter = new MELCloudAdapter({
      deviceId: DEVICE_ID,
      email: EMAIL,
      password: PASSWORD,
      melcloudDeviceId: MEL_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setAtw).toHaveBeenCalledTimes(2);
  });

  it("restores previous target temperature at window end (not hard-coded value)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T06:00:00.000Z"));

    const client = makeClient({
      getDevices: vi.fn(async () => [{ ...devicePayload, targetTemperatureCelsius: 18.5 }]),
    });
    const adapter = new MELCloudAdapter({
      deviceId: DEVICE_ID,
      email: EMAIL,
      password: PASSWORD,
      melcloudDeviceId: MEL_DEVICE_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    const calls = (client.setAtw as ReturnType<typeof vi.fn>).mock.calls;
    const [, startSettings] = calls[0];
    const [, endSettings] = calls[1];
    expect(startSettings.SetTemperatureZone1).toBe(21);
    expect(endSettings.SetTemperatureZone1).toBe(18.5);
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
      new MELCloudTransportError("AUTH_FAILURE", "context key invalid", 401, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("TEMPORARY_UNAVAILABLE", "503", 503, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("RATE_LIMIT", "slow down", 429, true),
      "telemetry_translation",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });

  it("maps UNSUPPORTED_DEVICE to UNSUPPORTED_DEVICE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("UNSUPPORTED_DEVICE", "not found", 404, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNSUPPORTED_DEVICE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("MALFORMED_RESPONSE", "bad json", undefined, false),
      "command_dispatch",
    );
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  it("maps NETWORK_ERROR to UNKNOWN (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("NETWORK_ERROR", "connection refused", 0, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNKNOWN");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TIMEOUT to TIMEOUT (retryable)", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("TIMEOUT", "timed out", undefined, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("TIMEOUT");
    expect(mapped.retryable).toBe(true);
  });

  it("preserves vendor code in mapped error", () => {
    const mapped = makeAdapter().mapVendorErrorToCanonical(
      new MELCloudTransportError("AUTH_FAILURE", "msg", 401, false),
      "command_dispatch",
    );
    expect(mapped.vendorCode).toBe("AUTH_FAILURE");
  });
});

// ── MELCloudHttpApiClient unit tests ──────────────────────────────────────────

describe("MELCloudHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("login sends POST to ClientLogin and returns ContextKey", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ LoginData: { ContextKey: "ctx-abc", Name: "John" }, ErrorId: null }),
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const key = await client.login(EMAIL, PASSWORD);

    expect(key).toBe("ctx-abc");
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("melcloud.com");
    expect(String(url)).toContain("ClientLogin");
  });

  it("login throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toBeInstanceOf(MELCloudTransportError);
  });

  it("login throws MALFORMED_RESPONSE when ContextKey is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ LoginData: {} }),
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toThrow(/ContextKey/i);
  });

  it("getDevices sends GET with X-MitsContextKey header", async () => {
    const rawDevice = {
      DeviceID: MEL_DEVICE_ID,
      DeviceName: "Ecodan",
      Device: {
        RoomTemperatureZone1: 20.5,
        SetTemperatureZone1: 21,
        TankWaterTemperature: 48,
        SetTankWaterTemperature: 55,
        HeatingEnergyConsumedRate1: 1500,
        Power: true,
      },
    };

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([rawDevice]),
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const devices = await client.getDevices(CONTEXT_KEY);

    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe(MEL_DEVICE_ID);
    expect(devices[0].tankTemperatureCelsius).toBe(48);
    expect(devices[0].heatingPowerW).toBe(1500);

    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("ListDevices");
    expect((init as RequestInit)?.headers as Record<string, string>).toBeTruthy();
  });

  it("getDevices parses nested building→area→device structure", async () => {
    const rawBuilding = {
      Structure: {
        Areas: [
          {
            Devices: [
              {
                DeviceID: MEL_DEVICE_ID,
                DeviceName: "Ecodan",
                Device: {
                  RoomTemperatureZone1: 20.5,
                  SetTemperatureZone1: 21,
                  TankWaterTemperature: 48,
                  SetTankWaterTemperature: 55,
                  HeatingEnergyConsumedRate1: 1500,
                  Power: true,
                },
              },
            ],
          },
        ],
      },
    };

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([rawBuilding]),
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const devices = await client.getDevices(CONTEXT_KEY);

    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe(MEL_DEVICE_ID);
  });

  it("setAtw sends POST to SetAtw with X-MitsContextKey header", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ SetTemperatureZone1: 21, DeviceID: MEL_DEVICE_ID }),
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.setAtw(CONTEXT_KEY, {
      DeviceID: MEL_DEVICE_ID,
      EffectiveFlags: 0x80,
      SetTemperatureZone1: 21,
    });

    expect(result.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("SetAtw");
    expect((init as RequestInit)?.method).toBe("POST");
  });

  it("setAtw throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    const client = new MELCloudHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.setAtw(CONTEXT_KEY, { DeviceID: MEL_DEVICE_ID, EffectiveFlags: 0x80 })).rejects.toBeInstanceOf(MELCloudTransportError);
  });

  it("MELCloudTransportError carries correct code and retryable flag", () => {
    const err = new MELCloudTransportError("RATE_LIMIT", "Too many requests", 429, true);
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("MELCloudTransportError");
    expect(err instanceof Error).toBe(true);
  });
});
