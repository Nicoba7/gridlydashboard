import { describe, expect, it } from "vitest";
import { buildOptimizationActions } from "../lib/optimizationCoach";
import { ALL_DEVICES } from "../pages/SimplifiedDashboard";

describe("buildOptimizationActions", () => {
  it("returns prioritized actions with positive impacts", () => {
    const actions = buildOptimizationActions({
      connectedDevices: ALL_DEVICES,
      currentPence: 26,
      bestSlotPrice: 7,
      solarKw: 2.8,
      gridExportW: 420,
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].impactMonthly).toBeGreaterThanOrEqual(actions[actions.length - 1].impactMonthly);
    expect(actions.every(a => a.impactMonthly > 0)).toBe(true);
  });
});
