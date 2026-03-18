import { describe, expect, it, vi } from "vitest";
import type {
  CycleContext,
  CycleSummary,
  CycleExecutor,
  ContinuousLoopState,
} from "../application/continuousLoop/controlLoopRunnerTypes";
import type { OptimizerOutput } from "../domain/optimizer";
import {
  runContinuousLoopTick,
  ContinuousControlLoopRunner,
} from "../application/continuousLoop/controlLoopRunner";
import { ManualIntervalScheduler } from "../application/continuousLoop/intervalScheduler";

// ── Shared fixtures ────────────────────────────────────────────────────────────

function buildPlan(planId = "plan-1"): OptimizerOutput {
  return {
    planId,
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
    issuedCommandCount: 0,
    skippedCommandCount: 0,
    failedCommandCount: 0,
    journalEntriesWritten: 1,
    ...overrides,
  };
}

function buildErrorSummary(cycleId: string, nowIso: string): CycleSummary {
  return {
    cycleId,
    nowIso,
    status: "error",
    replanRequired: false,
    issuedCommandCount: 0,
    skippedCommandCount: 0,
    failedCommandCount: 0,
    journalEntriesWritten: 0,
    error: { name: "DispatchError", message: "device unreachable" },
  };
}

function buildIdleState(): ContinuousLoopState {
  return { status: "idle", cycleCount: 0, consecutiveFailures: 0 };
}

function buildRunningState(
  overrides?: Partial<ContinuousLoopState>,
): ContinuousLoopState {
  return { status: "running", cycleCount: 0, consecutiveFailures: 0, ...overrides };
}

function buildMockExecutor(overrides?: Partial<CycleExecutor>): CycleExecutor {
  return {
    execute: async (ctx) => buildSuccessSummary(ctx.cycleId, ctx.nowIso),
    buildPlan: async () => buildPlan(),
    ...overrides,
  };
}

// ── runContinuousLoopTick ──────────────────────────────────────────────────────

describe("runContinuousLoopTick", () => {
  it("increments cycleCount, sets lastCycleAt, and clears consecutiveFailures on success", async () => {
    const result = await runContinuousLoopTick(
      {
        currentState: buildRunningState(),
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:00:00.000Z",
        maxConsecutiveFailures: 5,
      },
      buildMockExecutor(),
    );

    expect(result.nextState.cycleCount).toBe(1);
    expect(result.nextState.consecutiveFailures).toBe(0);
    expect(result.nextState.status).toBe("running");
    expect(result.nextState.lastCycleAt).toBe("2026-03-16T10:00:00.000Z");
    expect(result.shouldStop).toBe(false);
  });

  it("increments consecutiveFailures on error without stopping the loop", async () => {
    const executor = buildMockExecutor({
      execute: async (ctx) => buildErrorSummary(ctx.cycleId, ctx.nowIso),
    });

    const result = await runContinuousLoopTick(
      {
        currentState: buildRunningState(),
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:00:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    expect(result.nextState.status).toBe("running");
    expect(result.nextState.consecutiveFailures).toBe(1);
    expect(result.shouldStop).toBe(false);
  });

  it("resets consecutiveFailures to zero after a successful cycle following failures", async () => {
    const stateWithFailures = buildRunningState({ consecutiveFailures: 3 });

    const result = await runContinuousLoopTick(
      {
        currentState: stateWithFailures,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:10:00.000Z",
        maxConsecutiveFailures: 5,
      },
      buildMockExecutor(),
    );

    expect(result.nextState.consecutiveFailures).toBe(0);
    expect(result.nextState.status).toBe("running");
  });

  it("signals shouldStop when consecutiveFailures reaches maxConsecutiveFailures", async () => {
    const stateWith4Failures = buildRunningState({ consecutiveFailures: 4 });
    const executor = buildMockExecutor({
      execute: async (ctx) => buildErrorSummary(ctx.cycleId, ctx.nowIso),
    });

    const result = await runContinuousLoopTick(
      {
        currentState: stateWith4Failures,
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    expect(result.nextState.status).toBe("stopped");
    expect(result.shouldStop).toBe(true);
    expect(result.nextState.stoppedReason).toMatch(/5 consecutive/i);
  });

  it("derives a stable cycleId from siteId and nowIso", async () => {
    const result = await runContinuousLoopTick(
      {
        currentState: buildRunningState(),
        currentPlan: buildPlan(),
        siteId: "site-abc",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
      },
      buildMockExecutor(),
    );

    expect(result.summary.cycleId).toBe("cycle-site-abc-20260316T100500Z");
  });

  it("calls buildPlan when the previous cycle signalled replanRequired", async () => {
    const buildPlanFn = vi.fn().mockResolvedValue(buildPlan("plan-refreshed"));
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const stateWithReplanFlag = buildRunningState({
      cycleCount: 1,
      lastCycleSummary: buildSuccessSummary(
        "cycle-site-1-20260316T100000Z",
        "2026-03-16T10:00:00.000Z",
        { replanRequired: true },
      ),
    });

    const result = await runContinuousLoopTick(
      {
        currentState: stateWithReplanFlag,
        currentPlan: buildPlan("plan-stale"),
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(buildPlanFn).toHaveBeenCalledWith("2026-03-16T10:05:00.000Z");
    expect(result.nextPlan.planId).toBe("plan-refreshed");
    expect(result.summary.cycleId).toContain("20260316T100500Z");
  });

  it("marks the cycle as isReplan=true when a replan fired", async () => {
    const capturedContexts: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: async () => buildPlan("fresh"),
      execute: async (ctx) => {
        capturedContexts.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const stateWithReplanFlag = buildRunningState({
      cycleCount: 1,
      lastCycleSummary: buildSuccessSummary("old", "2026-03-16T10:00:00.000Z", {
        replanRequired: true,
      }),
    });

    await runContinuousLoopTick(
      {
        currentState: stateWithReplanFlag,
        currentPlan: buildPlan("stale"),
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    expect(capturedContexts[0].isReplan).toBe(true);
  });

  it("proceeds with the stale plan if buildPlan throws during replan", async () => {
    const executor = buildMockExecutor({
      buildPlan: vi.fn().mockRejectedValue(new Error("Tariff API offline")),
    });

    const stateWithReplanFlag = buildRunningState({
      cycleCount: 1,
      lastCycleSummary: buildSuccessSummary("old", "2026-03-16T10:00:00.000Z", {
        replanRequired: true,
      }),
    });

    const stalePlan = buildPlan("plan-stale");
    const result = await runContinuousLoopTick(
      {
        currentState: stateWithReplanFlag,
        currentPlan: stalePlan,
        siteId: "site-1",
        nowIso: "2026-03-16T10:05:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    // Cycle completes successfully with the stale plan
    expect(result.nextState.status).toBe("running");
    expect(result.nextPlan.planId).toBe("plan-stale");
    expect(result.nextState.cycleCount).toBe(2);
  });

  it("wraps unexpected executor throws into an error summary", async () => {
    const executor = buildMockExecutor({
      execute: async () => {
        throw new TypeError("Unexpected null reference");
      },
    });

    const result = await runContinuousLoopTick(
      {
        currentState: buildRunningState(),
        currentPlan: buildPlan(),
        siteId: "site-1",
        nowIso: "2026-03-16T10:00:00.000Z",
        maxConsecutiveFailures: 5,
      },
      executor,
    );

    expect(result.summary.status).toBe("error");
    expect(result.summary.error?.name).toBe("TypeError");
    expect(result.nextState.consecutiveFailures).toBe(1);
  });
});

// ── ContinuousControlLoopRunner ────────────────────────────────────────────────

describe("ContinuousControlLoopRunner", () => {
  it("starts in idle state and transitions to running after start()", async () => {
    const scheduler = new ManualIntervalScheduler();
    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      buildMockExecutor(),
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    expect(runner.getState().status).toBe("idle");
    await runner.start();
    expect(runner.getState().status).toBe("running");
  });

  it("fires the first cycle immediately on start without waiting for the first interval", async () => {
    const scheduler = new ManualIntervalScheduler();
    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      buildMockExecutor(),
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start();

    // One cycle fired immediately during start(), before any scheduler.tick()
    expect(runner.getState().cycleCount).toBe(1);
  });

  it("executes repeated cycles and increments cycleCount on each scheduled tick", async () => {
    const scheduler = new ManualIntervalScheduler();
    let tick = 0;
    const times = [
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T10:05:00.000Z",
      "2026-03-16T10:10:00.000Z",
    ];
    const nowFn = () => new Date(times[tick] ?? times[2]);

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      buildMockExecutor(),
      { scheduler, nowFn },
    );

    await runner.start(); // cycle 1 at times[0]
    tick = 1;
    await scheduler.tick(); // cycle 2 at times[1]
    tick = 2;
    await scheduler.tick(); // cycle 3 at times[2]

    expect(runner.getState().cycleCount).toBe(3);
    expect(runner.getState().lastCycleAt).toBe("2026-03-16T10:10:00.000Z");
    expect(runner.getState().status).toBe("running");
  });

  it("does not stop the loop when a single cycle fails", async () => {
    const scheduler = new ManualIntervalScheduler();
    let callCount = 0;
    const executor = buildMockExecutor({
      execute: async (ctx) => {
        callCount += 1;
        if (callCount === 2) {
          return buildErrorSummary(ctx.cycleId, ctx.nowIso);
        }
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start(); // cycle 1 — success
    await scheduler.tick(); // cycle 2 — failure
    await scheduler.tick(); // cycle 3 — success

    const state = runner.getState();
    expect(state.status).toBe("running");
    expect(state.cycleCount).toBe(3);
    // Consecutive failures reset to 0 after cycle 3 succeeded
    expect(state.consecutiveFailures).toBe(0);
  });

  it("stops the loop automatically after maxConsecutiveFailures", async () => {
    const scheduler = new ManualIntervalScheduler();
    const executor = buildMockExecutor({
      execute: async (ctx) => buildErrorSummary(ctx.cycleId, ctx.nowIso),
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1", maxConsecutiveFailures: 3 },
      executor,
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start(); // fail 1
    await scheduler.tick(); // fail 2
    await scheduler.tick(); // fail 3 → auto-stop

    const state = runner.getState();
    expect(state.status).toBe("stopped");
    expect(state.consecutiveFailures).toBe(3);
    expect(state.stoppedReason).toBeDefined();
  });

  it("creates a journal entry per cycle via the executor execute()", async () => {
    const journalLog: string[] = [];
    const scheduler = new ManualIntervalScheduler();
    const executor = buildMockExecutor({
      execute: async (ctx) => {
        journalLog.push(ctx.cycleId);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start();
    await scheduler.tick();
    await scheduler.tick();

    // One journal entry per cycle — 3 cycles total
    expect(journalLog).toHaveLength(3);
  });

  it("gives each cycle a distinct nowIso and cycleId derived from the injected clock", async () => {
    const scheduler = new ManualIntervalScheduler();
    const capturedContexts: CycleContext[] = [];
    let tick = 0;
    const times = [
      "2026-03-16T10:00:00.000Z",
      "2026-03-16T10:05:00.000Z",
      "2026-03-16T10:10:00.000Z",
    ];
    const nowFn = () => new Date(times[Math.min(tick, 2)]);

    const executor = buildMockExecutor({
      execute: async (ctx) => {
        capturedContexts.push(ctx);
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso);
      },
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn },
    );

    await runner.start(); // tick=0
    tick = 1;
    await scheduler.tick();
    tick = 2;
    await scheduler.tick();

    expect(capturedContexts).toHaveLength(3);
    expect(capturedContexts[0].nowIso).toBe("2026-03-16T10:00:00.000Z");
    expect(capturedContexts[1].nowIso).toBe("2026-03-16T10:05:00.000Z");
    expect(capturedContexts[2].nowIso).toBe("2026-03-16T10:10:00.000Z");

    // All cycleIds must be unique — derived from distinct nowIso values
    const ids = capturedContexts.map((ctx) => ctx.cycleId);
    expect(new Set(ids).size).toBe(3);
  });

  it("is idempotent on start() — does not fire an extra cycle if already running", async () => {
    const scheduler = new ManualIntervalScheduler();
    const buildPlanFn = vi.fn().mockResolvedValue(buildPlan());
    const executor = buildMockExecutor({ buildPlan: buildPlanFn });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start();
    await runner.start(); // no-op

    expect(buildPlanFn).toHaveBeenCalledOnce();
    expect(runner.getState().cycleCount).toBe(1);
  });

  it("stops cleanly via stop() and subsequent scheduled ticks are no-ops", async () => {
    const scheduler = new ManualIntervalScheduler();
    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      buildMockExecutor(),
      { scheduler, nowFn: () => new Date("2026-03-16T10:00:00.000Z") },
    );

    await runner.start();
    const cycleCountBeforeStop = runner.getState().cycleCount;

    runner.stop();
    expect(runner.getState().status).toBe("stopped");

    // Tick after stop — scheduler fn was cancelled, no new cycles run
    await scheduler.tick();
    expect(runner.getState().cycleCount).toBe(cycleCountBeforeStop);
  });

  it("rebuilds the plan at the start of the next cycle when replanRequired is signalled", async () => {
    const scheduler = new ManualIntervalScheduler();
    let tick = 0;
    const times = ["2026-03-16T10:00:00.000Z", "2026-03-16T10:05:00.000Z"];
    const nowFn = () => new Date(times[Math.min(tick, 1)]);

    const buildPlanFn = vi
      .fn()
      .mockResolvedValueOnce(buildPlan("plan-initial"))
      .mockResolvedValueOnce(buildPlan("plan-rebuilt"));

    const capturedContexts: CycleContext[] = [];
    const executor = buildMockExecutor({
      buildPlan: buildPlanFn,
      execute: async (ctx) => {
        capturedContexts.push(ctx);
        // First cycle signals that a replan is required
        const replanRequired = tick === 0;
        return buildSuccessSummary(ctx.cycleId, ctx.nowIso, { replanRequired });
      },
    });

    const runner = new ContinuousControlLoopRunner(
      { siteId: "site-1" },
      executor,
      { scheduler, nowFn },
    );

    await runner.start(); // cycle 1 — signals replanRequired
    tick = 1;
    await scheduler.tick(); // cycle 2 — should use rebuilt plan

    // buildPlan called twice: once on start, once triggered by replanRequired
    expect(buildPlanFn).toHaveBeenCalledTimes(2);
    expect(capturedContexts[1].currentPlan.planId).toBe("plan-rebuilt");
    expect(capturedContexts[1].isReplan).toBe(true);
  });
});
