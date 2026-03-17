import { describe, expect, it, vi } from "vitest";
import { OctopusAdapter } from "../integrations/octopus/octopusAdapter";
import { optimize } from "../optimizer/engine";
import { getCanonicalSimulationSnapshot } from "../simulator";

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("OctopusAdapter integration", () => {
  it("ingests and normalizes tariff + meter telemetry", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("import-rates")) {
        return response({
          results: [
            {
              valid_from: "2026-03-16T10:00:00.000Z",
              valid_to: "2026-03-16T10:30:00.000Z",
              value_inc_vat: 19.2,
            },
          ],
        });
      }

      if (url.includes("export-rates")) {
        return response({
          results: [
            {
              valid_from: "2026-03-16T10:00:00.000Z",
              valid_to: "2026-03-16T10:30:00.000Z",
              value_inc_vat: 7.4,
            },
          ],
        });
      }

      if (url.includes("import-meter")) {
        return response({
          results: [
            {
              interval_start: "2026-03-16T10:00:00.000Z",
              interval_end: "2026-03-16T10:30:00.000Z",
              consumption: 0.65,
            },
          ],
        });
      }

      return response({
        results: [
          {
            interval_start: "2026-03-16T10:00:00.000Z",
            interval_end: "2026-03-16T10:30:00.000Z",
            consumption: 0.22,
          },
        ],
      });
    });

    const adapter = new OctopusAdapter({
      importRatesUrl: "https://octopus.local/import-rates",
      exportRatesUrl: "https://octopus.local/export-rates",
      importMeterUrl: "https://octopus.local/import-meter",
      exportMeterUrl: "https://octopus.local/export-meter",
      fetchFn,
    });

    const telemetry = await adapter.getTelemetry();
    expect(telemetry.tariffProvider.import_price).toHaveLength(1);
    expect(telemetry.tariffProvider.import_price[0].unitRatePencePerKwh).toBe(19.2);
    expect(telemetry.householdMeter.import_power).toBe(1300);
    expect(telemetry.householdMeter.cumulative_import).toBe(0.65);
    expect(telemetry.householdMeter.export_power).toBe(440);
    expect(telemetry.householdMeter.cumulative_export).toBe(0.22);

    const state = await adapter.getState();
    expect(state.connectionStatus).toBe("online");
    expect(fetchFn).toHaveBeenCalled();
  });

  it("handles missing values safely and still exposes degraded telemetry", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("import-rates")) {
        return response({ results: [{ value_inc_vat: 20 }] });
      }

      return response({ results: [] });
    });

    const adapter = new OctopusAdapter({
      importRatesUrl: "https://octopus.local/import-rates",
      exportRatesUrl: "https://octopus.local/export-rates",
      importMeterUrl: "https://octopus.local/import-meter",
      exportMeterUrl: "https://octopus.local/export-meter",
      fetchFn,
    });

    const telemetry = await adapter.getTelemetry();
    expect(telemetry.tariffProvider.import_price).toEqual([]);
    expect(telemetry.householdMeter.import_power).toBeUndefined();
    expect(telemetry.warnings.length).toBeGreaterThan(0);

    const state = await adapter.getState();
    expect(state.connectionStatus).toBe("degraded");
  });

  it("feeds optimizer tariff schedule without blocking opportunity generation pathway", async () => {
    const fetchFn = vi.fn(async () =>
      response({
        results: [
          {
            valid_from: "2026-03-16T10:00:00.000Z",
            valid_to: "2026-03-16T10:30:00.000Z",
            value_inc_vat: 14.3,
          },
          {
            valid_from: "2026-03-16T10:30:00.000Z",
            valid_to: "2026-03-16T11:00:00.000Z",
            value_inc_vat: 18.1,
          },
        ],
      }),
    );

    const adapter = new OctopusAdapter({
      importRatesUrl: "https://octopus.local/import-rates",
      fetchFn,
    });

    const telemetry = await adapter.getTelemetry();
    const snapshot = getCanonicalSimulationSnapshot(new Date("2026-03-16T10:05:00.000Z"));

    const result = optimize({
      systemState: snapshot.systemState,
      tariffSchedule: {
        ...snapshot.tariffSchedule,
        importRates: telemetry.tariffProvider.import_price,
      },
      forecasts: snapshot.forecasts,
      constraints: {
        mode: "balanced",
        allowGridBatteryCharging: true,
        allowBatteryExport: true,
        allowAutomaticEvCharging: true,
      },
    });

    expect(result.status).not.toBe("blocked");
    expect(Array.isArray(result.opportunities)).toBe(true);
  });
});
