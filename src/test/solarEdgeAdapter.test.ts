import { beforeEach, describe, expect, it, vi } from "vitest";
import { SolarEdgeAdapter } from "../adapters/solaredge/SolarEdgeAdapter";
import {
  SolarEdgeHttpApiClient,
  SolarEdgeTransportError,
  type SolarEdgeApiClient,
  type SolarEdgeCurrentPowerFlow,
  type SolarEdgeSiteOverview,
} from "../adapters/solaredge/SolarEdgeApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "solaredge-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const SITE_ID = "1234567";
const API_KEY = "solaredge-key-123";

const overviewPayload: SolarEdgeSiteOverview = {
  siteId: SITE_ID,
  currentPowerW: 4600,
  energyTodayWh: 18500,
  siteStatus: "Active",
  raw: { overview: { status: "Active" } },
};

const powerFlowPayload: SolarEdgeCurrentPowerFlow = {
  siteId: SITE_ID,
  gridPowerW: 1200,
  loadPowerW: 3600,
  pvPowerW: 2800,
  storagePowerW: 900,
  raw: {
    siteCurrentPowerFlow: {
      GRID: { currentPower: 1200 },
      LOAD: { currentPower: 3600 },
      PV: { currentPower: 2800 },
      STORAGE: { currentPower: 900 },
    },
  },
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    startAt: "2026-04-02T00:30:00.000Z",
    endAt: "2026-04-02T03:30:00.000Z",
  },
};

function makeClient(overrides: Partial<SolarEdgeApiClient> = {}): SolarEdgeApiClient {
  return {
    getSiteOverview: vi.fn(async () => overviewPayload),
    getCurrentPowerFlow: vi.fn(async () => powerFlowPayload),
    setBatteryControl: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "SolarEdgeAdapter contract harness",
  createAdapter: () =>
    new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: {
    overview: overviewPayload,
    powerFlow: powerFlowPayload,
  },
  vendorErrorSample: new SolarEdgeTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

describe("SolarEdgeAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("declares expected capabilities", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    expect(adapter.capabilities).toEqual(["read_soc", "read_power", "schedule_window"]);
  });

  it("reads overview and power flow before mapping telemetry", async () => {
    const client = makeClient();
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client,
    });

    await adapter.readTelemetry();

    expect(client.getSiteOverview).toHaveBeenCalledWith(SITE_ID, API_KEY);
    expect(client.getCurrentPowerFlow).toHaveBeenCalledWith(SITE_ID, API_KEY);
  });

  it("maps telemetry into canonical power fields", async () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const telemetry = await adapter.readTelemetry();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].batteryPowerW).toBe(900);
    expect(telemetry[0].solarGenerationW).toBe(2800);
    expect(telemetry[0].gridImportPowerW).toBe(1200);
    expect(telemetry[0].gridExportPowerW).toBeUndefined();
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("maps negative storage flow to discharging", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      overview: overviewPayload,
      powerFlow: {
        ...powerFlowPayload,
        storagePowerW: -650,
      },
    });

    expect(event.chargingState).toBe("discharging");
    expect(event.batteryPowerW).toBe(-650);
  });

  it("maps negative grid flow to export", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      overview: overviewPayload,
      powerFlow: {
        ...powerFlowPayload,
        gridPowerW: -1400,
      },
    });

    expect(event.gridImportPowerW).toBeUndefined();
    expect(event.gridExportPowerW).toBe(1400);
  });

  it("dispatches non-schedule commands as accepted no-op", async () => {
    const client = makeClient();
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client,
    });

    const result = await adapter.dispatchVendorCommand({
      kind: "refresh_state",
      targetDeviceId: DEVICE_ID,
    });

    expect(result.success).toBe(true);
    expect(client.setBatteryControl).not.toHaveBeenCalled();
  });

  it("schedules time_of_use mode for schedule_window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));

    const client = makeClient();
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);

    expect(client.setBatteryControl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    expect(client.setBatteryControl).toHaveBeenCalledWith(SITE_ID, API_KEY, "time_of_use");
  });

  it("executes immediately when schedule start is in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T04:00:00.000Z"));

    const client = makeClient();
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client,
    });

    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setBatteryControl).toHaveBeenCalledWith(SITE_ID, API_KEY, "time_of_use");
  });

  it("throws unsupported device for foreign target", async () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    await expect(
      adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID }),
    ).rejects.toThrow(/does not handle device/);
  });

  it("throws auth failure when site credentials are missing", async () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: "",
      apiKey: "",
      client: makeClient(),
    });

    await expect(adapter.readTelemetry()).rejects.toThrow(/site ID or API key is missing/);
  });

  it("maps AUTH_FAILURE to UNAUTHORIZED", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new SolarEdgeTransportError("AUTH_FAILURE", "bad auth", 401, false),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new SolarEdgeTransportError("TEMPORARY_UNAVAILABLE", "down", 503, true),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps RATE_LIMIT to RATE_LIMITED", () => {
    const adapter = new SolarEdgeAdapter({
      deviceId: DEVICE_ID,
      siteId: SITE_ID,
      apiKey: API_KEY,
      client: makeClient(),
    });

    const mapped = adapter.mapVendorErrorToCanonical(
      new SolarEdgeTransportError("RATE_LIMIT", "too many requests", 429, true),
      "telemetry_translation",
    );

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });
});

describe("SolarEdgeHttpApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getSiteOverview calls /site/{id}/overview with api_key query", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        overview: {
          currentPower: { power: 5200 },
          lastDayData: { energy: 21234 },
          status: "Active",
        },
      }),
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const overview = await client.getSiteOverview(SITE_ID, API_KEY);

    expect(overview.currentPowerW).toBe(5200);
    expect(overview.energyTodayWh).toBe(21234);
    expect(overview.siteStatus).toBe("Active");

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain(`/site/${SITE_ID}/overview`);
    expect(calledUrl).toContain(`api_key=${API_KEY}`);
  });

  it("getCurrentPowerFlow calls /site/{id}/currentPowerFlow with api_key query", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        siteCurrentPowerFlow: {
          GRID: { currentPower: 800 },
          LOAD: { currentPower: 2300 },
          PV: { currentPower: 1500 },
          STORAGE: { currentPower: 200 },
        },
      }),
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const flow = await client.getCurrentPowerFlow(SITE_ID, API_KEY);

    expect(flow.gridPowerW).toBe(800);
    expect(flow.loadPowerW).toBe(2300);
    expect(flow.pvPowerW).toBe(1500);
    expect(flow.storagePowerW).toBe(200);

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain(`/site/${SITE_ID}/currentPowerFlow`);
    expect(calledUrl).toContain(`api_key=${API_KEY}`);
  });

  it("setBatteryControl posts to /site/{id}/storageData", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setBatteryControl(SITE_ID, API_KEY, "time_of_use");

    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    const calledInit = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;

    expect(calledUrl).toContain(`/site/${SITE_ID}/storageData`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.body).toBe(JSON.stringify({ mode: "time_of_use" }));
  });

  it("throws AUTH_FAILURE for 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getSiteOverview(SITE_ID, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws RATE_LIMIT for 429", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getCurrentPowerFlow(SITE_ID, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws TIMEOUT for 408", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 408 });
    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getCurrentPowerFlow(SITE_ID, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("TIMEOUT");
  });

  it("throws TEMPORARY_UNAVAILABLE for 500", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 });
    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.setBatteryControl(SITE_ID, API_KEY, "backup").catch((e) => e);
    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("TEMPORARY_UNAVAILABLE");
  });

  it("throws MALFORMED_RESPONSE when overview payload misses current power", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ overview: { status: "Active" } }),
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getSiteOverview(SITE_ID, API_KEY)).rejects.toThrow(/missing current power/);
  });

  it("throws MALFORMED_RESPONSE when power flow payload misses all nodes", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ siteCurrentPowerFlow: {} }),
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getCurrentPowerFlow(SITE_ID, API_KEY)).rejects.toThrow(/missing GRID\/LOAD\/PV\/STORAGE/);
  });

  it("throws NETWORK_ERROR on fetch failure", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });

    const err = await client.getSiteOverview(SITE_ID, API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws MALFORMED_RESPONSE on non-json response body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });

    const client = new SolarEdgeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getSiteOverview(SITE_ID, API_KEY).catch((e) => e);

    expect(err).toBeInstanceOf(SolarEdgeTransportError);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });

  it("supports custom baseUrl option", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        overview: {
          currentPower: { power: 4100 },
          lastDayData: { energy: 10234 },
          status: "Active",
        },
      }),
    });

    const client = new SolarEdgeHttpApiClient({
      baseUrl: "https://custom.solaredge.test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.getSiteOverview(SITE_ID, API_KEY);
    const calledUrl = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl.startsWith("https://custom.solaredge.test")).toBe(true);
  });
});
