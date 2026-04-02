import { beforeEach, describe, expect, it, vi } from "vitest";
import { HypervoltAdapter } from "../adapters/hypervolt/HypervoltAdapter";
import { HypervoltHttpApiClient, HypervoltTransportError, type HypervoltApiClient, type HypervoltStatusPayload } from "../adapters/hypervolt/HypervoltApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "hypervolt-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const EMAIL = "hv@example.com";
const PASSWORD = "secret";
const CHARGER_ID = "charger-1";
const TOKEN = "hv-token";

const statusPayload: HypervoltStatusPayload = {
  chargerId: CHARGER_ID,
  charging: true,
  powerW: 7100,
  raw: {},
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" },
};

function makeClient(overrides: Partial<HypervoltApiClient> = {}): HypervoltApiClient {
  return {
    login: vi.fn(async () => TOKEN),
    getChargerStatus: vi.fn(async () => statusPayload),
    setChargeSession: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "HypervoltAdapter contract harness",
  createAdapter: () => new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: statusPayload,
  vendorErrorSample: new HypervoltTransportError("AUTH_FAILURE", "bad", 401, false),
});

describe("HypervoltAdapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("declares capabilities", () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reads telemetry with login", async () => {
    const client = makeClient();
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.readTelemetry();
    expect(client.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(client.getChargerStatus).toHaveBeenCalledWith(TOKEN, CHARGER_ID);
  });

  it("maps telemetry", async () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(7100);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("maps idle state", () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({ ...statusPayload, charging: false, powerW: 0 });
    expect(event.chargingState).toBe("idle");
  });

  it("no-op for refresh_state", async () => {
    const client = makeClient();
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    const result = await adapter.dispatchVendorCommand({ kind: "refresh_state", targetDeviceId: DEVICE_ID });
    expect(result.success).toBe(true);
    expect(client.setChargeSession).not.toHaveBeenCalled();
  });

  it("schedules start/stop session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T00:00:00.000Z"));
    const client = makeClient();
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client });
    await adapter.dispatchVendorCommand(scheduleCommand);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 1);
    expect(client.setChargeSession).toHaveBeenCalledWith(TOKEN, CHARGER_ID, true);
    expect(client.setChargeSession).toHaveBeenCalledWith(TOKEN, CHARGER_ID, false);
  });

  it("throws unsupported device", async () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    await expect(adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID })).rejects.toThrow(/does not handle device/);
  });

  it("maps auth error", () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const mapped = adapter.mapVendorErrorToCanonical(new HypervoltTransportError("AUTH_FAILURE", "x"), "command_dispatch");
    expect(mapped.code).toBe("UNAUTHORIZED");
  });

  it("maps malformed response", () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, chargerId: CHARGER_ID, client: makeClient() });
    const mapped = adapter.mapVendorErrorToCanonical(new HypervoltTransportError("MALFORMED_RESPONSE", "x"), "telemetry_translation");
    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
  });

  it("throws missing credentials", async () => {
    const adapter = new HypervoltAdapter({ deviceId: DEVICE_ID, email: "", password: "", chargerId: "", client: makeClient() });
    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or charger ID are missing/);
  });
});

describe("HypervoltHttpApiClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login parses token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: TOKEN }) });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const token = await client.login(EMAIL, PASSWORD);
    expect(token).toBe(TOKEN);
  });

  it("status endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ charging: true, powerW: 7000 }) });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, CHARGER_ID);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/charger/${CHARGER_ID}`);
  });

  it("set session endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargeSession(TOKEN, CHARGER_ID, true);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/charger/${CHARGER_ID}/session`);
  });

  it("includes bearer auth header", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ charging: false, powerW: 0 }) });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, CHARGER_ID);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws malformed token response", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toThrow(/missing token/);
  });

  it("throws auth failure on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws rate limit on 429", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws network error", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("down"));
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws malformed non-json", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
    const client = new HypervoltHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, CHARGER_ID).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });
});
