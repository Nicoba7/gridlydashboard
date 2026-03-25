import { describe, expect, it } from "vitest";
import { buildAveumPlan } from "../lib/gridlyPlan";

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

function slotIndexFromTime(time: string) {
  const [hh, mm] = time.split(":").map(Number);
  return (hh * 2) + (mm >= 30 ? 1 : 0);
}

describe("buildAveumPlan sessions", () => {
  it("produces a complete canonical session list", () => {
    const rates = makeRates();
    const { plan } = buildAveumPlan(
      rates,
      ["solar", "battery", "ev", "grid"],
      20,
      "CHEAPEST",
      {
        batteryStartPct: 18,
        batteryReservePct: 24,
        evTargetKwh: 16,
        evReadyBy: "07:00",
      }
    );

    const sessionTypes = new Set(plan.sessions.map((session) => session.type));

    expect(sessionTypes.has("battery_charge")).toBe(true);
    expect(sessionTypes.has("ev_charge")).toBe(true);
    expect(sessionTypes.has("export")).toBe(true);
    expect(sessionTypes.has("solar_use")).toBe(true);
    expect(sessionTypes.has("hold")).toBe(true);
  });

  it("merges adjacent slots of the same session type", () => {
    const rates = makeRates();
    const { plan } = buildAveumPlan(
      rates,
      ["solar", "battery", "ev", "grid"],
      20,
      "BALANCED",
      {
        batteryStartPct: 20,
        batteryReservePct: 30,
        evTargetKwh: 14,
        evReadyBy: "07:00",
      }
    );

    const sessions = plan.sessions;

    for (let i = 1; i < sessions.length; i += 1) {
      const prev = sessions[i - 1];
      const curr = sessions[i];
      const isTouching = slotIndexFromTime(prev.end) === slotIndexFromTime(curr.start);
      expect(prev.type === curr.type && isTouching).toBe(false);
    }
  });
});
