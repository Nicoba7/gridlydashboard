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

const statusPayload: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: true, powerW: 6800, v2gDischargeActive: false, localLoadActive: false, raw: {} };
const scheduleCommand = { kind: "schedule_window" as const, targetDeviceId: DEVICE_ID, effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" } };

function makeClient(overrides: Partial<WallboxApiClient> = {}): WallboxApiClient {
  return {
    login: vi.fn(async () => TOKEN),
    getChargers: vi.fn(async () => []),
    getChargerStatus: vi.fn(async () => statusPayload),
    setChargerAction: vi.fn(async () => ({ success: true })),
    setChargingCurrent: vi.fn(async () => ({ success: true })),
    setDischargeMode: vi.fn(async () => ({ success: true })),
    setLocalLoadMode: vi.fn(async () => ({ success: true })),
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
    expect(adapter.capabilities).toEqual(["read_power", "read_soc", "schedule_window", "vehicle_to_home", "v2g_discharge", "v2h_discharge"]);
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

  it("set_mode(discharge) triggers setDischargeMode(true)", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "discharge" });
    expect(client.setDischargeMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, true);
  });

  it("set_mode(hold) triggers setDischargeMode(false)", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "hold" });
    expect(client.setDischargeMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
  });

  it("set_mode(charge) triggers setDischargeMode(false)", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "charge" });
    expect(client.setDischargeMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
  });

  it("maps socPercent to batterySocPercent", async () => {
    const payloadWithSoc: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: true, powerW: 7000, socPercent: 72, v2gDischargeActive: false, localLoadActive: false, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadWithSoc) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].batterySocPercent).toBe(72);
  });

  it("maps v2gDischargeActive to negative power and discharging state", async () => {
    const payloadV2g: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: false, powerW: 5000, v2gDischargeActive: true, localLoadActive: false, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadV2g) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(-5000);
    expect(telemetry[0].chargingState).toBe("discharging");
  });

  it("idle state when not charging and not discharging", async () => {
    const payloadIdle: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: false, powerW: 0, v2gDischargeActive: false, localLoadActive: false, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadIdle) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].chargingState).toBe("idle");
  });
});

describe("WallboxAdapter V2H", () => {
  beforeEach(() => vi.useRealTimers());

  it("set_mode(vehicle_to_home) triggers setLocalLoadMode(true)", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "vehicle_to_home" });
    expect(client.setLocalLoadMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, true);
    expect(client.setDischargeMode).not.toHaveBeenCalled();
  });

  it("set_mode(hold) disables both V2G and V2H", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "hold" });
    expect(client.setDischargeMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
    expect(client.setLocalLoadMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
  });

  it("set_mode(charge) disables both V2G and V2H", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "charge" });
    expect(client.setDischargeMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
    expect(client.setLocalLoadMode).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
  });

  it("set_mode(vehicle_to_home) does not call setDischargeMode", async () => {
    const client = makeClient();
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand({ kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "vehicle_to_home" });
    expect(client.setDischargeMode).not.toHaveBeenCalled();
  });

  it("localLoadActive maps to negative power", async () => {
    const payloadV2h: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: false, powerW: 4000, v2gDischargeActive: false, localLoadActive: true, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadV2h) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(-4000);
  });

  it("localLoadActive maps to discharging state", async () => {
    const payloadV2h: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: false, powerW: 4000, v2gDischargeActive: false, localLoadActive: true, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadV2h) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].chargingState).toBe("discharging");
  });

  it("v2gDischargeActive and localLoadActive both map to discharging state", async () => {
    const payloadBoth: WallboxStatusPayload = { chargerId: CHARGER_ID, charging: false, powerW: 3000, v2gDischargeActive: true, localLoadActive: true, raw: {} };
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient({ getChargerStatus: vi.fn(async () => payloadBoth) }) });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].chargingState).toBe("discharging");
    expect(telemetry[0].evChargingPowerW).toBe(-3000);
  });

  it("vehicle_to_home result is accepted", async () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const result = adapter.mapVendorCommandResultToCanonical(
      { kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "vehicle_to_home" },
      { success: true, message: "V2H enabled" },
    );
    expect(result.status).toBe("accepted");
  });

  it("vehicle_to_home result rejected on failure", async () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const result = adapter.mapVendorCommandResultToCanonical(
      { kind: "set_mode", targetDeviceId: DEVICE_ID, mode: "vehicle_to_home" },
      { success: false, message: "local load not available" },
    );
    expect(result.status).toBe("rejected");
  });

  it("v2h_discharge appears in capabilities", () => {
    const adapter = new WallboxAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.capabilities).toContain("v2h_discharge");
  });
});

describe("WallboxHttpApiClient (V2G endpoints)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("getChargers endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargers(TOKEN);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("/v2/charger");
  });

  it("getChargers maps charger fields", async () => {
    const item = { id: "99", name: "Quasar", status: 2, maxChargingCurrent: 16, v2gCapable: true };
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [item] });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const chargers = await client.getChargers(TOKEN);
    expect(chargers[0].id).toBe("99");
    expect(chargers[0].v2gCapable).toBe(true);
    expect(chargers[0].maxChargingCurrent).toBe(16);
  });

  it("setChargingCurrent uses PUT with maxChargingCurrent body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargingCurrent(TOKEN, CHARGER_ID, 16);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toMatchObject({ maxChargingCurrent: 16 });
  });

  it("setDischargeMode enable sends supplyCurrent -1", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setDischargeMode(TOKEN, CHARGER_ID, true);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ supplyCurrent: -1 });
  });

  it("setDischargeMode disable sends supplyCurrent 0", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setDischargeMode(TOKEN, CHARGER_ID, false);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ supplyCurrent: 0 });
  });

  it("setLocalLoadMode enable sends PUT with localLoad 1", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setLocalLoadMode(TOKEN, CHARGER_ID, true);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toMatchObject({ localLoad: 1 });
  });

  it("setLocalLoadMode disable sends PUT with localLoad 0", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setLocalLoadMode(TOKEN, CHARGER_ID, false);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({ localLoad: 0 });
  });

  it("setLocalLoadMode uses charger path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setLocalLoadMode(TOKEN, CHARGER_ID, true);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/v2/charger/${CHARGER_ID}`);
  });

  it("getChargerStatus parses localLoadActive when localLoad positive", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "discharging", charging_power: 4000, localLoad: 3 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.getChargerStatus(TOKEN, CHARGER_ID);
    expect(result.localLoadActive).toBe(true);
  });

  it("getChargerStatus parses localLoadActive false when localLoad zero", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "charging", charging_power: 7000, localLoad: 0 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.getChargerStatus(TOKEN, CHARGER_ID);
    expect(result.localLoadActive).toBe(false);
  });

  it("getChargerStatus parses socPercent from soc field", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "charging", charging_power: 7000, soc: 80 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.getChargerStatus(TOKEN, CHARGER_ID);
    expect(result.socPercent).toBe(80);
  });

  it("getChargerStatus detects v2g active when supplyCurrent is negative", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "discharging", charging_power: 5000, supplyCurrent: -10 }) });
    const client = new WallboxHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await client.getChargerStatus(TOKEN, CHARGER_ID);
    expect(result.v2gDischargeActive).toBe(true);
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
