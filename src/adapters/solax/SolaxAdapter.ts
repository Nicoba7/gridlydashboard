export type SolaxCapability =
  | "read_soc"
  | "read_power"
  | "schedule_window"
  | "divert_solar";

/**
 * Placeholder Solax adapter surface for capability discovery.
 *
 * This repo currently does not ship a full Solax integration client, but the
 * canonical capability contract includes solar divert support for parity with
 * other solar-capable adapters.
 */
export class SolaxAdapter {
  readonly adapterId = "solax-adapter.v1";

  readonly capabilities: SolaxCapability[] = [
    "read_soc",
    "read_power",
    "schedule_window",
    "divert_solar",
  ];
}
