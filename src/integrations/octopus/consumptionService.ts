/**
 * Fetches half-hourly electricity consumption from the Octopus Energy API and
 * averages it into a 48-slot daily profile (one value per 30-minute slot,
 * indexed from midnight: slot 0 = 00:00–00:30, slot 47 = 23:30–00:00).
 *
 * Falls back to a representative UK household profile when no API key is
 * provided or when the fetch fails.
 */

const OCTOPUS_BASE = "https://api.octopus.energy/v1";
const LOOKBACK_DAYS = 30;
const SLOTS_PER_DAY = 48;

// ── Default profile ────────────────────────────────────────────────────────────
// Typical UK household half-hourly load in kWh (sums to ~10 kWh/day).
// Slots 0–47 map to 00:00–23:30 in 30-minute increments.
export const DEFAULT_UK_HOUSEHOLD_PROFILE: number[] = [
  // 00:00–02:00 (slots 0–3): low overnight load
  0.12, 0.11, 0.10, 0.10,
  // 02:00–04:00 (slots 4–7): lowest point
  0.09, 0.09, 0.09, 0.09,
  // 04:00–06:00 (slots 8–11): still quiet
  0.10, 0.10, 0.11, 0.12,
  // 06:00–08:00 (slots 12–15): morning ramp-up
  0.18, 0.28, 0.40, 0.42,
  // 08:00–10:00 (slots 16–19): post-breakfast plateau
  0.38, 0.32, 0.25, 0.22,
  // 10:00–12:00 (slots 20–23): mid-morning
  0.20, 0.20, 0.22, 0.23,
  // 12:00–14:00 (slots 24–27): lunch-time bump
  0.26, 0.28, 0.25, 0.22,
  // 14:00–16:00 (slots 28–31): afternoon dip
  0.20, 0.19, 0.19, 0.20,
  // 16:00–18:00 (slots 32–35): early evening ramp
  0.24, 0.32, 0.42, 0.46,
  // 18:00–20:00 (slots 36–39): evening peak
  0.46, 0.44, 0.40, 0.36,
  // 20:00–22:00 (slots 40–43): post-dinner wind-down
  0.30, 0.26, 0.22, 0.18,
  // 22:00–00:00 (slots 44–47): late evening
  0.16, 0.15, 0.14, 0.13,
];

// ── Octopus API response shapes ────────────────────────────────────────────────

interface OctopusConsumptionResult {
  interval_start: string;
  interval_end: string;
  consumption: number;
}

interface OctopusPagedResponse<T> {
  count?: number;
  next?: string | null;
  results?: T[];
}

interface OctopusMeter {
  serial_number: string;
}

interface OctopusMeterPoint {
  mpan: string;
  meters?: OctopusMeter[];
}

interface OctopusProperty {
  electricity_meter_points?: OctopusMeterPoint[];
}

interface OctopusAccountResponse {
  properties?: OctopusProperty[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function slotIndexFromIso(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 2 + Math.floor(d.getUTCMinutes() / 30);
}

// ── API fetchers ───────────────────────────────────────────────────────────────

async function fetchMpanAndSerial(
  apiKey: string,
  accountNumber: string,
): Promise<{ mpan: string; serial: string }> {
  const url = `${OCTOPUS_BASE}/accounts/${encodeURIComponent(accountNumber)}/`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader(apiKey) },
  });

  if (!response.ok) {
    throw new Error(`Octopus account lookup failed (${response.status})`);
  }

  const data = (await response.json()) as OctopusAccountResponse;
  const meterPoint = data.properties?.[0]?.electricity_meter_points?.[0];
  const mpan = meterPoint?.mpan;
  const serial = meterPoint?.meters?.[0]?.serial_number;

  if (!mpan || !serial) {
    throw new Error("No electricity meter found on Octopus account");
  }

  return { mpan, serial };
}

async function fetchConsumptionPage(
  apiKey: string,
  mpan: string,
  serial: string,
  periodFrom: string,
  periodTo: string,
  pageSize: number,
): Promise<OctopusConsumptionResult[]> {
  const params = new URLSearchParams({
    period_from: periodFrom,
    period_to: periodTo,
    page_size: String(pageSize),
    order_by: "period",
  });

  const url = `${OCTOPUS_BASE}/electricity-meter-points/${encodeURIComponent(mpan)}/meters/${encodeURIComponent(serial)}/consumption/?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: authHeader(apiKey) },
  });

  if (!response.ok) {
    throw new Error(`Octopus consumption fetch failed (${response.status})`);
  }

  const data = (await response.json()) as OctopusPagedResponse<OctopusConsumptionResult>;
  return data.results ?? [];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a 48-element array of kWh values representing the average half-hourly
 * household electricity consumption for a typical day, derived from the last 30
 * days of Octopus Energy smart-meter data.
 *
 * Falls back to `DEFAULT_UK_HOUSEHOLD_PROFILE` when:
 *  - `apiKey` or `accountNumber` is absent/empty
 *  - The Octopus API call fails for any reason
 *  - Fewer than 2 days of data are returned (not enough to average reliably)
 */
export async function getDailyConsumptionProfile(
  apiKey: string | undefined,
  accountNumber: string | undefined,
): Promise<number[]> {
  if (!apiKey || !accountNumber) {
    return DEFAULT_UK_HOUSEHOLD_PROFILE.slice();
  }

  try {
    const { mpan, serial } = await fetchMpanAndSerial(apiKey, accountNumber);

    const now = new Date();
    const periodTo = now.toISOString();
    const periodFrom = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Request up to 30 days × 48 slots = 1 440 records in one page.
    const results = await fetchConsumptionPage(
      apiKey,
      mpan,
      serial,
      periodFrom,
      periodTo,
      LOOKBACK_DAYS * SLOTS_PER_DAY,
    );

    if (results.length < SLOTS_PER_DAY * 2) {
      // Not enough data — fall back to default profile.
      return DEFAULT_UK_HOUSEHOLD_PROFILE.slice();
    }

    // Sum consumption values per time-of-day slot and track the count of days
    // that contributed a reading to each slot.
    const slotTotals = new Array<number>(SLOTS_PER_DAY).fill(0);
    const slotCounts = new Array<number>(SLOTS_PER_DAY).fill(0);

    for (const point of results) {
      if (
        typeof point.interval_start !== "string" ||
        typeof point.consumption !== "number" ||
        !Number.isFinite(point.consumption) ||
        point.consumption < 0
      ) {
        continue;
      }

      const slotIndex = slotIndexFromIso(point.interval_start);
      if (slotIndex >= 0 && slotIndex < SLOTS_PER_DAY) {
        slotTotals[slotIndex] += point.consumption;
        slotCounts[slotIndex] += 1;
      }
    }

    // Build the averaged profile; fall back to the default for any empty slot.
    return slotTotals.map((total, i) =>
      slotCounts[i] > 0
        ? Number((total / slotCounts[i]).toFixed(4))
        : DEFAULT_UK_HOUSEHOLD_PROFILE[i],
    );
  } catch {
    return DEFAULT_UK_HOUSEHOLD_PROFILE.slice();
  }
}
