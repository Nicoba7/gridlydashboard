import { beforeEach, describe, expect, it, vi } from "vitest";
import { PodPointAdapter } from "../adapters/podpoint/PodPointAdapter";
import { PodPointHttpApiClient, PodPointTransportError, type PodPointApiClient, type PodPointUnitPayload } from "../adapters/podpoint/PodPointApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const DEVICE_ID = "podpoint-device-1";
const OTHER_DEVICE_ID = "other-device-1";
const EMAIL = "pp@example.com";
const PASSWORD = "secret";
const UNIT_ID = "unit-1";
const TOKEN = "pp-token";

const unitPayload: PodPointUnitPayload = { unitId: UNIT_ID, connected: true, charging: true, powerW: 6400, raw: {} };
const scheduleCommand = { kind: "schedule_window" as const, targetDeviceId: DEVICE_ID, effectiveWindow: { startAt: "2026-04-02T00:30:00.000Z", endAt: "2026-04-02T03:30:00.000Z" } };

function makeClient(overrides: Partial<PodPointApiClient> = {}): PodPointApiClient {
  return {
    login: vi.fn(async () => ({ token: TOKEN, userId: "user-1" })),
    getUnit: vi.fn(async () => unitPayload),
    setSchedule: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

runRealDeviceAdapterContractHarness({
  suiteName: "PodPointAdapter contract harness",
  createAdapter: () => new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: unitPayload,
  vendorErrorSample: new PodPointTransportError("AUTH_FAILURE", "bad", 401, false),
});

describe("PodPointAdapter", () => {
  beforeEach(() => vi.useRealTimers());

  it("declares capabilities", () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    expect(adapter.capabilities).toEqual(["read_power", "schedule_window"]);
  });

  it("reads telemetry", async () => {
    const client = makeClient();
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client });
    await adapter.readTelemetry();
    expect(client.login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(client.getUnit).toHaveBeenCalledWith(TOKEN, UNIT_ID);
  });

  it("maps telemetry", async () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    const telemetry = await adapter.readTelemetry();
    expect(telemetry[0].evChargingPowerW).toBe(6400);
    expect(telemetry[0].chargingState).toBe("charging");
  });

  it("non schedule no-op", async () => {
    const client = makeClient();
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client });
    await adapter.dispatchVendorCommand({ kind: "refresh_state", targetDeviceId: DEVICE_ID });
    expect(client.setSchedule).not.toHaveBeenCalled();
  });

  it("schedule posts schedule", async () => {
    const client = makeClient();
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client });
    await adapter.dispatchVendorCommand(scheduleCommand);
    expect(client.setSchedule).toHaveBeenCalledWith(TOKEN, UNIT_ID, { startAt: scheduleCommand.effectiveWindow.startAt, endAt: scheduleCommand.effectiveWindow.endAt });
  });

  it("rejects foreign device", async () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    await expect(adapter.dispatchVendorCommand({ ...scheduleCommand, targetDeviceId: OTHER_DEVICE_ID })).rejects.toThrow(/does not handle device/);
  });

  it("missing creds rejected", async () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: "", password: "", unitId: "", client: makeClient() });
    await expect(adapter.readTelemetry()).rejects.toThrow(/credentials or unit ID are missing/);
  });

  it("maps auth failure", () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new PodPointTransportError("AUTH_FAILURE", "x"), "command_dispatch").code).toBe("UNAUTHORIZED");
  });

  it("maps unavailable", () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new PodPointTransportError("TEMPORARY_UNAVAILABLE", "x"), "command_dispatch").code).toBe("UNAVAILABLE");
  });

  it("maps unknown", () => {
    const adapter = new PodPointAdapter({ deviceId: DEVICE_ID, email: EMAIL, password: PASSWORD, unitId: UNIT_ID, client: makeClient() });
    expect(adapter.mapVendorErrorToCanonical(new PodPointTransportError("NETWORK_ERROR", "x"), "command_dispatch").code).toBe("UNKNOWN");
  });
});

describe("PodPointHttpApiClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("login parses token and user id", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { token: TOKEN, userId: "user-1" } }) });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const auth = await client.login(EMAIL, PASSWORD);
    expect(auth.token).toBe(TOKEN);
    expect(auth.userId).toBe("user-1");
  });

  it("get unit path includes user id", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { token: TOKEN, userId: "user-1" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { chargeStatus: "charging", connectivityStatus: "online", powerW: 6200 } }) });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.login(EMAIL, PASSWORD);
    await client.getUnit(TOKEN, UNIT_ID);
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[1][0]);
    expect(url).toContain(`/users/user-1/units/${UNIT_ID}`);
  });

  it("schedule path", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await client.setSchedule(TOKEN, UNIT_ID, { startAt: "01:00", endAt: "05:00" });
    const url = String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain(`/units/${UNIT_ID}/schedules`);
  });

  it("requires login before getUnit", async () => {
    const client = new PodPointHttpApiClient({ fetchFn: vi.fn() as unknown as typeof fetch });
    await expect(client.getUnit(TOKEN, UNIT_ID)).rejects.toThrow(/Call login first/);
  });

  it("throws malformed login", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.login(EMAIL, PASSWORD)).rejects.toThrow(/missing token or userId/);
  });

  it("throws auth failure", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.login(EMAIL, PASSWORD).catch((e) => e);
    expect(err.code).toBe("AUTH_FAILURE");
  });

  it("throws rate limit", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.login(EMAIL, PASSWORD).catch((e) => e);
    expect(err.code).toBe("RATE_LIMIT");
  });

  it("throws network", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("down"));
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.login(EMAIL, PASSWORD).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("throws malformed non-json", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad"); } });
    const client = new PodPointHttpApiClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const err = await client.login(EMAIL, PASSWORD).catch((e) => e);
    expect(err.code).toBe("MALFORMED_RESPONSE");
  });
});
