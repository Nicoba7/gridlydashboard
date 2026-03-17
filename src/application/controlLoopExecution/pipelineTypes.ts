import type { OptimizerAction, PlanningConfidenceLevel } from "../../domain/optimizer";
import type { TimeWindow } from "../../domain";
import type { CommandExecutionRequest, CommandExecutionResult, ExecutionEconomicArbitrationTrace } from "./types";
import type { ExecutionPolicyReasonCode, RuntimeExecutionPosture } from "./executionPolicyTypes";
import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type { EconomicActionCandidate } from "./evaluateEconomicActionPreference";
import type { CycleHeartbeatEntry, ExecutionJournalEntry } from "../../journal/executionJournal";

/**
 * Canonical runtime contracts shared across the staged decision pipeline.
 *
 * These types describe Gridly's internal decision model. Transitional
 * request-centric compatibility payloads belong at stage edges, not here.
 */
export type OpportunityReasonCode =
  | ExecutionPolicyReasonCode
  | "CAPABILITIES_NOT_FOUND"
  | "COMMAND_KIND_NOT_SUPPORTED"
  | "POWER_SETPOINT_OUT_OF_RANGE"
  | "MODE_NOT_SUPPORTED"
  | "WINDOW_TOO_SHORT"
  | "OVERLAPPING_WINDOW_NOT_SUPPORTED"
  | "INVALID_COMMAND_FOR_DEVICE"
  | "ALREADY_SATISFIED"
  | "SHADOW_STATE_MISSING"
  | "SHADOW_STATE_INCOMPLETE"
  | "POWER_MISMATCH"
  | "MODE_MISMATCH"
  | "WINDOW_MISMATCH"
  | "COMMAND_NOT_RECONCILABLE"
  | "DEVICE_ARBITRATION_INFERIOR_ECONOMIC_VALUE"
  | "DEVICE_ARBITRATION_TIE_BROKEN"
  | "HOUSEHOLD_ARBITRATION_INFERIOR_ECONOMIC_VALUE"
  | "HOUSEHOLD_ARBITRATION_TIE_BROKEN"
  | "HOUSEHOLD_NO_ACTION_NO_ELIGIBLE_OPPORTUNITIES"
  | "HOUSEHOLD_ABSTAIN_LOW_CONFIDENCE"
  | "EXECUTION_PLAN_NON_EXECUTABLE"
  | "EXECUTION_PLAN_COMMAND_TRANSLATION_FAILED"
  | "EXECUTION_PLAN_MISSING_TARGET_DEVICE"
  | "EXECUTION_PLAN_EMPTY_COMMAND_SET";

export interface CandidateOpportunity {
  opportunityId: string;
  decisionId?: string;
  action?: OptimizerAction;
  targetScope: "device" | "household";
  targetDeviceId?: string;
  deviceContentionKey?: string;
  executionWindow?: TimeWindow;
  economicSignals: {
    effectiveStoredEnergyValuePencePerKwh?: number;
    netStoredEnergyValuePencePerKwh?: number;
    marginalImportAvoidancePencePerKwh?: number;
    exportValuePencePerKwh?: number;
  };
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
  decisionReason?: string;
}

export interface EligibleOpportunity {
  opportunityId: string;
  decisionId?: string;
  targetDeviceId?: string;
  request: CommandExecutionRequest;
  matchedDecisionAction?: OptimizerAction;
  economicCandidate?: EconomicActionCandidate;
  eligibilityBasis: {
    runtimeGuardrailPassed: boolean;
    capabilityValidationPassed: boolean;
    reconciliationPassed: boolean;
    executionPolicyPassed: boolean;
    observedStateStatus?: "fresh" | "stale" | "missing" | "unknown";
  };
}

/** Canonical rejection record produced by a specific runtime stage. */
export interface RejectedOpportunity {
  opportunityId: string;
  decisionId?: string;
  targetDeviceId?: string;
  stage: "eligibility" | "device_arbitration" | "household_decision" | "execution_planning";
  reasonCodes: OpportunityReasonCode[];
  decisionReason: string;
  economicArbitration?: ExecutionEconomicArbitrationTrace;
}

export interface DeviceArbitratedOpportunity {
  opportunityId: string;
  decisionId?: string;
  targetDeviceId?: string;
  eligible: EligibleOpportunity;
  deviceArbitration: {
    arbitrationScope: "device";
    deviceContentionKey: string;
    alternativesConsidered: number;
    selectedScorePencePerKwh?: number;
    decisionReason: string;
  };
}

export interface SelectedOpportunityDecision {
  kind: "selected_opportunity";
  selectedOpportunity: DeviceArbitratedOpportunity;
  rejectedOpportunities: RejectedOpportunity[];
  decisionReason: string;
  selectedScorePencePerKwh?: number;
}

export interface NoActionDecision {
  kind: "no_action";
  rejectedOpportunities: RejectedOpportunity[];
  reasonCodes: OpportunityReasonCode[];
  decisionReason: string;
}

export interface AbstainDecision {
  kind: "abstain";
  rejectedOpportunities: RejectedOpportunity[];
  reasonCodes: OpportunityReasonCode[];
  decisionReason: string;
}

/**
 * Canonical household-level decision.
 *
 * Invariant:
 * - `selected_opportunity` indicates an actionable economic winner.
 * - `no_action` / `abstain` indicate no dispatchable opportunity should be executed.
 */
export type HouseholdDecision = SelectedOpportunityDecision | NoActionDecision | AbstainDecision;

export interface ExecutablePlan {
  kind: "executable";
  /** Must be `selected_opportunity` for executable plans. */
  householdDecision: SelectedOpportunityDecision;
  selectedOpportunityId: string;
  selectedDecisionId?: string;
  /** Canonical adapter-agnostic command set chosen by planning stage. */
  commands: CanonicalDeviceCommand[];
}

export interface NonExecutablePlan {
  kind: "non_executable";
  /** Must be `no_action` or `abstain` for non-executable plans. */
  householdDecision: NoActionDecision | AbstainDecision;
  selectedOpportunityId?: undefined;
  selectedDecisionId?: undefined;
  reasonCodes: OpportunityReasonCode[];
  decisionReason: string;
  commands: [];
}

/**
 * Canonical execution plan boundary between planning and adapter execution stages.
 *
 * Invariant:
 * - executable plans represent adapter-dispatchable work
 * - non-executable plans carry no canonical commands
 */
export type ExecutionPlan = ExecutablePlan | NonExecutablePlan;

export interface ExecutedResult {
  kind: "executed";
  /** Executed results always reference an executable plan. */
  executionPlan: ExecutablePlan;
  householdDecision: SelectedOpportunityDecision;
  selectedOpportunityId: string;
  commandResults: CommandExecutionResult[];
  rejectedOpportunities: RejectedOpportunity[];
  executionPosture: RuntimeExecutionPosture;
}

export interface PartiallyExecutedResult {
  kind: "partially_executed";
  /** Partially executed results always reference an executable plan. */
  executionPlan: ExecutablePlan;
  householdDecision: SelectedOpportunityDecision;
  selectedOpportunityId: string;
  commandResults: CommandExecutionResult[];
  rejectedOpportunities: RejectedOpportunity[];
  executionPosture: RuntimeExecutionPosture;
}

export interface NonExecutedResult {
  kind: "non_executed";
  /** Non-executed results always reference a non-executable plan. */
  executionPlan: NonExecutablePlan;
  householdDecision: NoActionDecision | AbstainDecision;
  selectedOpportunityId?: undefined;
  commandResults: [];
  rejectedOpportunities: RejectedOpportunity[];
  executionPosture: RuntimeExecutionPosture;
}

/**
 * Canonical execution outcome returned by adapter execution stage.
 *
 * Invariant:
 * - `executed` / `partially_executed` always reference an executable plan
 * - `non_executed` always references a non-executable plan
 */
export type ExecutionResult = ExecutedResult | PartiallyExecutedResult | NonExecutedResult;

export interface DecisionNarrative {
  narrativeId: string;
  cycleId?: string;
  decisionKind: HouseholdDecision["kind"];
  selectedOpportunityId?: string;
  selectedDecisionId?: string;
  selectedAction?: OptimizerAction;
  selectedTargetDeviceId?: string;
  decisionReason: string;
  reasonCodes: OpportunityReasonCode[];
  eligibilityRejections: RejectedOpportunity[];
  deviceArbitrationRejections: RejectedOpportunity[];
  householdDecisionRejections: RejectedOpportunity[];
  executionPlanningRejections: RejectedOpportunity[];
  planningConfidenceLevel?: PlanningConfidenceLevel;
  conservativeAdjustmentApplied?: boolean;
  conservativeAdjustmentReason?: string;
}

export interface JournalProjection {
  narrative: DecisionNarrative;
  journalEntries: ExecutionJournalEntry[];
  cycleHeartbeat?: CycleHeartbeatEntry;
}

export interface EconomicPrerejection {
  reasonCodes: ExecutionPolicyReasonCode[];
  economicArbitration?: ExecutionEconomicArbitrationTrace;
}

export interface EconomicArbitrationSelection {
  prerejections: Map<string, EconomicPrerejection>;
  selectedTraces: Map<string, ExecutionEconomicArbitrationTrace>;
}