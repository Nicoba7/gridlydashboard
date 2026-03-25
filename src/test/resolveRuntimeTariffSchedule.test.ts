import { describe, expect, it, vi } from "vitest";
import type { TariffSchedule } from "../domain";
import { resolveRuntimeTariffSchedule } from "../application/runtime/resolveRuntimeTariffSchedule";

function buildFallbackTariffSchedule(): TariffSchedule {
  return {
    tariffId: "fallback-tariff",
    provider: "Aveum",
    name: "Fallback",
    currency: "GBP",
    updatedAt: "2026-03-16T10:00:00.000Z",
    importRates: [
      {
        startAt: "2026-03-16T10:00:00.000Z",
        endAt: "2026-03-16T10:30:00.000Z",
        unitRatePencePerKwh: 20,
        source: "estimated",
      },
    ],
  };
}

describe("resolveRuntimeTariffSchedule", () => {
  it("uses simulated tariff source by default", async () => {
    const fallback = buildFallbackTariffSchedule();
    const result = await resolveRuntimeTariffSchedule({
      now: new Date("2026-03-16T10:00:00.000Z"),
      fallbackTariffSchedule: fallback,
      sourceEnv: {},
    });

    expect(result.source).toBe("simulated");
    expect(result.tariffSchedule.tariffId).toBe("fallback-tariff");
  });

  it("uses live Octopus import rates when configured", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("G-1R-")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                valid_from: "2026-03-16T10:00:00.000Z",
                valid_to: "2026-03-16T10:30:00.000Z",
                value_inc_vat: 11.4,
              },
              {
                valid_from: "2026-03-16T10:30:00.000Z",
                valid_to: "2026-03-16T11:00:00.000Z",
                value_inc_vat: 12.6,
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          results: [
            {
              valid_from: "2026-03-16T10:30:00.000Z",
              valid_to: "2026-03-16T11:00:00.000Z",
              value_inc_vat: 21.5,
            },
            {
              valid_from: "2026-03-16T10:00:00.000Z",
              valid_to: "2026-03-16T10:30:00.000Z",
              value_inc_vat: 18.2,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await resolveRuntimeTariffSchedule({
      now: new Date("2026-03-16T10:00:00.000Z"),
      fallbackTariffSchedule: buildFallbackTariffSchedule(),
      sourceEnv: {
        GRIDLY_TARIFF_SOURCE: "octopus_live",
        GRIDLY_OCTOPUS_REGION: "C",
        GRIDLY_OCTOPUS_PRODUCT: "AGILE-FLEX-22-11-25",
      },
      fetchFn,
    });

    expect(result.source).toBe("octopus_live");
    expect(result.tariffSchedule.provider).toBe("Octopus");
    expect(result.tariffSchedule.importRates).toHaveLength(2);
    expect(result.tariffSchedule.exportRates).toHaveLength(2);
    expect(result.tariffSchedule.importRates[0].unitRatePencePerKwh).toBe(18.2);
    expect(result.tariffSchedule.exportRates?.[0].unitRatePencePerKwh).toBe(11.4);
  });

  it("falls back to simulated tariff when live fetch fails", async () => {
    const fallback = buildFallbackTariffSchedule();
    const result = await resolveRuntimeTariffSchedule({
      now: new Date("2026-03-16T10:00:00.000Z"),
      fallbackTariffSchedule: fallback,
      sourceEnv: { GRIDLY_TARIFF_SOURCE: "octopus_live" },
      fetchFn: vi.fn(async () => new Response("failed", { status: 500 })),
    });

    expect(result.source).toBe("simulated");
    expect(result.tariffSchedule.tariffId).toBe("fallback-tariff");
    expect(result.caveats[0]).toContain("fell back to simulated");
  });

  it("keeps live import but falls back export rates when export fetch fails", async () => {
    const fallback = {
      ...buildFallbackTariffSchedule(),
      exportRates: [
        {
          startAt: "2026-03-16T10:00:00.000Z",
          endAt: "2026-03-16T10:30:00.000Z",
          unitRatePencePerKwh: 8,
          source: "estimated" as const,
        },
      ],
    };

    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("G-1R-")) {
        return new Response("failed", { status: 500 });
      }

      return new Response(
        JSON.stringify({
          results: [
            {
              valid_from: "2026-03-16T10:00:00.000Z",
              valid_to: "2026-03-16T10:30:00.000Z",
              value_inc_vat: 18.2,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await resolveRuntimeTariffSchedule({
      now: new Date("2026-03-16T10:00:00.000Z"),
      fallbackTariffSchedule: fallback,
      sourceEnv: { GRIDLY_TARIFF_SOURCE: "octopus_live" },
      fetchFn,
    });

    expect(result.source).toBe("octopus_live");
    expect(result.tariffSchedule.importRates).toHaveLength(1);
    expect(result.tariffSchedule.exportRates?.[0].unitRatePencePerKwh).toBe(8);
    expect(result.caveats.some((caveat) => caveat.includes("using fallback export tariff schedule"))).toBe(true);
  });
});
