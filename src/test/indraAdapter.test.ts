import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndraAdapter } from "../adapters/indra/IndraAdapter";
import { IndraHttpApiClient, IndraTransportError, type IndraApiClient, type IndraStatusPayload } from "../adapters/indra/IndraApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "indra-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const EMAIL = "indra@example.com";
const PASSWORD = "secret";
const DEVICE_KEY = "indra-001";
const TOKEN = "indra-token";

const statusPayload: IndraStatusPayload = { deviceId: DEVICE_KEY, charging: true, powerW: 6500, raw: {} };
const scheduleCommand = { kind: "schedule_window" as const, targetDeviceId: DEVICE_ID, effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" } };

function makeClient(overrides: Partial<IndraApiClient> = {}): IndraApiClient {
  return {
    login: vi.fn(async () => TOKEN),
    getChargerStatus: vi.fn(async () => statusPayload),
    setChargeSchedule: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "IndraAdapter contract harness",
  createAdapter: () => new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: statusPayload,
  vendorErrorSample: new IndraTransportError("AUTH_FAILURE", "bad", 401, false),
});

describe("IndraAdapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("declares capabilities", () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reads telemetry", async () => {
    const client = makeClient();
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client });
    await adapter.readTelemetry();
    expect(client.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(client.getChargerStatus).toHaveBeenCalledWith(TOKEN, DEVICE_KEY);
  });

  it("maps telemetry", async () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(6500);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("non schedule no-op", async () => {
    const client = makeClient();
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client });
    await adapter.dispatchVendorCommand({ kind: "refresh_state", targetDeviceId: DEVICE_ID });
    expect(client.setChargeSchedule).not.toHaveBeenCalled();
  });

  it("schedule posts charge schedule", async () => {
    const client = makeClient();
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client });
    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setChargeSchedule).toHaveBeenCalledWith(TOKEN, DEVICE_KEY, { startAt: scheduleCommand.effectiveWindow.startAt, endAt: scheduleCommand.effectiveWindow.endAt });
  });

  it("rejects foreign device", async () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    await expect(adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID })).rejects.toThrow(/does not handle device/);
  });

  it("missing creds rejected", async () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: "", password: "", indraDeviceId: "", client: makeClient() });
    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or device ID are missing/);
  });

  it("maps auth failure", () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new IndraTransportError("AUTH_FAILURE", "x"), "command_dispatch").code).toBe("UNAUTHORIZED");
  });

  it("maps unavailable", () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new IndraTransportError("TEMPORARY_UNAVAILABLE", "x"), "command_dispatch").code).toBe("UNAVAILABLE");
  });

  it("maps unknown", () => {
    const adapter = new IndraAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, indraDeviceId: DEVICE_KEY, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new IndraTransportError("NETWORK_ERROR", "x"), "command_dispatch").code).toBe("UNKNOWN");
  });
});

describe("IndraHttpApiClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login parses token", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: TOKEN }) });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(await client.login(EMAIL, PASSWORD)).toBe(TOKEN);
  });

  it("status endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ charging: true, powerW: 6000 }) });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, DEVICE_KEY);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/api/v1/devices/${DEVICE_KEY}`);
  });

  it("schedule endpoint path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setChargeSchedule(TOKEN, DEVICE_KEY, { startAt: "01:00", endAt: "05:00" });
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/api/v1/devices/${DEVICE_KEY}/schedule`);
  });

  it("uses bearer auth", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ charging: false, powerW: 0 }) });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.getChargerStatus(TOKEN, DEVICE_KEY);
    const init = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("throws malformed login", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toThrow(/missing token/);
  });

  it("throws auth failure", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, DEVICE_KEY).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws rate limit", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, DEVICE_KEY).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws network", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("down"));
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, DEVICE_KEY).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws malformed non-json", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
    const client = new IndraHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.getChargerStatus(TOKEN, DEVICE_KEY).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });
});
