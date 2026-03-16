import {
  createLegacySandboxSnapshot,
  getCanonicalSimulationSnapshot,
  type LegacySandboxData,
} from "../simulator";

/**
 * Legacy compatibility export.
 *
 * Existing dashboard code still expects a monolithic SANDBOX object. This now
 * comes from the canonical simulator instead of a hand-maintained fixture.
 */
export function getSandboxSnapshot(now: Date = new Date()): LegacySandboxData {
  return createLegacySandboxSnapshot(now);
}

export function getSandboxCanonicalSnapshot(now: Date = new Date()) {
  return getCanonicalSimulationSnapshot(now);
}

export const SANDBOX = getSandboxSnapshot();
