import { describe, expect, it, vi } from "vitest";
import { evaluatePlanFreshness } from "../application/continuousLoop/planFreshnessEvaluator";
import { evaluatePlanStateDrift } from "../application/continuousLoop/planStateDriftDetector";
import {
  runContinuousLoopTick,
  ContinuousControlLoopRunner,
} from "../application/continuousLoop/controlLoopRunner";
import { ManualIntervalScheduler } from "../application/continuousLoop/intervalScheduler";
import type {
  CycleContext,
  CycleSummary,
  CycleExecutor,
  ContinuousLoopState,
} from "../application/continuousLoop/controlLoopRunnerTypes";
import type { OptimizerOutput, OptimizerDecision } from "../domain/optimizer";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function buildPlan(
  overrides?: Partial<OptimizerOutput & { decisions?: OptimizerDecision[] }>,
): OptimizerOutput {
  return {
    planId: "plan-base",
    generatedAt: "2026-03-16T10:00:00.000Z",
    status: "ok",
    headline: "Test plan",
    decisions: [],
    recommendedCommands: [],
    summary: {
      expectedImportCostPence: 100,
      expectedExportRevenuePence: 0,
      planningNetRevenueSurplusPence: -100,
    },
    diagnostics: [],
    confidence: 0.8,
    ...overrides,
  };
}

function buildDecision(
  startAt: string,
  endAt: string,
  action: OptimizerDecision["action"] = "hold",
  expectedBatterySocPercent?: number,
): OptimizerDecision {
  return {
    decisionId: `dec-${startAt}`,
    startAt,
    endAt,
    executionWindow: { startAt, endAt },
    action,
    targetDeviceIds: ["battery-1"],
    reason: "test decision",
    confidence: 0.9,
    expectedBatterySocPercent,
  };
}

function buildRunningState(
  overrides?: Partial<ContinuousLoopState>,
): ContinuousLoopState {
  return {
    status: "running",
    cycleCount: 0,
    consecutiveFailures: 0,
    stalePlanCycleCount: 0,
    ...overrides,
  };
}

function buildSuccessSummary(
  cycleId: string,
  nowIso: string,
  overrides?: Partial<CycleSummary>,
): CycleSummary {
  return {
    cycleId,
    nowIso,
    status: "ok",
    replanRequired: false,
    issuedCommandCount: 1,
    skippedCommandCount: 0,
    failedCommandCount: 0,
    journalEntriesWritten: 1,
    ...overrides,
  };
}

function buildMockExecutor(overrides?: Partial<CycleExecutor>): CycleExecutor {
  return {
    execute: async (ctx) =>
      buildSuccessSummary(ctx.cycleId, ctx.nowIso),
    buildPlan: async () => buildPlan(),
    ...overrides,
  };
}

// ── evaluatePlanFreshness ─────────────────────────────────────────────────────

describe("evaluatePlanFreshness", () => {
  it("returns absent with no_plan trigger when no planGeneratedAt is supplied", () => {
    const result = evaluatePlanFreshness(undefined, "2026-03-16T10:30:00.000Z", 1800);

    expect(result.status).toBe("absent");
    expect(result.planAgeSeconds).toBe(0);
    expect(result.replanTrigger).toBe("no_plan");
    expect(result.replanReason).toBeDefined();
  });

  it("returns fresh when plan age is within threshold", () => {
    const result = evaluatePlanFreshness(
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T10:20:00.000Z", // 20 min old
      1800, // 30 min threshold
    );

    expect(result.status).toBe("fresh");
    expect(result.planAgeSeconds).toBeCloseTo(1200, 0);
    expect(result.replanTrigger).toBeUndefined();
    expect(result.replanReason).toBeUndefined();
  });

  it("returns stale with stale_plan trigger when plan exceeds threshold but not 2x", () => {
    const result = evaluatePlanFreshness(
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T10:40:00.000Z", // 40 min old, threshold 30 min
      1800,
    );

    expect(result.status).toBe("stale");
    expect(result.replanTrigger).toBe("stale_plan");
    expect(result.replanReason).toMatch(/stale/i);
    expect(result.planAgeSeconds).toBeCloseTo(2400, 0);
  });

  it("returns expired with expired_plan trigger when plan exceeds 2x threshold", () => {
    const result = evaluatePlanFreshness(
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T11:10:00.000Z", // 70 min old, threshold 30 min
      1800,
    );

    expect(result.status).toBe("expired");
    expect(result.replanTrigger).toBe("expired_plan");
    expect(result.replanReason).toMatch(/expired/i);
  });

  it("treats plan generated at cycle time as age 0 (fresh)", () => {
    const ts = "2026-03-16T10:00:00.000Z";
    const result = evaluatePlanFreshness(ts, ts, 1800);

    expect(result.status).toBe("fresh");
    expect(result.planAgeSeconds).toBe(0);
  });
});

// ── evaluatePlanStateDrift ────────────────────────────────────────────────────

describe("evaluatePlanStateDrift", () => {
  it("returns no drift when all signals are within tolerance", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "charge_battery",
          60,
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedBatterySocPercent: 62, // within 15pp
      observedChargingState: "charging", // matches charge_battery
      lastCommandFailed: false,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(false);
    expect(result.driftTriggers).toHaveLength(0);
    expect(result.replanReason).toBeUndefined();
  });

  it("detects soc_drift when observed SoC deviates beyond threshold", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "hold",
          80, // plan expected 80%
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedBatterySocPercent: 50, // 30pp below 80 — exceeds 15pp threshold
      observedChargingState: "idle",
      lastCommandFailed: false,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(true);
    expect(result.driftTriggers).toContain("soc_drift");
    expect(result.socDeviationPercent).toBeCloseTo(30, 1);
    expect(result.replanReason).toMatch(/SoC/);
  });

  it("detects charging_state_mismatch when observed state contradicts plan action", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "charge_battery",
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedBatterySocPercent: 60,
      observedChargingState: "discharging", // plan says charge, device is discharging
      lastCommandFailed: false,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(true);
    expect(result.driftTriggers).toContain("charging_state_mismatch");
    expect(result.replanReason).toMatch(/discharging/);
  });

  it("detects command_outcome_failure when lastCommandFailed is true", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "hold",
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedChargingState: "idle",
      lastCommandFailed: true,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(true);
    expect(result.driftTriggers).toContain("command_outcome_failure");
  });

  it("ignores charging state mismatch when observed state is unknown", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "charge_battery",
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedChargingState: "unknown",
      lastCommandFailed: false,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(false);
  });

  it("returns no drift when no decisions exist for nowIso (no active window)", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T11:00:00.000Z",
          "2026-03-16T11:30:00.000Z",
          "charge_battery",
          80,
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z", // outside the decision window
      plan,
      observedBatterySocPercent: 30, // extreme — no decision to compare against
      observedChargingState: "discharging",
      lastCommandFailed: false,
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(false);
    expect(result.expectedSocPercent).toBeUndefined();
  });

  it("detects multiple drift triggers simultaneously", () => {
    const plan = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:00:00.000Z",
          "2026-03-16T10:30:00.000Z",
          "charge_battery",
          75,
        ),
      ],
    });

    const result = evaluatePlanStateDrift({
      nowIso: "2026-03-16T10:10:00.000Z",
      plan,
      observedBatterySocPercent: 40, // 35pp off
      observedChargingState: "discharging", // wrong direction
      lastCommandFailed: true, // also failed
      socDriftThresholdPercent: 15,
    });

    expect(result.driftDetected).toBe(true);
    expect(result.driftTriggers).toContain("command_outcome_failure");
    expect(result.driftTriggers).toContain("soc_drift");
    expect(result.driftTriggers).toContain("charging_state_mismatch");
  });
});

// ── runContinuousLoopTick — freshness integration ─────────────────────────────

describe("runContinuousLoopTick freshness integration", () => {
  it("triggers replan and tracks planGeneratedAt when plan is stale", async () => {
    const freshPlan = buildPlan({
      planId: "plan-fresh",
      generatedAt: "2026-03-16T10:30:00.000Z",
    });
    const buildPlanFn = vi.fn().mockResolvedValue(freshPlan);
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    // Plan generated 40 min ago vs 30 min threshold — stale
    const nowIso = "2026-03-16T10:40:00.000Z";
    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
    });

    const result = await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan({ planId: "plan-stale" }),
        siteId: "site-1",
        nowIso,
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800, // 30 min
      },
      executor,
    );

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(result.nextPlan.planId).toBe("plan-fresh");
    expect(result.nextState.planGeneratedAt).toBe("2026-03-16T10:30:00.000Z");
    expect(result.nextState.lastSuccessfulPlanAt).toBe(nowIso);
    expect(result.nextState.stalePlanCycleCount).toBe(0);
  });

  it("triggers replan when plan is expired (>2x threshold)", async () => {
    const buildPlanFn = vi.fn().mockResolvedValue(buildPlan({ planId: "plan-rebuilt" }));
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z", // 70 min old
      stalePlanCycleCount: 0,
    });

    const result = await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T09:10:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(result.nextPlan.planId).toBe("plan-rebuilt");
    expect(result.nextState.planFreshnessStatus).toBe("fresh");
  });

  it("emits replanTrigger=stale_plan in CycleContext when stale", async () => {
    const capturedCtxs: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: async () => buildPlan({ planId: "plan-new" }),
      execute: async (ctx) => {
        capturedCtxs.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
    });

    await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:40:00.000Z", // 40 min old
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(capturedCtxs[0].replanTriggered).toBe(true);
    expect(capturedCtxs[0].replanTrigger).toBe("stale_plan");
    expect(capturedCtxs[0].replanReason).toMatch(/stale/i);
    expect(capturedCtxs[0].isReplan).toBe(true);
  });

  it("does not trigger replan when plan is fresh and no drift", async () => {
    const buildPlanFn = vi.fn();
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const freshState = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
    });

    await runContinuousLoopTick(
      {
        currentState: freshState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:10:00.000Z", // 10 min old — fresh
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(buildPlanFn).not.toHaveBeenCalled();
  });

  it("increments stalePlanCycleCount when replan fails and keeps stale plan", async () => {
    const stalePlan = buildPlan({ planId: "plan-stale" });
    const executor = buildMockExecutor({
      buildPlan: vi.fn().mockRejectedValue(new Error("API timeout")),
    });

    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 1,
    });

    const result = await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: stalePlan,
        siteId: "site-1",
        nowIso: "2026-03-16T09:10:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(result.nextPlan.planId).toBe("plan-stale");
    expect(result.nextState.stalePlanCycleCount).toBe(2);
    expect(result.nextState.planFreshnessStatus).toBe("expired");
  });

  it("resets stalePlanCycleCount to zero after a successful replan", async () => {
    const executor = buildMockExecutor({
      buildPlan: async () => buildPlan({ planId: "plan-recovered" }),
    });

    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 2,
    });

    const result = await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T09:10:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(result.nextState.stalePlanCycleCount).toBe(0);
    expect(result.nextPlan.planId).toBe("plan-recovered");
  });
});

// ── runContinuousLoopTick — state-drift integration ───────────────────────────

describe("runContinuousLoopTick drift integration", () => {
  it("triggers replan when last cycle's observed SoC materially drifted from plan", async () => {
    const buildPlanFn = vi.fn().mockResolvedValue(buildPlan({ planId: "plan-post-drift" }));
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const planWithSocExpectation = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:05:00.000Z",
          "2026-03-16T10:35:00.000Z",
          "hold",
          70, // expected SoC
        ),
      ],
    });

    // Last cycle reported SoC of 40% against an expectation of 70% — 30pp drift
    const stateWithDrift = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
      lastCycleSummary: buildSuccessSummary(
        "cycle-site-1-20260316T100500Z",
        "2026-03-16T10:05:00.000Z",
        { observedBatterySocPercent: 40 },
      ),
    });

    const nowIso = "2026-03-16T10:10:00.000Z";
    const result = await runContinuousLoopTick(
      {
        currentState: stateWithDrift,
        currentPlan: planWithSocExpectation,
        siteId: "site-1",
        nowIso,
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        socDriftThresholdPercent: 15,
      },
      executor,
    );

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(result.nextPlan.planId).toBe("plan-post-drift");
    expect(result.nextState.stalePlanCycleCount).toBe(0);
  });

  it("records soc_drift as primary replanTrigger in CycleContext when SoC drifts", async () => {
    const capturedCtxs: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: async () => buildPlan({ planId: "plan-fresh" }),
      execute: async (ctx) => {
        capturedCtxs.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const planWithSoc = buildPlan({
      decisions: [
        buildDecision(
          "2026-03-16T10:05:00.000Z",
          "2026-03-16T10:35:00.000Z",
          "hold",
          80,
        ),
      ],
    });

    const stateWithSocDrift = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
      lastCycleSummary: buildSuccessSummary(
        "prev-cycle",
        "2026-03-16T10:05:00.000Z",
        { observedBatterySocPercent: 50 }, // 30pp off from 80
      ),
    });

    await runContinuousLoopTick(
      {
        currentState: stateWithSocDrift,
        currentPlan: planWithSoc,
        siteId: "site-1",
        nowIso: "2026-03-16T10:10:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        socDriftThresholdPercent: 15,
      },
      executor,
    );

    expect(capturedCtxs[0].replanTrigger).toBe("soc_drift");
    expect(capturedCtxs[0].replanReason).toMatch(/SoC/);
  });

  it("triggers replan when last cycle had failed commands (command_outcome_failure)", async () => {
    const buildPlanFn = vi.fn().mockResolvedValue(buildPlan({ planId: "plan-recovery" }));
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const stateWithFailedCommand = buildRunningState({
      planGeneratedAt: "2026-03-16T10:00:00.000Z",
      stalePlanCycleCount: 0,
      lastCycleSummary: buildSuccessSummary(
        "prev-cycle",
        "2026-03-16T10:00:00.000Z",
        {
          failedCommandCount: 1,
          status: "ok",
        },
      ),
    });

    const result = await runContinuousLoopTick(
      {
        currentState: stateWithFailedCommand,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
      },
      executor,
    );

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(result.nextPlan.planId).toBe("plan-recovery");
  });
});

// ── Safe-hold mode ────────────────────────────────────────────────────────────

describe("runContinuousLoopTick safe-hold mode", () => {
  it("sets safeHoldMode=true in CycleContext when stalePlanCycleCount reaches stalePlanMaxCycles", async () => {
    const capturedCtxs: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: vi.fn().mockRejectedValue(new Error("API down")),
      execute: async (ctx) => {
        capturedCtxs.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    // stalePlanCycleCount already at max-1+1 = 3 after this tick
    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 2, // becomes 3 after this tick
    });

    await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T09:30:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
      },
      executor,
    );

    expect(capturedCtxs[0].safeHoldMode).toBe(true);
    expect(capturedCtxs[0].stalePlanWarning).toMatch(/Safe-hold mode active/);
    expect(capturedCtxs[0].stalePlanReuseCount).toBe(3);
  });

  it("safeHoldMode=false when stalePlanCycleCount is below threshold", async () => {
    const capturedCtxs: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: vi.fn().mockRejectedValue(new Error("API down")),
      execute: async (ctx) => {
        capturedCtxs.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const staleState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 0, // becomes 1 after this tick — below threshold of 3
    });

    await runContinuousLoopTick(
      {
        currentState: staleState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T09:30:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
      },
      executor,
    );

    expect(capturedCtxs[0].safeHoldMode).toBe(false);
    expect(capturedCtxs[0].stalePlanWarning).toBeUndefined();
  });

  it("clears safeHoldMode in CycleContext after a successful replan", async () => {
    const capturedCtxs: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: async () => buildPlan({ planId: "plan-recovered" }),
      execute: async (ctx) => {
        capturedCtxs.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    // Was stuck in safe-hold mode (count=4)
    const stuckState = buildRunningState({
      planGeneratedAt: "2026-03-16T08:00:00.000Z",
      stalePlanCycleCount: 4,
    });

    await runContinuousLoopTick(
      {
        currentState: stuckState,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T09:30:00.000Z",
        maxConsecutiveFailures: 5,
        planFreshnessThresholdSeconds: 1800,
        stalePlanMaxCycles: 3,
      },
      executor,
    );

    // Replan succeeded → stalePlanCycleCount reset to 0 → safeHoldMode cleared
    expect(capturedCtxs[0].safeHoldMode).toBe(false);
    expect(capturedCtxs[0].stalePlanReuseCount).toBe(0);
    expect(capturedCtxs[0].stalePlanWarning).toBeUndefined();
  });

  it("runner tracks stalePlanCycleCount in observable state across repeated failures", async () => {
    const scheduler = new ManualIntervalScheduler();
    let tick = 0;
    const times = [
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T11:00:00.000Z", // plan now stale (+60 min)
      "2026-03-16T12:00:00.000Z", // plan still stale (+120 min), expired
    ];
    const nowFn = () => new Date(times[Math.min(tick, 2)]);

    const executor = buildMockExecutor({
      // buildPlan succeeds on start (gives plan generated at 10:00), then fails
      buildPlan: vi
        .fn()
        .mockResolvedValueOnce(
          buildPlan({ planId: "plan-initial", generatedAt: "2026-03-16T10:00:00.000Z" }),
        )
        .mockRejectedValue(new Error("Tariff API offline")),
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-r", planFreshnessThresholdSeconds: 1800, stalePlanMaxCycles: 3 },
      executor,
      { scheduler, nowFn },
    );

    await runner.start(); // tick=0, plan built, first cycle runs (fresh)
    tick = 1;
    await scheduler.tick(); // plan stale, replan fails → stalePlanCycleCount=1
    tick = 2;
    await scheduler.tick(); // plan expired, replan fails → stalePlanCycleCount=2

    const state = runner.getState();
    expect(state.stalePlanCycleCount).toBe(2);
    expect(state.planFreshnessStatus).toBe("expired");
    expect(state.planGeneratedAt).toBe("2026-03-16T10:00:00.000Z");
  });
});

// ── ContinuousControlLoopRunner — freshness and drift wiring ──────────────────

describe("ContinuousControlLoopRunner freshness wiring", () => {
  it("records planGeneratedAt and lastSuccessfulPlanAt after start()", async () => {
    const scheduler = new ManualIntervalScheduler();
    const executor = buildMockExecutor({
      buildPlan: async () =>
        buildPlan({ planId: "p1", generatedAt: "2026-03-16T10:00:00.000Z" }),
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start();

    const state = runner.getState();
    expect(state.planGeneratedAt).toBe("2026-03-16T10:00:00.000Z");
    expect(state.lastSuccessfulPlanAt).toBeDefined();
    expect(state.stalePlanCycleCount).toBe(0);
  });

  it("updates lastSuccessfulPlanAt when a scheduled cycle triggers a successful replan", async () => {
    const scheduler = new ManualIntervalScheduler();
    let tick = 0;
    const times = [
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T10:40:00.000Z", // stale — triggers replan
    ];
    const nowFn = () => new Date(times[Math.min(tick, 1)]);

    const executor = buildMockExecutor({
      buildPlan: vi
        .fn()
        .mockResolvedValueOnce(
          buildPlan({ planId: "plan-initial", generatedAt: "2026-03-16T10:00:00.000Z" }),
        )
        .mockResolvedValueOnce(
          buildPlan({ planId: "plan-refreshed", generatedAt: "2026-03-16T10:40:00.000Z" }),
        ),
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1", planFreshnessThresholdSeconds: 1800 },
      executor,
      { scheduler, nowFn },
    );

    await runner.start(); // builds plan-initial

    tick = 1;
    await scheduler.tick(); // stale at 10:40, builds plan-refreshed

    const state = runner.getState();
    expect(state.planGeneratedAt).toBe("2026-03-16T10:40:00.000Z");
    expect(state.lastSuccessfulPlanAt).toBe("2026-03-16T10:40:00.000Z");
    expect(state.stalePlanCycleCount).toBe(0);
    expect(state.planFreshnessStatus).toBe("fresh");
  });
});
