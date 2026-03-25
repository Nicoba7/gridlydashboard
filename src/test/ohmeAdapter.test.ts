import { describe, expect, it, vi, beforeEach } from "vitest";
import { OhmeAdapter } from "../adapters/ohme/OhmeAdapter";
import { OhmeTransportError } from "../adapters/ohme/OhmeApiClient";
import type { OhmeApiClient, OhmeChargeDevicePayload } from "../adapters/ohme/OhmeApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const DEVICE_ID = "ohme-device-abc123";
const OTHER_DEVICE_ID = "ohme-device-zzz999";

const sampleDevice: OhmeChargeDevicePayload = {
  id: DEVICE_ID,
  serialNumber: "OHME-S-001",
  model: "Ohme Home Pro",
  online: true,
  mode: "CHARGE",
  power: 3200,
  carConnected: true,
  car: {
    batteryCapacityWh: 75000,
    carBatteryLevel: 62,
  },
};

const scheduleCommand = {
  kind: "schedule_window" as const,
  targetDeviceId: DEVICE_ID,
  effectiveWindow: {
    start: "2026-03-26T01:30:00.000Z",
    end: "2026-03-26T05:00:00.000Z",
  },
};

function makeClient(overrides: Partial<OhmeApiClient> = {}): OhmeApiClient {
  return {
    login: vi.fn(async () => ({ token: "tok-test-123", userId: "user-1" })),
    getChargeDevices: vi.fn(async () => [sampleDevice]),
    postSchedule: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

// ── Contract harness ───────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "OhmeAdapter contract harness",
  createAdapter: () =>
    new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() }),
  supportedDeviceId: DEVICE_ID,
  unsupportedDeviceId: OTHER_DEVICE_ID,
  canonicalCommand: scheduleCommand,
  vendorTelemetryPayload: sampleDevice,
  vendorErrorSample: new OhmeTransportError("AUTH_FAILURE", "Token expired.", 401, false),
});

// ── Adapter-specific tests ─────────────────────────────────────────────────────

describe("OhmeAdapter", () => {
  it("declares the expected capabilities", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining(["read_soc", "read_power", "schedule_window"]),
    );
    expect(adapter.capabilities).toHaveLength(3);
  });

  // ── Authentication ───────────────────────────────────────────────────────────

  it("calls login() before the first getChargeDevices call", async () => {
    const client = makeClient();
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledTimes(1);
    expect(client.getChargeDevices).toHaveBeenCalledWith("tok-test-123");
  });

  it("reuses the cached token on subsequent readTelemetry calls", async () => {
    const client = makeClient();
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    await adapter.readTelemetry();
    await adapter.readTelemetry();

    expect(client.login).toHaveBeenCalledTimes(1);
  });

  it("calls login() before postSchedule and passes token through", async () => {
    const client = makeClient();
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    await adapter.dispatchVendorCommand(scheduleCommand);

    expect(client.login).toHaveBeenCalledTimes(1);
    expect(client.postSchedule).toHaveBeenCalledWith(
      "tok-test-123",
      DEVICE_ID,
      expect.any(Number),
      expect.any(Number),
    );
  });

  // ── Schedule window dispatch ─────────────────────────────────────────────────

  it("converts ISO effectiveWindow to epoch seconds for postSchedule", async () => {
    const client = makeClient();
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    await adapter.dispatchVendorCommand(scheduleCommand);

    const [, , start, end] = (client.postSchedule as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      number,
      number,
    ];
    expect(start).toBe(Math.floor(new Date("2026-03-26T01:30:00.000Z").getTime() / 1000));
    expect(end).toBe(Math.floor(new Date("2026-03-26T05:00:00.000Z").getTime() / 1000));
  });

  it("returns accepted result for a successful schedule_window command", async () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const result = await adapter.executeCanonicalCommand(scheduleCommand);

    expect(result.status).toBe("accepted");
    expect(result.targetDeviceId).toBe(DEVICE_ID);
  });

  it("returns accepted no-op for non-schedule_window command kinds", async () => {
    const client = makeClient();
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: DEVICE_ID,
      mode: "charge",
    });

    expect(result.status).toBe("accepted");
    expect(client.postSchedule).not.toHaveBeenCalled();
  });

  // ── Telemetry mapping ────────────────────────────────────────────────────────

  it("readTelemetry() maps SoC and power from charge device", async () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const telemetry = await adapter.readTelemetry();

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(DEVICE_ID);
    expect(telemetry[0].batterySocPercent).toBe(62);
    expect(telemetry[0].evChargingPowerW).toBe(3200);
    expect(telemetry[0].evConnected).toBe(true);
    expect(telemetry[0].chargingState).toBe("charging");
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
  });

  it("sets chargingState to idle when car is not connected", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...sampleDevice,
      carConnected: false,
      power: null,
    });

    expect(event.chargingState).toBe("idle");
    expect(event.evConnected).toBe(false);
    expect(event.evChargingPowerW).toBeUndefined();
  });

  it("sets chargingState to idle when mode is PAUSED", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...sampleDevice,
      mode: "PAUSED",
      power: 0,
    });

    expect(event.chargingState).toBe("idle");
  });

  it("throws UNSUPPORTED_DEVICE when target device is absent from API response", async () => {
    const client = makeClient({ getChargeDevices: vi.fn(async () => []) });
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client });

    await expect(adapter.readTelemetry()).rejects.toThrow(
      `Ohme device "${DEVICE_ID}" not found in chargeDevices response.`,
    );
  });

  // ── Error mapping ────────────────────────────────────────────────────────────

  it("maps AUTH_FAILURE to UNAUTHORIZED (non-retryable)", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const mapped = adapter.mapVendorErrorToCanonical(
      new OhmeTransportError("AUTH_FAILURE", "Unauthorized.", 401, false),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
    expect(mapped.operation).toBe("command_dispatch");
  });

  it("maps RATE_LIMIT to RATE_LIMITED (retryable)", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const mapped = adapter.mapVendorErrorToCanonical(
      new OhmeTransportError("RATE_LIMIT", "Too many requests.", 429, true),
      "telemetry_translation",
    );

    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });

  it("maps TEMPORARY_UNAVAILABLE to UNAVAILABLE (retryable)", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const mapped = adapter.mapVendorErrorToCanonical(
      new OhmeTransportError("TEMPORARY_UNAVAILABLE", "Service down.", 503, true),
      "command_dispatch",
    );

    expect(mapped.code).toBe("UNAVAILABLE");
    expect(mapped.retryable).toBe(true);
  });

  it("maps MALFORMED_RESPONSE to INVALID_VENDOR_RESPONSE (non-retryable)", () => {
    const adapter = new OhmeAdapter({ deviceId: DEVICE_ID, client: makeClient() });

    const mapped = adapter.mapVendorErrorToCanonical(
      new OhmeTransportError("MALFORMED_RESPONSE", "Bad JSON.", undefined, false),
      "telemetry_translation",
    );

    expect(mapped.code).toBe("INVALID_VENDOR_RESPONSE");
    expect(mapped.retryable).toBe(false);
  });

  // ── HTTP client ──────────────────────────────────────────────────────────────

  it("OhmeHttpApiClient sends email and password in login POST body", async () => {
    const { OhmeHttpApiClient } = await import("../adapters/ohme/OhmeApiClient");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "live-token-xyz", userId: "u-1" }),
    })) as unknown as typeof fetch;

    const client = new OhmeHttpApiClient({
      email: "test@example.com",
      password: "hunter2",
      baseUrl: "https://api.ohme.io/v1",
      fetchFn,
    });

    const result = await client.login();

    const [calledUrl, calledInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://api.ohme.io/v1/users/me/login");
    expect(calledInit.method).toBe("POST");
    expect(JSON.parse(calledInit.body as string)).toEqual({
      email: "test@example.com",
      password: "hunter2",
    });
    expect(result.token).toBe("live-token-xyz");
  });

  it("OhmeHttpApiClient sends Bearer token when fetching charge devices", async () => {
    const { OhmeHttpApiClient } = await import("../adapters/ohme/OhmeApiClient");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [sampleDevice],
    })) as unknown as typeof fetch;

    const client = new OhmeHttpApiClient({
      email: "a@b.com",
      password: "pw",
      baseUrl: "https://api.ohme.io/v1",
      fetchFn,
    });

    await client.getChargeDevices("live-token-xyz");

    const [calledUrl, calledInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("https://api.ohme.io/v1/users/me/chargeDevices");
    expect((calledInit.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer live-token-xyz",
    );
  });

  it("OhmeHttpApiClient posts schedule to correct URL with epoch times", async () => {
    const { OhmeHttpApiClient } = await import("../adapters/ohme/OhmeApiClient");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => { throw new Error("no body"); },
    })) as unknown as typeof fetch;

    const client = new OhmeHttpApiClient({
      email: "a@b.com",
      password: "pw",
      baseUrl: "https://api.ohme.io/v1",
      fetchFn,
    });

    const result = await client.postSchedule("tok", DEVICE_ID, 1748000123, 1748003600);

    const [calledUrl, calledInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      `https://api.ohme.io/v1/users/me/chargeDevices/${DEVICE_ID}/schedule`,
    );
    expect(JSON.parse(calledInit.body as string)).toEqual({
      chargeSlots: [{ startTime: 1748000123, endTime: 1748003600 }],
    });
    expect(result.success).toBe(true);
  });
});
