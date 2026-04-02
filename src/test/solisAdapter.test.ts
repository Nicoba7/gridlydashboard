import { beforeEach, describe, expect, it, vi } from "vitest";
import { SolisAdapter } from "../adapters/solis/SolisAdapter";
import {
  SolisHttpApiClient,
  SolisTransportError,
  type SolisApiClient,
  type SolisInverterDetail,
} from "../adapters/solis/SolisApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "solis-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const KEY_ID = "solis-key-id";
const KEY_SECRET = "solis-key-secret";
const INVERTER_ID = "inv-001";

const detailPayload: SolisInverterDetail = {
  inverterId: INVERTER_ID,
  currentPowerW: 5000,
  dailyYieldKwh: 19.5,
  batterySocPercent: 64,
  gridPowerW: 1200,
  batteryPowerW: 1100,
  raw: { data: { currentPower: 5000 } },
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    startAt: "2026-04-02T00:30:00.000Z",
    endAt: "2026-04-02T03:30:00.000Z",
  },
};

function makeClient(overrides: Partial<SolisApiClient> = {}): SolisApiClient {
  return {
    getStationList: vi.fn(async () => [{ stationId: "station-1", raw: {} }]),
    getInverterDetail: vi.fn(async () => detailPayload),
    setChargeDischargeTimes: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "SolisAdapter contract harness",
  createAdapter: () =>
    new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: detailPayload,
  vendorErrorSample: new SolisTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

describe("SolisAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("declares expected capabilities", () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    expect(adapter.capabilities).toEqual(["read_soc", "read_power", "schedule_window"]);
  });

  it("reads inverter detail before mapping telemetry", async () => {
    const client = makeClient();
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client,
    });

    await adapter.readTelemetry();
    expect(client.getInverterDetail).toHaveBeenCalledWith(KEY_ID, KEY_SECRET, INVERTER_ID);
  });

  it("maps telemetry into canonical fields", async () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].batterySocPercent).toBe(64);
    expect(telemetry[0].solarGenerationW).toBe(5000);
    expect(telemetry[0].batteryPowerW).toBe(1100);
    expect(telemetry[0].gridImportPowerW).toBe(1200);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("maps negative grid power to export", () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...detailPayload,
      gridPowerW: -600,
    });

    expect(event.gridImportPowerW).toBeUndefined();
    expect(event.gridExportPowerW).toBe(600);
  });

  it("returns unknown charging state when battery power missing", () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...detailPayload,
      batteryPowerW: undefined,
    });

    expect(event.chargingState).toBe("unknown");
  });

  it("dispatches non-schedule commands as accepted no-op", async () => {
    const client = makeClient();
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client,
    });

    const result = await adapter.dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setChargeDischargeTimes).not.toHaveBeenCalled();
  });

  it("schedule_window writes atWrite charge schedule", async () => {
    const client = makeClient();
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    expect(client.setChargeDischargeTimes).toHaveBeenCalledWith(
      KEY_ID,
      KEY_SECRET,
      INVERTER_ID,
      scheduleCommand.effectiveWindow.startAt,
      scheduleCommand.effectiveWindow.endAt,
      "charge",
    );
  });

  it("throws unsupported device for foreign target", async () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    await expect(
      adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("throws auth failure when credentials are missing", async () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: "",
      keySecret: "",
      inverterId: "",
      client: makeClient(),
    });

    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or inverter ID are missing/);
  });

  it("maps AUTH_FAILURE to UNAUTHORIZED", () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new SolisTransportError("AUTH_FAILURE", "bad auth", 401, false),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAUTHORIZED");
  });

  it("maps RATE_LIMIT to RATE_LIMITED", () => {
    const adapter = new SolisAdapter({
      deviceId: DEVICE_ID,
      keyId: KEY_ID,
      keySecret: KEY_SECRET,
      inverterId: INVERTER_ID,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new SolisTransportError("RATE_LIMIT", "too many", 429, true),
      "telemetry_translation",
    );

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });
});

describe("SolisHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getStationList calls /v1/api/stationList with signed headers", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { page: { records: [{ stationId: "s-1" }] } } }),
    });

    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const stations = await client.getStationList(KEY_ID, KEY_SECRET);

    expect(stations[0].stationId).toBe("s-1");

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    const calledInit = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = calledInit.headers as Record<string, string>;

    expect(calledUrl).toContain("/v1/api/stationList");
    expect(headers.Authorization).toContain(`API ${KEY_ID}:`);
    expect(headers["Content-MD5"]).toBeTruthy();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Date).toBeTruthy();
  });

  it("getInverterDetail parses power/yield/soc/grid", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          currentPower: 4400,
          dayEnergy: 17.3,
          batterySoc: 70,
          gridPower: 500,
          batteryPower: 900,
        },
      }),
    });

    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const detail = await client.getInverterDetail(KEY_ID, KEY_SECRET, INVERTER_ID);

    expect(detail.currentPowerW).toBe(4400);
    expect(detail.dailyYieldKwh).toBe(17.3);
    expect(detail.batterySocPercent).toBe(70);
    expect(detail.gridPowerW).toBe(500);
    expect(detail.batteryPowerW).toBe(900);
  });

  it("setChargeDischargeTimes calls /v1/api/atWrite", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { ok: true } }),
    });

    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargeDischargeTimes(
      KEY_ID,
      KEY_SECRET,
      INVERTER_ID,
      scheduleCommand.effectiveWindow.startAt,
      scheduleCommand.effectiveWindow.endAt,
      "charge",
    );

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("/v1/api/atWrite");
  });

  it("throws AUTH_FAILURE on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getStationList(KEY_ID, KEY_SECRET).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws RATE_LIMIT on 429", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getInverterDetail(KEY_ID, KEY_SECRET, INVERTER_ID).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws MALFORMED_RESPONSE when station list is malformed", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(client.getStationList(KEY_ID, KEY_SECRET)).rejects.toThrow(/missing station array/);
  });

  it("throws MALFORMED_RESPONSE when inverter detail missing required fields", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { dayEnergy: 11 } }),
    });
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(client.getInverterDetail(KEY_ID, KEY_SECRET, INVERTER_ID)).rejects.toThrow(/missing current power or battery SoC/);
  });

  it("throws NETWORK_ERROR on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getStationList(KEY_ID, KEY_SECRET).catch((e) => e);
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
    const client = new SolisHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getStationList(KEY_ID, KEY_SECRET).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });

  it("supports custom baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { page: { records: [{ stationId: "s-1" }] } } }),
    });

    const client = new SolisHttpApiClient({
      baseUrl: "https://custom.solis.test:13333",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.getStationList(KEY_ID, KEY_SECRET);
    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl.startsWith("https://custom.solis.test:13333")).toBe(true);
  });
});
