import { expect } from "vitest";
import type {
  ContinuousRuntimeIntegration,
  AveumContinuousRuntimeSource,
} from "../../application/runtime/runContinuousRuntime";
import { runContinuousRuntime } from "../../application/runtime/runContinuousRuntime";
import { ManualIntervalScheduler } from "../../application/continuousLoop/intervalScheduler";
import {
  InMemoryExecutionJournalStore,
  type ExecutionJournalStore,
} from "../../journal/executionJournalStore";
import type { CycleHeartbeatEntry, ExecutionJournalEntry } from "../../journal/executionJournal";

const PROTECTIVE_REASON_CODES = new Set([
  "RUNTIME_CONSERVATIVE_MODE_ACTIVE",
  "RUNTIME_SAFE_HOLD_ACTIVE",
  "RUNTIME_PLAN_EXPIRED",
  "RUNTIME_STALE_PLAN_REUSE",
  "RUNTIME_REPLAN_GUARD_ACTIVE",
  "RUNTIME_CONTEXT_MISSING",
  "OBSERVED_STATE_STALE",
  "OBSERVED_STATE_MISSING",
  "OBSERVED_STATE_UNKNOWN",
]);

export interface IntegrationConformanceScenario<
  TSource extends AveumContinuousRuntimeSource,
  TDependencies = unknown,
> {
  suiteName: string;
  source: TSource;
  integration: ContinuousRuntimeIntegration<TSource, TDependencies>;
  integrationDependencies?: TDependencies | ((journalStore: ExecutionJournalStore) => TDependencies);
  cycleTimesIso: string[];
  expectedMappedDeviceIds: string[];
  staleObservedStateCycleIndex: number;
  economicUncertaintyCycleIndex: number;
  conflictingCommandCycleIndex: number;
  protectiveCycleIndex: number;
  recoveryCycleIndex: number;
  capabilityFailureCycleIndex: number;
  expectedCapabilityFailureReasonCode: string;
  economicPreferenceCycleIndex: number;
  crossAssetEconomicCycleIndex: number;
}

export interface IntegrationConformanceReport {
  journalStore: ExecutionJournalStore;
  state: ReturnType<Awaited<ReturnType<typeof runContinuousRuntime>>["getState"]>;
  journalEntries: ExecutionJournalEntry[];
  heartbeats: CycleHeartbeatEntry[];
}

function hasProtectiveReason(entry: ExecutionJournalEntry): boolean {
  return (entry.reasonCodes ?? []).some((reasonCode) => PROTECTIVE_REASON_CODES.has(reasonCode));
}

function entriesForCycle(
  entries: ExecutionJournalEntry[],
  heartbeat: CycleHeartbeatEntry,
): ExecutionJournalEntry[] {
  if (!heartbeat.cycleId) {
    return entries.filter((entry) => entry.recordedAt === heartbeat.recordedAt);
  }

  return entries.filter((entry) => entry.cycleId === heartbeat.cycleId);
}

export function assertEconomicInputFreshness(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const staleHeartbeat = report.heartbeats[scenario.staleObservedStateCycleIndex];
  const staleEntries = entriesForCycle(report.journalEntries, staleHeartbeat);

  expect(
    staleEntries.some(
      (entry) =>
        entry.status === "skipped" &&
        (entry.reasonCodes ?? []).some((reasonCode) =>
          reasonCode === "OBSERVED_STATE_STALE" || reasonCode === "OBSERVED_STATE_MISSING" || reasonCode === "OBSERVED_STATE_UNKNOWN"),
    ),
  ).toBe(true);
}

export function assertEconomicDecisionIntegrity(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const economicUncertaintyHeartbeat = report.heartbeats[scenario.economicUncertaintyCycleIndex];
  const economicUncertaintyEntries = entriesForCycle(report.journalEntries, economicUncertaintyHeartbeat);
  expect(
    economicUncertaintyEntries.some(
      (entry) =>
        entry.status === "skipped" &&
        (entry.reasonCodes ?? []).includes("ECONOMIC_INPUTS_UNCERTAIN"),
    ),
  ).toBe(true);

  const capabilityHeartbeat = report.heartbeats[scenario.capabilityFailureCycleIndex];
  const capabilityEntries = entriesForCycle(report.journalEntries, capabilityHeartbeat);
  expect(
    capabilityEntries.some(
      (entry) =>
        entry.stage === "preflight_validation" &&
        (entry.reasonCodes ?? []).includes(scenario.expectedCapabilityFailureReasonCode),
    ),
  ).toBe(true);

  const conflictHeartbeat = report.heartbeats[scenario.conflictingCommandCycleIndex];
  const conflictEntries = entriesForCycle(report.journalEntries, conflictHeartbeat);
  expect(
    conflictEntries.some((entry) => (entry.reasonCodes ?? []).includes("CONFLICTING_COMMAND_FOR_DEVICE")),
  ).toBe(true);
}

/**
 * Asserts that the runtime selected the economically preferred command and
 * correctly rejected the inferior alternative with INFERIOR_ECONOMIC_VALUE.
 *
 * Integration-agnostic: applies identically to Tesla, simulated, and storage-stub.
 */
export function assertEconomicPreferenceSelection(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const preferenceHeartbeat = report.heartbeats[scenario.economicPreferenceCycleIndex];
  const preferenceEntries = entriesForCycle(report.journalEntries, preferenceHeartbeat);

  // At least one command must have been issued (the preferred action).
  expect(
    preferenceEntries.some((entry) => entry.status === "issued"),
  ).toBe(true);

  // At least one command must have been rejected on economic grounds.
  expect(
    preferenceEntries.some(
      (entry) =>
        entry.status === "skipped" &&
        (entry.reasonCodes ?? []).includes("INFERIOR_ECONOMIC_VALUE"),
    ),
  ).toBe(true);
}

/**
 * Asserts that every issued journal entry carries economic decision context
 * tracing why a command was preferred, and that every suppressed entry carries
 * a reason. Complements assertFinancialDecisionTraceability with preference-
 * specific checks.
 */
export function assertEconomicDecisionTraceability(
  report: IntegrationConformanceReport,
): void {
  const preferenceRejections = report.journalEntries.filter(
    (entry) =>
      entry.status === "skipped" &&
      (entry.reasonCodes ?? []).includes("INFERIOR_ECONOMIC_VALUE"),
  );

  // Preference rejections must exist in this harness scenario set.
  expect(preferenceRejections.length).toBeGreaterThan(0);

  // Every preference rejection must have a cycle financial context so the
  // decision can be traced back to the optimizer plan.
  preferenceRejections.forEach((entry) => {
    expect(entry.cycleFinancialContext?.optimizationMode).toBeTruthy();
    expect(entry.cycleFinancialContext?.decisionsTaken.length).toBeGreaterThan(0);
  });
}

/**
 * Asserts that any command rejected due to economic inferiority carries the
 * canonical INFERIOR_ECONOMIC_VALUE reason code in its journal entry and that
 * its cycle produced at least one issued entry (i.e. a better alternative was
 * successfully dispatched in its place).
 */
export function assertInferiorActionRejection(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const preferenceHeartbeat = report.heartbeats[scenario.economicPreferenceCycleIndex];
  const preferenceEntries = entriesForCycle(report.journalEntries, preferenceHeartbeat);

  const inferiorEntries = preferenceEntries.filter(
    (entry) =>
      entry.status === "skipped" &&
      (entry.reasonCodes ?? []).includes("INFERIOR_ECONOMIC_VALUE"),
  );

  expect(inferiorEntries.length).toBeGreaterThan(0);

  const issuedInSameCycle = preferenceEntries.filter((entry) => entry.status === "issued");
  expect(issuedInSameCycle.length).toBeGreaterThan(0);

  // Both the inferior and preferred commands must target the same device,
  // proving the runtime chose between competing options for the same hardware.
  const inferiorDeviceIds = new Set(inferiorEntries.map((e) => e.targetDeviceId));
  const issuedDeviceIds = new Set(issuedInSameCycle.map((e) => e.targetDeviceId));
  const hasSharedDevice = [...inferiorDeviceIds].some((id) => issuedDeviceIds.has(id));
  expect(hasSharedDevice).toBe(true);
}

export function assertCrossAssetEconomicSelection(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const heartbeat = report.heartbeats[scenario.crossAssetEconomicCycleIndex];
  const entries = entriesForCycle(report.journalEntries, heartbeat);
  const issuedEntries = entries.filter((entry) => entry.status === "issued");
  const rejectedEntries = entries.filter(
    (entry) =>
      entry.status === "skipped" &&
      (entry.reasonCodes ?? []).includes("INFERIOR_HOUSEHOLD_ECONOMIC_VALUE"),
  );

  expect(issuedEntries.length).toBeGreaterThan(0);
  expect(rejectedEntries.length).toBeGreaterThan(0);

  const issuedDeviceIds = new Set(issuedEntries.map((entry) => entry.targetDeviceId));
  const rejectedDeviceIds = new Set(rejectedEntries.map((entry) => entry.targetDeviceId));
  const hasCrossAssetCompetition = [...rejectedDeviceIds].some((deviceId) => !issuedDeviceIds.has(deviceId));
  expect(hasCrossAssetCompetition).toBe(true);
}

export function assertCrossAssetOpportunityTraceability(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const heartbeat = report.heartbeats[scenario.crossAssetEconomicCycleIndex];
  const entries = entriesForCycle(report.journalEntries, heartbeat);
  const householdRejectedEntries = entries.filter(
    (entry) =>
      entry.status === "skipped" &&
      (entry.reasonCodes ?? []).includes("INFERIOR_HOUSEHOLD_ECONOMIC_VALUE"),
  );

  expect(householdRejectedEntries.length).toBeGreaterThan(0);

  householdRejectedEntries.forEach((entry) => {
    expect(entry.economicArbitration?.comparisonScope).toBe("household");
    expect(entry.economicArbitration?.selectedExecutionRequestId).toBeTruthy();
    expect(entry.economicArbitration?.selectedTargetDeviceId).toBeTruthy();
    expect(entry.economicArbitration?.selectedScorePencePerKwh).toBeDefined();
    expect(entry.economicArbitration?.candidateScorePencePerKwh).toBeDefined();
    expect(entry.economicArbitration?.selectionReason).toBeTruthy();
    expect(entry.economicArbitration?.comparisonReason).toBeTruthy();
    expect(entry.cycleFinancialContext?.decisionsTaken.length).toBeGreaterThan(0);
  });
}

export function assertInferiorOpportunityRejection(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  const heartbeat = report.heartbeats[scenario.crossAssetEconomicCycleIndex];
  const entries = entriesForCycle(report.journalEntries, heartbeat);
  const rejectedEntries = entries.filter(
    (entry) =>
      entry.status === "skipped" &&
      (entry.reasonCodes ?? []).includes("INFERIOR_HOUSEHOLD_ECONOMIC_VALUE"),
  );
  const winnerEntries = entries.filter(
    (entry) => entry.economicArbitration?.comparisonScope === "household" && entry.status === "issued",
  );

  expect(rejectedEntries.length).toBeGreaterThan(0);
  expect(winnerEntries.length).toBeGreaterThan(0);

  winnerEntries.forEach((entry) => {
    expect(entry.economicArbitration?.selectedExecutionRequestId).toBe(entry.executionRequestId);
    expect(entry.economicArbitration?.alternativesConsidered).toBeGreaterThan(1);
  });
}

export function assertFinancialDecisionTraceability(report: IntegrationConformanceReport): void {
  const issuedOrSuppressedEntries = report.journalEntries.filter(
    (entry) => entry.status === "issued" || entry.status === "skipped",
  );
  expect(issuedOrSuppressedEntries.length).toBeGreaterThan(0);

  issuedOrSuppressedEntries.forEach((entry) => {
    expect(entry.cycleFinancialContext?.optimizationMode).toBeTruthy();
    expect(entry.cycleFinancialContext?.valueLedger.estimatedSavingsVsBaselinePence).toBeDefined();

    if (entry.status === "issued") {
      expect(entry.cycleFinancialContext?.decisionsTaken.some((decision) => decision.decisionReason?.length)).toBe(true);
    }
  });

  const explainedRejections = report.journalEntries.filter((entry) =>
    entry.status === "skipped" || entry.status === "failed",
  );
  expect(
    explainedRejections.every(
      (entry) => (entry.reasonCodes ?? []).length > 0 || Boolean(entry.executionError),
    ),
  ).toBe(true);
}

export async function runIntegrationConformanceScenario<
  TSource extends AveumContinuousRuntimeSource,
  TDependencies = unknown,
>(
  scenario: IntegrationConformanceScenario<TSource, TDependencies>,
): Promise<IntegrationConformanceReport> {
  const journalStore = new InMemoryExecutionJournalStore();
  const scheduler = new ManualIntervalScheduler();

  let cycleIndex = 0;
  const resolvedDependencies = typeof scenario.integrationDependencies === "function"
    ? scenario.integrationDependencies(journalStore)
    : scenario.integrationDependencies;

  const runtime = await runContinuousRuntime({
    source: scenario.source,
    integration: scenario.integration,
    integrationDependencies: resolvedDependencies,
    launcherDependencies: {
      journalStore,
      scheduler,
      nowFn: () => new Date(scenario.cycleTimesIso[Math.min(cycleIndex, scenario.cycleTimesIso.length - 1)]),
    },
  });

  await runtime.start();
  for (let index = 1; index < scenario.cycleTimesIso.length; index += 1) {
    cycleIndex = index;
    await scheduler.tick();
  }

  runtime.stop();

  return {
    journalStore,
    state: runtime.getState(),
    journalEntries: journalStore.getAll(),
    heartbeats: journalStore.getCycleHeartbeats(),
  };
}

export function assertIntegrationConformance(
  scenario: IntegrationConformanceScenario<AveumContinuousRuntimeSource, unknown>,
  report: IntegrationConformanceReport,
): void {
  expect(report.state.cycleCount).toBe(scenario.cycleTimesIso.length);
  expect(report.heartbeats).toHaveLength(scenario.cycleTimesIso.length);
  expect(report.journalEntries.length).toBeGreaterThan(0);

  report.heartbeats.forEach((heartbeat, cycleIdx) => {
    expect(heartbeat.recordedAt).toBe(scenario.cycleTimesIso[cycleIdx]);
    expect(heartbeat.schemaVersion).toBe("cycle-heartbeat.v1");
    expect(heartbeat.cycleId).toBeTruthy();

    const cycleEntries = entriesForCycle(report.journalEntries, heartbeat);
    expect(cycleEntries.length).toBe(
      heartbeat.commandsIssued + heartbeat.commandsSkipped + heartbeat.commandsFailed,
    );
  });

  const targetDeviceIds = new Set(report.journalEntries.map((entry) => entry.targetDeviceId));
  scenario.expectedMappedDeviceIds.forEach((deviceId) => {
    expect(targetDeviceIds.has(deviceId)).toBe(true);
  });

  report.journalEntries.forEach((entry) => {
    expect(entry.entryId).toBeTruthy();
    expect(entry.cycleId).toBeTruthy();
    expect(entry.executionRequestId).toBeTruthy();
    expect(entry.idempotencyKey).toBeTruthy();
    expect(entry.targetDeviceId).toBeTruthy();
    expect(entry.canonicalCommand.kind).toBeTruthy();
    expect(entry.status).toMatch(/issued|skipped|failed/);
    expect(entry.schemaVersion).toBe("execution-journal.v1");
  });

  expect(report.heartbeats.some((heartbeat) => heartbeat.economicSnapshot !== undefined)).toBe(true);

  assertEconomicInputFreshness(scenario, report);
  assertEconomicDecisionIntegrity(scenario, report);
  assertFinancialDecisionTraceability(report);
  assertEconomicPreferenceSelection(scenario, report);
  assertEconomicDecisionTraceability(report);
  assertInferiorActionRejection(scenario, report);
  assertCrossAssetEconomicSelection(scenario, report);
  assertCrossAssetOpportunityTraceability(scenario, report);
  assertInferiorOpportunityRejection(scenario, report);

  const protectiveCycleHeartbeat = report.heartbeats[scenario.protectiveCycleIndex];
  const protectiveCycleEntries = entriesForCycle(report.journalEntries, protectiveCycleHeartbeat);
  expect(protectiveCycleEntries.some((entry) => entry.status === "skipped" && hasProtectiveReason(entry))).toBe(true);

  const recoveryCycleHeartbeat = report.heartbeats[scenario.recoveryCycleIndex];
  const recoveryCycleEntries = entriesForCycle(report.journalEntries, recoveryCycleHeartbeat);
  expect(recoveryCycleHeartbeat.commandsIssued).toBeGreaterThan(0);
  expect(
    recoveryCycleEntries.some((entry) => entry.status === "skipped" && hasProtectiveReason(entry)),
  ).toBe(false);
}