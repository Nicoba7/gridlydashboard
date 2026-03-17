import type { CanonicalDeviceCommand } from "../../application/controlLoopExecution/canonicalCommand";
import type {
  DeviceAdapterExecutionContext,
  DeviceAdapterExecutionResult,
  ObservableDeviceAdapter,
} from "../../adapters/deviceAdapter";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface OctopusRateResult {
  valid_from?: string;
  valid_to?: string;
  value_inc_vat?: number;
}

interface OctopusConsumptionResult {
  interval_start?: string;
  interval_end?: string;
  consumption?: number;
}

interface OctopusPagedResponse<T> {
  results?: T[];
}

export interface OctopusAdapterConfig {
  importRatesUrl: string;
  exportRatesUrl?: string;
  importMeterUrl?: string;
  exportMeterUrl?: string;
  fetchFn?: FetchLike;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface TariffPricePoint {
  startAt: string;
  endAt: string;
  unitRatePencePerKwh: number;
  source: "live" | "forecast";
}

export interface TariffProviderTelemetry {
  import_price: TariffPricePoint[];
  export_price: TariffPricePoint[];
  forecast_prices: TariffPricePoint[];
}

export interface HouseholdMeterTelemetry {
  import_power?: number;
  export_power?: number;
  cumulative_import?: number;
  cumulative_export?: number;
  sampleStartAt?: string;
  sampleEndAt?: string;
}

export interface OctopusAdapterTelemetry {
  tariffProvider: TariffProviderTelemetry;
  householdMeter: HouseholdMeterTelemetry;
  capturedAt: string;
  warnings: string[];
}

export interface OctopusAdapterState {
  provider: "Octopus";
  connectionStatus: "online" | "degraded";
  lastUpdatedAt: string;
  warnings: string[];
}

export interface OctopusAdapterCapabilities {
  TariffProvider: ["import_price", "export_price", "forecast_prices"];
  HouseholdMeter: ["import_power", "export_power", "cumulative_import", "cumulative_export"];
}

const CAPABILITIES: OctopusAdapterCapabilities = {
  TariffProvider: ["import_price", "export_price", "forecast_prices"],
  HouseholdMeter: ["import_power", "export_power", "cumulative_import", "cumulative_export"],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  url: string,
  fetchFn: FetchLike,
  attempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        throw new Error(`Octopus request failed (${response.status})`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await delay(baseDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Octopus request failed.");
}

function normalizePrices(results: OctopusRateResult[] | undefined): TariffPricePoint[] {
  return (results ?? [])
    .filter((item) => item.valid_from && item.valid_to && Number.isFinite(item.value_inc_vat))
    .sort((a, b) => new Date(a.valid_from!).getTime() - new Date(b.valid_from!).getTime())
    .map((item) => ({
      startAt: item.valid_from!,
      endAt: item.valid_to!,
      unitRatePencePerKwh: Number(item.value_inc_vat),
      source: "live",
    }));
}

function toAveragePowerW(kwh: number, startAt: string, endAt: string): number | undefined {
  const durationHours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / (1000 * 60 * 60);
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return undefined;
  }

  return Math.round((kwh / durationHours) * 1000);
}

function normalizeMeter(results: OctopusConsumptionResult[] | undefined): HouseholdMeterTelemetry {
  const valid = (results ?? [])
    .filter((item) => item.interval_start && item.interval_end && Number.isFinite(item.consumption))
    .sort((a, b) => new Date(b.interval_start!).getTime() - new Date(a.interval_start!).getTime());

  if (valid.length === 0) {
    return {};
  }

  const latest = valid[0];
  const cumulative = valid.reduce((sum, item) => sum + Number(item.consumption ?? 0), 0);

  return {
    import_power: toAveragePowerW(Number(latest.consumption), latest.interval_start!, latest.interval_end!),
    cumulative_import: Number(cumulative.toFixed(3)),
    sampleStartAt: latest.interval_start,
    sampleEndAt: latest.interval_end,
  };
}

export class OctopusAdapter implements ObservableDeviceAdapter<
  OctopusAdapterTelemetry,
  OctopusAdapterState,
  OctopusAdapterCapabilities
> {
  private readonly fetchFn: FetchLike;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private lastTelemetry?: OctopusAdapterTelemetry;

  constructor(private readonly config: OctopusAdapterConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.retryAttempts = Math.max(1, config.retryAttempts ?? 3);
    this.retryBaseDelayMs = Math.max(1, config.retryBaseDelayMs ?? 75);
  }

  canHandle(targetDeviceId: string): boolean {
    return targetDeviceId === "household-meter" || targetDeviceId === "tariff-provider";
  }

  getCapabilities(): OctopusAdapterCapabilities {
    return CAPABILITIES;
  }

  async getTelemetry(): Promise<OctopusAdapterTelemetry> {
    const warnings: string[] = [];

    const importPricePayload = await fetchWithRetry<OctopusPagedResponse<OctopusRateResult>>(
      this.config.importRatesUrl,
      this.fetchFn,
      this.retryAttempts,
      this.retryBaseDelayMs,
    );

    const importPrices = normalizePrices(importPricePayload.results);
    if (importPrices.length === 0) {
      warnings.push("Missing or invalid import price slots from Octopus response.");
    }

    let exportPrices: TariffPricePoint[] = [];
    if (this.config.exportRatesUrl) {
      try {
        const exportPricePayload = await fetchWithRetry<OctopusPagedResponse<OctopusRateResult>>(
          this.config.exportRatesUrl,
          this.fetchFn,
          this.retryAttempts,
          this.retryBaseDelayMs,
        );
        exportPrices = normalizePrices(exportPricePayload.results);
      } catch {
        warnings.push("Export price fetch failed; continuing without export price slots.");
      }
    }

    let importMeter = {} as HouseholdMeterTelemetry;
    if (this.config.importMeterUrl) {
      try {
        const importMeterPayload = await fetchWithRetry<OctopusPagedResponse<OctopusConsumptionResult>>(
          this.config.importMeterUrl,
          this.fetchFn,
          this.retryAttempts,
          this.retryBaseDelayMs,
        );
        importMeter = normalizeMeter(importMeterPayload.results);
      } catch {
        warnings.push("Import meter fetch failed; using empty import telemetry.");
      }
    }

    let exportMeter = {} as HouseholdMeterTelemetry;
    if (this.config.exportMeterUrl) {
      try {
        const exportMeterPayload = await fetchWithRetry<OctopusPagedResponse<OctopusConsumptionResult>>(
          this.config.exportMeterUrl,
          this.fetchFn,
          this.retryAttempts,
          this.retryBaseDelayMs,
        );
        const normalized = normalizeMeter(exportMeterPayload.results);
        exportMeter = {
          export_power: normalized.import_power,
          cumulative_export: normalized.cumulative_import,
        };
      } catch {
        warnings.push("Export meter fetch failed; using empty export telemetry.");
      }
    }

    const telemetry: OctopusAdapterTelemetry = {
      tariffProvider: {
        import_price: importPrices,
        export_price: exportPrices,
        forecast_prices: importPrices,
      },
      householdMeter: {
        import_power: importMeter.import_power,
        export_power: exportMeter.export_power,
        cumulative_import: importMeter.cumulative_import,
        cumulative_export: exportMeter.cumulative_export,
        sampleStartAt: importMeter.sampleStartAt,
        sampleEndAt: importMeter.sampleEndAt,
      },
      capturedAt: new Date().toISOString(),
      warnings,
    };

    this.lastTelemetry = telemetry;
    return telemetry;
  }

  async getState(): Promise<OctopusAdapterState> {
    if (!this.lastTelemetry) {
      await this.getTelemetry();
    }

    return {
      provider: "Octopus",
      connectionStatus: (this.lastTelemetry?.warnings.length ?? 0) > 0 ? "degraded" : "online",
      lastUpdatedAt: this.lastTelemetry?.capturedAt ?? new Date().toISOString(),
      warnings: this.lastTelemetry?.warnings ?? [],
    };
  }

  async executeCanonicalCommand(
    command: CanonicalDeviceCommand,
    _context?: DeviceAdapterExecutionContext,
  ): Promise<DeviceAdapterExecutionResult> {
    return {
      targetDeviceId: command.targetDeviceId,
      status: "rejected",
      canonicalCommand: command,
      failureReasonCode: "INVALID_COMMAND",
      message: "Octopus integration is telemetry-only and cannot execute canonical commands.",
    };
  }
}
