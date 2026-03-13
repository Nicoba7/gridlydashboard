import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAiRecommendation, getAiTrustScore, recordAiFeedback } from "../lib/aiCopilot";

describe("aiCopilot", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns a recommendation with confidence", () => {
    const recommendation = buildAiRecommendation({
      mode: "EXPORT",
      currentPence: 34,
      bestSlotPence: 8,
      hasBattery: true,
      hasGrid: true,
      hasEV: true,
      optimisationGoal: "MAX_SAVINGS",
      projectedDayPlanSavings: 1.2,
    });

    expect(recommendation.title).toBeTruthy();
    expect(recommendation.confidence).toBeGreaterThanOrEqual(35);
    expect(recommendation.confidence).toBeLessThanOrEqual(95);
  });

  it("increases trust score when recommendations are accepted", () => {
    const baseline = getAiTrustScore();
    for (let i = 0; i < 8; i += 1) recordAiFeedback("accepted");
    for (let i = 0; i < 2; i += 1) recordAiFeedback("skipped");

    expect(getAiTrustScore()).toBeGreaterThan(baseline);
  });
});
