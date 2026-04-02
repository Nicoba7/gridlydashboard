import type { OptimizerAction } from "../../domain/optimizer";
import type { CanonicalDeviceCommand } from "./canonicalCommand";
import type {
  ExecutionPolicyReasonCode,
  RuntimeExecutionPosture,
  RuntimeExecutionGuardrailContext,
} from "./executionPolicyTypes";
import {
  classifyRuntimeExecutionPosture,
  type RuntimeExecutionPostureClassification,
} from "./classifyRuntimeExecutionPosture";
import type { ExecutionCycleFinancialContext } from "../../journal/executionJournal";

export interface RuntimeExecutionGuardrailInput {
  command: CanonicalDeviceCommand;
  decisionAction?: OptimizerAction;
  cycleFinancialContext?: ExecutionCycleFinancialContext;
  runtimeContext?: RuntimeExecutionGuardrailContext;
  runtimePosture?: RuntimeExecutionPosture;
  postureClassification?: RuntimeExecutionPostureClassification;
}

export interface RuntimeExecutionGuardrailDecision {
  policy: "allow" | "suppress" | "downgrade";
  reasonCodes: ExecutionPolicyReasonCode[];
  reason?: string;
}

const AGGRESSIVE_ACTIONS = new Set<OptimizerAction>([
  "charge_battery",
  "discharge_battery",
  "discharge_ev_to_home",
  "divert_solar_to_ev",
  "divert_solar_to_battery",
  "export_to_grid",
  "charge_ev",
]);

function isHoldLikeCommand(command: CanonicalDeviceCommand): boolean {
  if (command.kind === "refresh_state" || command.kind === "stop_charging") {
    return true;
  }

  if (command.kind === "set_mode") {
    return command.mode === "hold" || command.mode === "stop";
  }

  return false;
}

function isAggressiveCommand(command: CanonicalDeviceCommand): boolean {
  if (command.kind === "set_mode") {
    return command.mode !== "hold" && command.mode !== "stop";
  }

  return (
    command.kind === "start_charging" ||
    command.kind === "set_power_limit" ||
    command.kind === "set_target_soc" ||
    command.kind === "set_reserve_soc" ||
    command.kind === "schedule_window"
  );
}

function evaluateEconomicUncertaintyReasonCodes(
  input: RuntimeExecutionGuardrailInput,
): ExecutionPolicyReasonCode[] {
  const reasonCodes: ExecutionPolicyReasonCode[] = [];
  const cycleFinancialContext = input.cycleFinancialContext;

  if (!cycleFinancialContext) {
    return reasonCodes;
  }

  const importCoverage = cycleFinancialContext.planningInputCoverage?.tariffImport.availableSlots;
  const exportCoverage = cycleFinancialContext.planningInputCoverage?.tariffExport.availableSlots;
  const action = input.decisionAction;

  if (cycleFinancialContext.planningConfidenceLevel === "low") {
    reasonCodes.push("ECONOMIC_CONFIDENCE_LOW");
  }

  if (importCoverage === 0) {
    reasonCodes.push("ECONOMIC_TARIFF_INPUT_MISSING");
  }

  if (action === "export_to_grid" && exportCoverage === 0) {
    reasonCodes.push("ECONOMIC_TARIFF_INPUT_MISSING");
  }

  if (reasonCodes.length > 0) {
    reasonCodes.unshift("ECONOMIC_INPUTS_UNCERTAIN");
  }

  return Array.from(new Set(reasonCodes));
}

/**
 * Pure runtime guardrail evaluator.
 *
 * Applies conservative dispatch policy based on continuous-loop runtime context
 * so stale/drifted planning conditions cannot trigger aggressive real-world
 * command dispatch.
 */
export function evaluateRuntimeExecutionGuardrail(
  input: RuntimeExecutionGuardrailInput,
): RuntimeExecutionGuardrailDecision {
  const economicUncertaintyReasonCodes = evaluateEconomicUncertaintyReasonCodes(input);
  const aggressiveByAction = input.decisionAction
    ? AGGRESSIVE_ACTIONS.has(input.decisionAction)
    : false;
  const aggressiveByCommand = isAggressiveCommand(input.command);

  if (economicUncertaintyReasonCodes.length > 0 && (aggressiveByAction || aggressiveByCommand)) {
    return {
      policy: "suppress",
      reasonCodes: economicUncertaintyReasonCodes,
      reason: "Economic inputs are uncertain. Aggressive command dispatch suppressed.",
    };
  }

  const postureClassification = input.postureClassification ?? classifyRuntimeExecutionPosture(input.runtimeContext);
  const posture = input.runtimePosture ?? postureClassification.posture;
  const warning = input.runtimeContext?.stalePlanWarning ?? postureClassification.warning;

  if (posture === "normal") {
    return { policy: "allow", reasonCodes: [] };
  }

  const reasonCodes: ExecutionPolicyReasonCode[] = [...postureClassification.reasonCodes];

  if (isHoldLikeCommand(input.command) && !aggressiveByAction) {
    return {
      policy: "allow",
      reasonCodes: [],
    };
  }

  if (aggressiveByAction || aggressiveByCommand) {
    return {
      policy: "suppress",
      reasonCodes,
      reason: warning ?? "Runtime guardrail suppressed aggressive command under conservative conditions.",
    };
  }

  return {
    policy: "allow",
    reasonCodes: [],
  };
}
