import { describe, expect, it, vi } from "vitest";
import { GivEnergyAdapter } from "../adapters/givenergy/GivEnergyAdapter";
import { GivEnergyTransportError } from "../adapters/givenergy/GivEnergyApiClient";
import { runRealDeviceAdapterContractHarness } from "./harness/realDeviceAdapterContractHarness";

const INVERTER_SERIAL = "CE1234G567";
const OTHER_SERIAL = "CE9999X000";

const sampleSystemDataPayload = {
  inverterSerial: INVERTER_SERIAL,
  timestamp: "2026-03-25T10:00:00.000Z",
  batterySocPercent: 72,
  batteryPowerW: 500,
  batteryCapacityKwh: 9.5,
  solarPowerW: 1800,
  gridPowerW: -200,
};

function makeClient() {
  return {
    readSystemData: vi.fn(async () => sampleSystemDataPayload),
    setChargeTarget: vi.fn(async () => ({ success: true, message: "OK" })),
  };
}

// ── Contract harness ───────────────────────────────────────────────────────────

runRealDeviceAdapterContractHarness({
  suiteName: "GivEnergyAdapter contract harness",
  createAdapter: () =>
    new GivEnergyAdapter({
      inverterSerial: INVERTER_SERIAL,
      client: makeClient(),
    }),
  supportedDeviceId: INVERTER_SERIAL,
  unsupportedDeviceId: OTHER_SERIAL,
  canonicalCommand: {
    kind: "set_mode",
    targetDeviceId: INVERTER_SERIAL,
    mode: "charge",
  },
  vendorTelemetryPayload: sampleSystemDataPayload,
  vendorErrorSample: new GivEnergyTransportError("AUTH_FAILURE", "API key invalid.", 401, false),
});

// ── Adapter-specific tests ─────────────────────────────────────────────────────

describe("GivEnergyAdapter", () => {
  it("declares the expected capabilities", () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    expect(adapter.capabilities).toEqual(
      expect.arrayContaining(["read_power", "read_energy", "read_soc", "set_mode", "set_reserve_soc"]),
    );
  });

  it("routes set_mode(charge) to setChargeTarget with enable_charge: true", async () => {
    const client = makeClient();
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client });

    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: INVERTER_SERIAL,
      mode: "charge",
    });

    expect(result.status).toBe("accepted");
    expect(client.setChargeTarget).toHaveBeenCalledWith(INVERTER_SERIAL, "charge");
  });

  it("routes set_mode(discharge) to setChargeTarget with discharge mode", async () => {
    const client = makeClient();
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client });

    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: INVERTER_SERIAL,
      mode: "discharge",
    });

    expect(result.status).toBe("accepted");
    expect(client.setChargeTarget).toHaveBeenCalledWith(INVERTER_SERIAL, "discharge");
  });

  it("routes set_mode(hold) to setChargeTarget with hold mode", async () => {
    const client = makeClient();
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client });

    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: INVERTER_SERIAL,
      mode: "hold",
    });

    expect(result.status).toBe("accepted");
    expect(client.setChargeTarget).toHaveBeenCalledWith(INVERTER_SERIAL, "hold");
  });

  it("readTelemetry() fetches system data and maps to canonical telemetry", async () => {
    const client = makeClient();
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client });

    const telemetry = await adapter.readTelemetry();

    expect(client.readSystemData).toHaveBeenCalledWith(INVERTER_SERIAL);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].deviceId).toBe(INVERTER_SERIAL);
    expect(telemetry[0].batterySocPercent).toBe(72);
    expect(telemetry[0].batteryPowerW).toBe(500);
    expect(telemetry[0].solarGenerationW).toBe(1800);
    // gridPowerW -200 → exporting 200 W, zero import
    expect(telemetry[0].gridImportPowerW).toBe(0);
    expect(telemetry[0].gridExportPowerW).toBe(200);
    expect(telemetry[0].schemaVersion).toBe("telemetry.v1");
  });

  it("maps grid surplus (negative gridPowerW) to gridExportPowerW and zero import", () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...sampleSystemDataPayload,
      gridPowerW: -500,
    });
    expect(event.gridImportPowerW).toBe(0);
    expect(event.gridExportPowerW).toBe(500);
  });

  it("maps grid deficit (positive gridPowerW) to gridImportPowerW and zero export", () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    const [event] = adapter.mapVendorTelemetryToCanonicalTelemetry({
      ...sampleSystemDataPayload,
      gridPowerW: 300,
    });
    expect(event.gridImportPowerW).toBe(300);
    expect(event.gridExportPowerW).toBe(0);
  });

  it("maps AUTH_FAILURE vendor error to UNAUTHORIZED canonical error", () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    const mapped = adapter.mapVendorErrorToCanonical(
      new GivEnergyTransportError("AUTH_FAILURE", "Unauthorized.", 401),
      "command_dispatch",
    );
    expect(mapped.code).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
    expect(mapped.operation).toBe("command_dispatch");
  });

  it("maps RATE_LIMIT vendor error to RATE_LIMITED canonical error (retryable)", () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    const mapped = adapter.mapVendorErrorToCanonical(
      new GivEnergyTransportError("RATE_LIMIT", "Too many requests.", 429, true),
      "command_dispatch",
    );
    expect(mapped.code).toBe("RATE_LIMITED");
    expect(mapped.retryable).toBe(true);
  });

  it("returns failed execution result when command targets an unsupported device", async () => {
    const adapter = new GivEnergyAdapter({ inverterSerial: INVERTER_SERIAL, client: makeClient() });
    const result = await adapter.executeCanonicalCommand({
      kind: "set_mode",
      targetDeviceId: OTHER_SERIAL,
      mode: "charge",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReasonCode).toBe("UNSUPPORTED_DEVICE");
  });

  it("GivEnergyHttpApiClient calls correct system-data URL with Bearer auth", async () => {
    const { GivEnergyHttpApiClient } = await import("../adapters/givenergy/GivEnergyApiClient");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          time: "2026-03-25 10:00:00",
          battery: { percent: 80, power: 1000 },
          solar: { power: 2000 },
          grid: { power: -500 },
          inverter: { battery_capacity: 9.5 },
        },
      }),
    })) as unknown as typeof fetch;

    const client = new GivEnergyHttpApiClient({
      apiKey: "test-api-key",
      baseUrl: "https://api.givenergy.cloud/v1",
      fetchFn,
    });

    const result = await client.readSystemData(INVERTER_SERIAL);

    const [calledUrl, calledInit] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`https://api.givenergy.cloud/v1/inverter/${INVERTER_SERIAL}/system-data/latest`);
    expect((calledInit.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-api-key");

    expect(result.batterySocPercent).toBe(80);
    expect(result.batteryPowerW).toBe(1000);
    expect(result.solarPowerW).toBe(2000);
    expect(result.gridPowerW).toBe(-500);
    // time string normalised to ISO-8601
    expect(result.timestamp).toBe("2026-03-25T10:00:00Z");
  });

  it("GivEnergyHttpApiClient calls correct command URL for set-charge-target", async () => {
    const { GivEnergyHttpApiClient } = await import("../adapters/givenergy/GivEnergyApiClient");
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { success: true, message: "Command accepted." } }),
    })) as unknown as typeof fetch;

    const client = new GivEnergyHttpApiClient({
      apiKey: "test-api-key",
      baseUrl: "https://api.givenergy.cloud/v1",
      fetchFn,
    });

    const result = await client.setChargeTarget(INVERTER_SERIAL, "charge");

    const [calledUrl] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(calledUrl).toBe(
      `https://api.givenergy.cloud/v1/inverter/${INVERTER_SERIAL}/commands/set-charge-target`,
    );
    expect(result.success).toBe(true);
  });
});
