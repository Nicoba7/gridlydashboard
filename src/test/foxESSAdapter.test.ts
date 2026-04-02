import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoxESSAdapter } from "../adapters/foxess/FoxESSAdapter";
import {
  FoxESSHttpApiClient,
  FoxESSTransportError,
  type FoxESSApiClient,
  type FoxESSRealTimeData,
} from "../adapters/foxess/FoxESSApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "foxess-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const API_KEY = "foxess-api-key";
const DEVICE_SN = "FXSN001";

const realTimePayload: FoxESSRealTimeData = {
  deviceSN: DEVICE_SN,
  batterySocPercent: 73,
  solarPowerW: 3500,
  gridPowerW: 900,
  loadPowerW: 2600,
  batteryPowerW: 700,
  raw: { result: { data: { batterySoc: 73 } } },
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    startAt: "2026-04-02T00:30:00.000Z",
    endAt: "2026-04-02T03:30:00.000Z",
  },
};

function makeClient(overrides: Partial<FoxESSApiClient> = {}): FoxESSApiClient {
  return {
    getDeviceList: vi.fn(async () => [{ deviceSN: DEVICE_SN, raw: {} }]),
    getRealTimeData: vi.fn(async () => realTimePayload),
    setChargeTimes: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "FoxESSAdapter contract harness",
  createAdapter: () =>
    new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: realTimePayload,
  vendorErrorSample: new FoxESSTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

describe("FoxESSAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("declares expected capabilities", () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    expect(adapter.capabilities).toEqual(["read_soc", "read_power", "schedule_window"]);
  });

  it("reads configured device realtime data", async () => {
    const client = makeClient();
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client,
    });

    await adapter.readTelemetry();
    expect(client.getRealTimeData).toHaveBeenCalledWith(API_KEY, DEVICE_SN);
  });

  it("resolves first device when deviceSN is not configured", async () => {
    const client = makeClient();
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      client,
    });

    await adapter.readTelemetry();
    expect(client.getDeviceList).toHaveBeenCalledWith(API_KEY);
    expect(client.getRealTimeData).toHaveBeenCalledWith(API_KEY, DEVICE_SN);
  });

  it("maps telemetry into canonical fields", async () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].batterySocPercent).toBe(73);
    expect(telemetry[0].solarGenerationW).toBe(3500);
    expect(telemetry[0].batteryPowerW).toBe(700);
    expect(telemetry[0].gridImportPowerW).toBe(900);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("maps negative battery power to discharging", () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...realTimePayload,
      batteryPowerW: -500,
    });

    expect(event.chargingState).toBe("discharging");
  });

  it("maps negative grid power to export", () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...realTimePayload,
      gridPowerW: -1200,
    });

    expect(event.gridImportPowerW).toBeUndefined();
    expect(event.gridExportPowerW).toBe(1200);
  });

  it("dispatches non-schedule commands as accepted no-op", async () => {
    const client = makeClient();
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client,
    });

    const result = await adapter.dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setChargeTimes).not.toHaveBeenCalled();
  });

  it("schedule_window uses force charge time API", async () => {
    const client = makeClient();
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    expect(client.setChargeTimes).toHaveBeenCalledWith(API_KEY, DEVICE_SN, {
      startAt: scheduleCommand.effectiveWindow.startAt,
      endAt: scheduleCommand.effectiveWindow.endAt,
    });
  });

  it("throws unsupported device for foreign target", async () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    await expect(
      adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("throws auth failure when api key is missing", async () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: "",
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    await expect(adapter.readTelemetry()).rejects.toThrow(/API key is missing/);
  });

  it("throws when device list is empty", async () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      client: makeClient({ getDeviceList: vi.fn(async () => []) }),
    });

    await expect(adapter.readTelemetry()).rejects.toThrow(/No FoxESS deviceSN available/);
  });

  it("maps AUTH_FAILURE to UNAUTHORIZED", () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new FoxESSTransportError("AUTH_FAILURE", "bad auth", 401, false),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAUTHORIZED");
  });

  it("maps RATE_LIMIT to RATE_LIMITED", () => {
    const adapter = new FoxESSAdapter({
      deviceId: DEVICE_ID,
      apiKey: API_KEY,
      deviceSN: DEVICE_SN,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new FoxESSTransportError("RATE_LIMIT", "too many", 429, true),
      "telemetry_translation",
    );

    expect(mapped.code).toBe("RATE_LIMITED");
  });
});

describe("FoxESSHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getDeviceList calls /device/list with token header", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { data: [{ deviceSN: DEVICE_SN }] } }),
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const list = await client.getDeviceList(API_KEY);

    expect(list[0].deviceSN).toBe(DEVICE_SN);
    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    const calledInit = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(calledUrl).toContain("/device/list");
    expect((calledInit.headers as Record<string, string>).token).toBe(API_KEY);
  });

  it("getRealTimeData calls /device/real/query and parses telemetry", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { data: { batterySoc: 80, pvPower: 4200, gridPower: 700, loadPower: 3000, batteryPower: 900 } } }),
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const data = await client.getRealTimeData(API_KEY, DEVICE_SN);

    expect(data.batterySocPercent).toBe(80);
    expect(data.solarPowerW).toBe(4200);
    expect(data.gridPowerW).toBe(700);
    expect(data.loadPowerW).toBe(3000);
    expect(data.batteryPowerW).toBe(900);
  });

  it("setChargeTimes calls forceChargeTime endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { ok: true } }),
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargeTimes(API_KEY, DEVICE_SN, {
      startAt: scheduleCommand.effectiveWindow.startAt,
      endAt: scheduleCommand.effectiveWindow.endAt,
    });

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("/device/battery/forceChargeTime/set");
  });

  it("throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getDeviceList(API_KEY).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws RATE_LIMIT on 429", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getRealTimeData(API_KEY, DEVICE_SN).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws MALFORMED_RESPONSE when device list is malformed", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: {} }),
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getDeviceList(API_KEY)).rejects.toThrow(/missing device array/);
  });

  it("throws MALFORMED_RESPONSE when real-time data misses battery SoC", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { data: { pvPower: 4200 } } }),
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getRealTimeData(API_KEY, DEVICE_SN)).rejects.toThrow(/missing battery SoC/);
  });

  it("throws NETWORK_ERROR on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getDeviceList(API_KEY).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws MALFORMED_RESPONSE on non-json response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });

    const client = new FoxESSHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getDeviceList(API_KEY).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });

  it("supports custom baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { data: [{ deviceSN: DEVICE_SN }] } }),
    });

    const client = new FoxESSHttpApiClient({
      baseUrl: "https://custom.foxess.test/op/v0",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.getDeviceList(API_KEY);
    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl.startsWith("https://custom.foxess.test/op/v0")).toBe(true);
  });
});
