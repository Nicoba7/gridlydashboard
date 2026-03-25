import { describe, expect, it } from "vitest";
import { buildAveumPlan } from "../lib/gridlyPlan";
import {
  buildPlanTimelineViewModel,
  groupDisplaySessions,
  selectDisplaySessions,
} from "../components/plan/planViewModels";
import { deriveTimelineRowEmphasis } from "../components/plan/PlanTimelineCard";

function makeRates() {
  return Array.from({ length: 48 }, (_, slotIndex) => {
    const hour = slotIndex / 2;
    const pence =
      hour < 6
        ? Number((5 + (slotIndex * 0.06)).toFixed(2))
        : hour < 15
        ? 12.6
        : hour < 19
        ? 34.8
        : 14.2;

    const hh = String(Math.floor(hour)).padStart(2, "0");
    const mm = slotIndex % 2 === 0 ? "00" : "30";
    return { time: `${hh}:${mm}`, pence };
  });
}

function rowKey(row: { time: string; action: string; coreAction?: string }) {
  return `${row.time}-${row.action}-${row.coreAction ?? "hold"}`;
}

describe("Plan timeline emphasis", () => {
  it("keeps exactly one primary planned highlight when no row is active or soon", () => {
    const rates = makeRates();
    const now = new Date("2026-03-15T12:00:00");

    const modes = ["CHEAPEST", "BALANCED", "GREENEST"] as const;

    for (const mode of modes) {
      const { plan } = buildAveumPlan(
        rates,
        ["solar", "battery", "ev", "grid"],
        20,
        mode,
        {
          batteryStartPct: 24,
          batteryReservePct: mode === "GREENEST" ? 35 : mode === "BALANCED" ? 30 : 22,
          evTargetKwh: 16,
          evReadyBy: "07:00",
        }
      );

      const groupedSessions = groupDisplaySessions(selectDisplaySessions(plan.sessions));
      const timelineViewModel = buildPlanTimelineViewModel(
        groupedSessions,
        ["solar", "battery", "ev", "grid"],
        mode
      );

      const emphasisByKey = deriveTimelineRowEmphasis(timelineViewModel.rows, now);

      const counts = timelineViewModel.rows.reduce(
        (acc, row) => {
          const emphasis = emphasisByKey.get(rowKey(row));
          if (emphasis === "active") acc.active += 1;
          if (emphasis === "soon") acc.soon += 1;
          if (emphasis === "planned") acc.planned += 1;
          if (emphasis === "default") acc.default += 1;
          return acc;
        },
        { active: 0, soon: 0, planned: 0, default: 0 }
      );

      const hasImmediateFocus = counts.active > 0 || counts.soon > 0;

      if (!hasImmediateFocus) {
        expect(counts.planned).toBe(1);
      }

      expect(counts.active + counts.soon + counts.planned).toBeGreaterThanOrEqual(1);
    }
  });

  it("prioritizes active and soon rows over planned emphasis", () => {
    const rows = [
      {
        time: "00:10–00:40",
        action: "Charge your EV before morning",
        reason: "",
        value: "8.0p",
        color: "#38BDF8",
        coreAction: "charge_ev" as const,
      },
      {
        time: "00:42–01:12",
        action: "Top up battery while rates are low",
        reason: "",
        value: "7.5p",
        color: "#4ADE80",
        coreAction: "charge_battery" as const,
      },
      {
        time: "02:00–02:30",
        action: "Sell surplus when prices peak",
        reason: "",
        value: "33.0p",
        color: "#F5B942",
        coreAction: "export" as const,
      },
    ];

    const activeNow = new Date("2026-03-15T00:20:00");
    const soonNow = new Date("2026-03-15T00:38:00");

    const activeEmphasis = deriveTimelineRowEmphasis(rows, activeNow);
    const soonEmphasis = deriveTimelineRowEmphasis(rows, soonNow);

    expect(activeEmphasis.get(rowKey(rows[0]))).toBe("active");
    expect(activeEmphasis.get(rowKey(rows[1]))).not.toBe("planned");

    expect(soonEmphasis.get(rowKey(rows[1]))).toBe("soon");
    expect(soonEmphasis.get(rowKey(rows[2]))).not.toBe("planned");
  });
});
