import { beforeEach, describe, expect, it, vi } from "vitest";
import { EaseeAdapter } from "../adapters/easee/EaseeAdapter";
import { EaseeHttpApiClient, EaseeTransportError, type EaseeApiClient, type EaseeStatePayload } from "../adapters/easee/EaseeApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "easee-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const USER = "easee@example.com";
const PASS = "secret";
const CHARGER_ID = "EH12345";
const TOKEN = "easee-token";

const statePayload: EaseeStatePayload = { chargerId: CHARGER_ID, charging: true, powerW: 7200, raw: {} };
const scheduleCommand = { kind: "schedule_window" as const, targetDeviceId: DEVICE_ID, effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" } };

function makeClient(overrides: Partial<EaseeApiClient> = {}): EaseeApiClient {
  return {
    login: vi.fn(async () => TOKEN),
    getChargerState: vi.fn(async () => statePayload),
    sendCommand: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "EaseeAdapter contract harness",
  createAdapter: () => new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: statePayload,
  vendorErrorSample: new EaseeTransportError("AUTH_FAILURE", "bad", 401, false),
});

describe("EaseeAdapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("declares capabilities", () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reads telemetry with login", async () => {
    const client = makeClient();
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client });
    await adapter.readTelemetry();
    expect(client.login).toHaveBeenCalledWith(USER, PASS);
    expect(client.getChargerState).toHaveBeenCalledWith(TOKEN, CHARGER_ID);
  });

  it("maps telemetry", async () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(7200);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("non schedule no-op", async () => {
    const client = makeClient();
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "refresh_state", targetDeviceId: DEVICE_ID });
    expect(client.sendCommand).not.toHaveBeenCalled();
  });

  it("schedule sends start and stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));
    const client = makeClient();
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand(scheduleCommand);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 1);
    expect(client.sendCommand).toHaveBeenCalledWith(TOKEN, CHARGER_ID, "start_charging");
    expect(client.sendCommand).toHaveBeenCalledWith(TOKEN, CHARGER_ID, "stop_charging");
  });

  it("rejects foreign device", async () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    await expect(adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID })).rejects.toThrow(/does not handle device/);
  });

  it("missing creds rejected", async () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: "", password: "", chargerId: "", client: makeClient() });
    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or charger ID are missing/);
  });

  it("maps auth failure", () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new EaseeTransportError("AUTH_FAILURE", "x"), "command_dispatch").code).toBe("UNAUTHORIZED");
  });

  it("maps unavailable", () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new EaseeTransportError("TEMPORARY_UNAVAILABLE", "x"), "command_dispatch").code).toBe("UNAVAILABLE");
  });

  it("maps unknown", () => {
    const adapter = new EaseeAdapter({ deviceId: DEVICE_ID, userName: USER, password: PASS, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new EaseeTransportError("NETWORK_ERROR", "x"), "command_dispatch").code).toBe("UNKNOWN");
  });
});

describe("EaseeHttpApiClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login parses token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: TOKEN }) });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(await client.login(USER, PASS)).toBe(TOKEN);
  });

  it("state endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ chargerOpMode: "charging", totalPower: 7200 }) });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerState(TOKEN, CHARGER_ID);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/api/chargers/${CHARGER_ID}/state`);
  });

  it("command endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.sendCommand(TOKEN, CHARGER_ID, "start_charging");
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/api/chargers/${CHARGER_ID}/commands/start_charging`);
  });

  it("uses bearer auth", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ chargerOpMode: "idle", totalPower: 0 }) });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerState(TOKEN, CHARGER_ID);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws malformed login", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(USER, PASS)).rejects.toThrow(/missing token/);
  });

  it("throws auth failure", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerState(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws rate limit", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerState(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws network", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("down"));
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerState(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws malformed non-json", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
    const client = new EaseeHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerState(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });
});
