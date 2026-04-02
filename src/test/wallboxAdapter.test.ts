import { beforeEach, describe, expect, it, vi } from "vitest";
import { WallboxAdapter } from "../adapters/wallbox/WallboxAdapter";
import { WallboxHttpApiClient, WallboxTransportError, type WallboxApiClient, type WallboxStatusPayload } from "../adapters/wallbox/WallboxApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "wallbox-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const EMAIL = "wb@example.com";
const PASSWORD = "secret";
const CHARGER_ID = "12345";
const TOKEN = "wb-token";

const statusPayload: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: true, powerW: 6800, raw: {} };
const scheduleCommand = { kind: "schedule_window" as const, targetDeviceId: DEVICE_ID, effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" } };

function makeClient(overrides: Partial<WallboxApiClient> = {}): WallboxApiClient {
  return {
    login: vi.fn(async () => TOKEN),
    getChargerStatus: vi.fn(async () => statusPayload),
    setChargerAction: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "WallboxAdapter contract harness",
  createAdapter: () => new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: statusPayload,
  vendorErrorSample: new WallboxTransportError("AUTH_FAILURE", "bad", 401, false),
});

describe("WallboxAdapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("declares capabilities", () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reads telemetry", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.readTelemetry();
    expect(client.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(client.getChargerStatus).toHaveBeenCalledWith(TOKEN, CHARGER_ID);
  });

  it("maps telemetry", async () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(6800);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("non schedule no-op", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "refresh_state", targetDeviceId: DEVICE_ID });
    expect(client.setChargerAction).not.toHaveBeenCalled();
  });

  it("schedule starts and stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand(scheduleCommand);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 1);
    expect(client.setChargerAction).toHaveBeenCalledWith(TOKEN, CHARGER_ID, "start");
    expect(client.setChargerAction).toHaveBeenCalledWith(TOKEN, CHARGER_ID, "stop");
  });

  it("foreign device rejected", async () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    await expect(adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID })).rejects.toThrow(/does not handle device/);
  });

  it("missing creds rejected", async () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: "", password: "", chargerId: "", client: makeClient() });
    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or charger ID are missing/);
  });

  it("maps auth error", () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new WallboxTransportError("AUTH_FAILURE", "x"), "command_dispatch").code).toBe("UNAUTHORIZED");
  });

  it("maps timeout error", () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new WallboxTransportError("TIMEOUT", "x"), "command_dispatch").code).toBe("TIMEOUT");
  });

  it("maps unknown error", () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new WallboxTransportError("NETWORK_ERROR", "x"), "command_dispatch").code).toBe("UNKNOWN");
  });
});

describe("WallboxHttpApiClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login uses basic auth and parses token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jwt: TOKEN }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const token = await client.login(EMAIL, PASSWORD);
    expect(token).toBe(TOKEN);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toContain("Basic ");
  });

  it("status endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "charging", charging_power: 7000 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, CHARGER_ID);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/v2/charger/${CHARGER_ID}`);
  });

  it("remote action endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargerAction(TOKEN, CHARGER_ID, "start");
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/v3/chargers/${CHARGER_ID}/remote-action`);
  });

  it("sends bearer auth for status", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "idle", charging_power: 0 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, CHARGER_ID);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws malformed login token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toThrow(/missing token/);
  });

  it("throws auth failure", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws rate limit", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws network error", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("down"));
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws malformed non-json", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });
});
