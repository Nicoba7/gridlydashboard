const POWER_UP_PATTERN = /(power\s*up|saving\s*session)/i;

export interface OctopusPowerUpEvent {
  name: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
  isUpcoming: boolean;
}

export interface DetectOctopusPowerUpInput {
  apiKey: string;
  accountNumber: string;
  now?: Date;
  lookaheadHours?: number;
}

export interface DetectOctopusPowerUpResult {
  events: OctopusPowerUpEvent[];
  activeOrUpcomingEvents: OctopusPowerUpEvent[];
  overnightEvents: OctopusPowerUpEvent[];
  overnightChargedKwhEstimate: number;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function pickFirstDateValue(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) {
      return value;
    }
  }

  return null;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function extractCandidateEvents(payload: unknown): Array<{ name: string; startAt: string; endAt: string }> {
  const extracted: Array<{ name: string; startAt: string; endAt: string }> = [];

  function visit(node: unknown): void {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    const name = pickFirstString(record, ["name", "title", "event_name", "type", "label"]);
    const startAt = pickFirstDateValue(record, ["start_at", "startAt", "start", "valid_from", "from", "starts_at"]);
    const endAt = pickFirstDateValue(record, ["end_at", "endAt", "end", "valid_to", "to", "ends_at"]);

    if (name && startAt && endAt && POWER_UP_PATTERN.test(name)) {
      extracted.push({ name, startAt, endAt });
    }

    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) {
        visit(value);
      }
    }
  }

  visit(payload);
  return extracted;
}

function dedupeEvents(events: Array<{ name: string; startAt: string; endAt: string }>) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.name}|${event.startAt}|${event.endAt}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function estimateChargedKwhForEvent(startAt: string, endAt: string, maxChargeKw = 8.2): number {
  const durationMs = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  const durationHours = durationMs / (60 * 60 * 1000);
  return Number((durationHours * maxChargeKw).toFixed(1));
}

export async function detectOctopusPowerUpEvents(
  input: DetectOctopusPowerUpInput,
): Promise<DetectOctopusPowerUpResult> {
  const now = input.now ?? new Date();
  const lookaheadHours = input.lookaheadHours ?? 6;
  const lookaheadMs = lookaheadHours * 60 * 60 * 1000;

  const endpoint = `https://api.octopus.energy/v1/accounts/${encodeURIComponent(input.accountNumber)}/`;
  const response = await fetch(endpoint, {
    headers: { Authorization: authHeader(input.apiKey) },
  });

  if (!response.ok) {
    throw new Error(`Octopus account fetch failed (${response.status})`);
  }

  const payload = await response.json();
  const candidates = dedupeEvents(extractCandidateEvents(payload));

  const events: OctopusPowerUpEvent[] = candidates
    .map((candidate) => {
      const startMs = new Date(candidate.startAt).getTime();
      const endMs = new Date(candidate.endAt).getTime();
      const nowMs = now.getTime();
      const isActive = nowMs >= startMs && nowMs < endMs;
      const isUpcoming = startMs >= nowMs && startMs <= nowMs + lookaheadMs;

      return {
        name: candidate.name,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        isActive,
        isUpcoming,
      };
    })
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());

  const activeOrUpcomingEvents = events.filter((event) => event.isActive || event.isUpcoming);

  const overnightStart = new Date(now);
  overnightStart.setUTCHours(0, 0, 0, 0);
  overnightStart.setUTCDate(overnightStart.getUTCDate() - 1);
  const overnightEnd = new Date(now);
  overnightEnd.setUTCHours(6, 0, 0, 0);

  const overnightEvents = events.filter((event) => {
    const start = new Date(event.startAt).getTime();
    const end = new Date(event.endAt).getTime();
    return end > overnightStart.getTime() && start < overnightEnd.getTime();
  });

  const overnightChargedKwhEstimate = Number(
    overnightEvents
      .reduce((sum, event) => sum + estimateChargedKwhForEvent(event.startAt, event.endAt), 0)
      .toFixed(1),
  );

  return {
    events,
    activeOrUpcomingEvents,
    overnightEvents,
    overnightChargedKwhEstimate,
  };
}

export function formatPowerUpAlertMessage(event: OctopusPowerUpEvent): string {
  const start = new Date(event.startAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const end = new Date(event.endAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `🎉 Free electricity detected! Aveum is charging everything now — ${start}-${end} today.`;
}
