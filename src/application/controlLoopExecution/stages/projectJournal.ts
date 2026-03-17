import type {
  CycleEconomicSnapshot,
  CycleHeartbeatEntry,
  ExecutionCycleFinancialContext,
  ExecutionJournalEntry,
} from "../../../journal/executionJournal";
import type {
  RuntimeExecutionGuardrailContext,
  RuntimeExecutionPosture,
} from "../executionPolicyTypes";
import type {
  CommandExecutionResult,
} from "../types";
import { toExecutionJournalEntry } from "../toExecutionJournalEntry";
import type {
  DecisionNarrative,
  ExecutionEdgeContext,
  ExecutionPlan,
  ExecutionResult,
  JournalProjection,
  OpportunityReasonCode,
  RejectedOpportunity,
} from "../pipelineTypes";

const VALUE_SEEKING_ACTIONS = new Set([
  "charge_battery",
  "discharge_battery",
  "charge_ev",
  "export_to_grid",
]);

function inferLegacyRejectedStage(reasonCodes: string[]): RejectedOpportunity["stage"] {
  if (reasonCodes.includes("INFERIOR_ECONOMIC_VALUE")) {
    return "device_arbitration";
  }

  if (reasonCodes.includes("INFERIOR_HOUSEHOLD_ECONOMIC_VALUE")) {
    return "household_decision";
  }

  if (
    reasonCodes.some((code) =>
      code.startsWith("EXECUTION_PLAN_") || code === "CONFLICTING_COMMAND_FOR_DEVICE",
    )
  ) {
    return "execution_planning";
  }

  return "eligibility";
}

function buildCycleEconomicSnapshot(
  ctx: ExecutionCycleFinancialContext | undefined,
  executionPosture: RuntimeExecutionPosture,
  commandsSuppressed: number,
): CycleEconomicSnapshot | undefined {
  if (!ctx) {
    return undefined;
  }

  const hasValueSeekingDecisions = ctx.decisionsTaken.some((d) => VALUE_SEEKING_ACTIONS.has(d.action));
  const valueSeekingExecutionDeferred =
    executionPosture !== "normal" && commandsSuppressed > 0 && hasValueSeekingDecisions;

  return {
    optimizationMode: ctx.optimizationMode,
    planningConfidenceLevel: ctx.planningConfidenceLevel,
    conservativeAdjustmentApplied: ctx.conservativeAdjustmentApplied,
    hasValueSeekingDecisions,
    valueSeekingExecutionDeferred,
    estimatedSavingsVsBaselinePence: ctx.valueLedger.estimatedSavingsVsBaselinePence,
    planningInputCoverage: ctx.planningInputCoverage,
  };
}

function mapLegacyCompatibilityRejections(
  outcomes: CommandExecutionResult[],
  contextByExecutionRequestId: Map<string, ExecutionEdgeContext>,
): RejectedOpportunity[] {
  return outcomes
    .filter((outcome) => outcome.status !== "issued" && (outcome.reasonCodes?.length ?? 0) > 0)
    .map((outcome) => {
      const reasonCodes = (outcome.reasonCodes ?? []) as OpportunityReasonCode[];
      const context = contextByExecutionRequestId.get(outcome.executionRequestId);

      const canonicalOpportunityId = context?.opportunityId
        ?? (context?.decisionId ? context.decisionId : undefined)
        ?? (context?.planId ? `${context.planId}:incomplete_identity` : undefined)
        ?? "incomplete_identity";

      return {
        opportunityId: canonicalOpportunityId,
        decisionId: context?.decisionId,
        targetDeviceId: context?.targetDeviceId,
        stage: inferLegacyRejectedStage(reasonCodes),
        reasonCodes,
        decisionReason: context
          ? (outcome.message ?? "Command denied by canonical execution policy.")
          : "Command denied, but canonical execution context was missing for this evidence.",
        economicArbitration: outcome.economicArbitration,
      };
    });
}

function buildDecisionNarrative(params: {
  recordedAt: string;
  cycleId?: string;
  executionPlan?: ExecutionPlan;
  executionResult?: ExecutionResult;
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  rejectedOpportunities: RejectedOpportunity[];
  legacyCompatibilityOutcomes: CommandExecutionResult[];
  contextByExecutionRequestId: Map<string, ExecutionEdgeContext>;
}): DecisionNarrative {
  const compatibilityRejected = mapLegacyCompatibilityRejections(
    params.legacyCompatibilityOutcomes,
    params.contextByExecutionRequestId,
  );

  const byRejectionKey = new Map<string, RejectedOpportunity>();
  [...params.rejectedOpportunities, ...compatibilityRejected].forEach((item) => {
    const canonicalReasonKey = [...item.reasonCodes].sort().join("|");
    byRejectionKey.set(`${item.opportunityId}:${item.stage}:${canonicalReasonKey}`, item);
  });
  const mergedRejected = [...byRejectionKey.values()];

  const decisionKind =
    params.executionResult?.householdDecision.kind
      ?? params.executionPlan?.householdDecision.kind
      ?? "no_action";

  const selectedOpportunity =
    params.executionResult?.householdDecision.kind === "selected_opportunity"
      ? params.executionResult.householdDecision.selectedOpportunity
      : params.executionPlan?.householdDecision.kind === "selected_opportunity"
        ? params.executionPlan.householdDecision.selectedOpportunity
        : undefined;

  const noActionReasonCodes =
    params.executionResult?.householdDecision.kind === "no_action"
      ? params.executionResult.householdDecision.reasonCodes
      : params.executionResult?.householdDecision.kind === "abstain"
        ? params.executionResult.householdDecision.reasonCodes
        : params.executionPlan?.householdDecision.kind === "no_action"
          ? params.executionPlan.householdDecision.reasonCodes
          : params.executionPlan?.householdDecision.kind === "abstain"
            ? params.executionPlan.householdDecision.reasonCodes
            : [];

  const decisionReason =
    params.executionResult?.householdDecision.decisionReason
      ?? params.executionPlan?.householdDecision.decisionReason
      ?? "No execution opportunities available in this cycle.";

  const reasonCodes = Array.from(
    new Set<OpportunityReasonCode>([
      ...noActionReasonCodes,
      ...mergedRejected.flatMap((item) => item.reasonCodes),
    ]),
  );

  const selectedOpportunityId =
    params.executionResult?.selectedOpportunityId
      ?? (params.executionPlan?.kind === "executable" ? params.executionPlan.selectedOpportunityId : undefined);

  return {
    narrativeId: `${params.cycleId ?? "cycle-unknown"}:${selectedOpportunityId ?? "no-opportunity"}:${params.recordedAt}`,
    cycleId: params.cycleId,
    decisionKind,
    selectedOpportunityId,
    selectedDecisionId: params.executionPlan?.kind === "executable"
      ? params.executionPlan.selectedDecisionId
      : undefined,
    selectedAction: selectedOpportunity?.eligible.matchedDecisionAction,
    selectedTargetDeviceId: selectedOpportunity?.targetDeviceId,
    decisionReason,
    reasonCodes,
    eligibilityRejections: mergedRejected.filter((item) => item.stage === "eligibility"),
    deviceArbitrationRejections: mergedRejected.filter((item) => item.stage === "device_arbitration"),
    householdDecisionRejections: mergedRejected.filter((item) => item.stage === "household_decision"),
    executionPlanningRejections: mergedRejected.filter((item) => item.stage === "execution_planning"),
    planningConfidenceLevel: params.cycleFinancialContext?.planningConfidenceLevel,
    conservativeAdjustmentApplied: params.cycleFinancialContext?.conservativeAdjustmentApplied,
    conservativeAdjustmentReason: params.cycleFinancialContext?.conservativeAdjustmentReason,
  };
}

function buildCycleHeartbeat(params: {
  recordedAt: string;
  executionPosture: RuntimeExecutionPosture;
  runtimeGuardrailContext?: RuntimeExecutionGuardrailContext;
  outcomes: CommandExecutionResult[];
  failClosedTriggered: boolean;
  cycleHeartbeatMeta?: { cycleId?: string; replanReason?: string };
  cycleFinancialContext?: ExecutionCycleFinancialContext;
}): CycleHeartbeatEntry {
  const commandsSuppressed = params.outcomes.filter(
    (result) =>
      result.status === "skipped" &&
      (result.reasonCodes ?? []).some((code) => code.startsWith("RUNTIME_") || code.startsWith("ECONOMIC_")),
  ).length;

  return {
    entryKind: "cycle_heartbeat",
    cycleId: params.cycleHeartbeatMeta?.cycleId,
    recordedAt: params.recordedAt,
    executionPosture: params.executionPosture,
    planFreshnessStatus: params.runtimeGuardrailContext?.planFreshnessStatus,
    replanTrigger: params.runtimeGuardrailContext?.replanTrigger,
    replanReason: params.cycleHeartbeatMeta?.replanReason,
    stalePlanReuseCount: params.runtimeGuardrailContext?.stalePlanReuseCount,
    safeHoldMode: params.runtimeGuardrailContext?.safeHoldMode,
    stalePlanWarning: params.runtimeGuardrailContext?.stalePlanWarning,
    commandsIssued: params.outcomes.filter((result) => result.status === "issued").length,
    commandsSkipped: params.outcomes.filter((result) => result.status === "skipped").length,
    commandsFailed: params.outcomes.filter((result) => result.status === "failed").length,
    commandsSuppressed,
    failClosedTriggered: params.failClosedTriggered,
    economicSnapshot: buildCycleEconomicSnapshot(
      params.cycleFinancialContext,
      params.executionPosture,
      commandsSuppressed,
    ),
    schemaVersion: "cycle-heartbeat.v1",
  };
}

export interface ProjectJournalInput {
  /** Canonical post-decision execution evidence used for outcome projection joins. */
  executionEdgeContexts: ExecutionEdgeContext[];
  outcomes: CommandExecutionResult[];
  recordedAt: string;
  executionPosture: RuntimeExecutionPosture;
  runtimeGuardrailContext?: RuntimeExecutionGuardrailContext;
  failClosedTriggered: boolean;
  cycleHeartbeatMeta?: { cycleId?: string; replanReason?: string };
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  executionPlan?: ExecutionPlan;
  executionResult?: ExecutionResult;
  /** Canonical stage-owned rejection accumulation. */
  rejectedOpportunities: RejectedOpportunity[];
  /** Transitional edge payloads merged for backward-compatible narrative completeness. */
  legacyCompatibilityOutcomes: CommandExecutionResult[];
}

export interface ProjectJournalOutput {
  /** Canonical projection payload returned to the controller for persistence. */
  projection: JournalProjection;
  journalEntries: ExecutionJournalEntry[];
  cycleHeartbeat: CycleHeartbeatEntry;
}

/**
 * Projects runtime outputs into the current journal/narrative schema.
 *
 * Owns: decision narrative assembly, journal entry projection, and cycle
 * heartbeat payload shaping.
 *
 * Must not: persist anything itself; store interaction stays outside this stage.
 */
export function projectJournal(params: ProjectJournalInput): ProjectJournalOutput {
  const contextByExecutionRequestId = new Map(
    params.executionEdgeContexts.map((context) => [context.executionRequestId, context]),
  );

  const journalEntries = params.outcomes
    .map((outcome) => {
      const context = contextByExecutionRequestId.get(outcome.executionRequestId);
      if (!context) {
        return undefined;
      }

      return toExecutionJournalEntry(
        context.canonicalCommand,
        {
          ...outcome,
          opportunityProvenance: outcome.opportunityProvenance ?? context.opportunityProvenance,
        },
        params.recordedAt,
        params.cycleHeartbeatMeta?.cycleId,
        params.cycleFinancialContext,
      );
    })
    .filter((entry): entry is ExecutionJournalEntry => entry !== undefined);

  const cycleHeartbeat = buildCycleHeartbeat({
    recordedAt: params.recordedAt,
    executionPosture: params.executionPosture,
    runtimeGuardrailContext: params.runtimeGuardrailContext,
    outcomes: params.outcomes,
    failClosedTriggered: params.failClosedTriggered,
    cycleHeartbeatMeta: params.cycleHeartbeatMeta,
    cycleFinancialContext: params.cycleFinancialContext,
  });

  const narrative = buildDecisionNarrative({
    recordedAt: params.recordedAt,
    cycleId: params.cycleHeartbeatMeta?.cycleId,
    executionPlan: params.executionPlan,
    executionResult: params.executionResult,
    cycleFinancialContext: params.cycleFinancialContext,
    rejectedOpportunities: params.rejectedOpportunities,
    legacyCompatibilityOutcomes: params.legacyCompatibilityOutcomes,
    contextByExecutionRequestId,
  });

  return {
    projection: {
      narrative,
      journalEntries,
      cycleHeartbeat,
    },
    journalEntries,
    cycleHeartbeat,
  };
}
