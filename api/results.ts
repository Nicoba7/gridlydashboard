// api/results.ts — Vercel serverless function
// GET /api/results?userId=... — returns stored daily result objects for a user

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DailyResult {
  date: string;                     // ISO date YYYY-MM-DD
  savedTodayPence: number;
  earnedFromExportPence: number;
  netCostPence: number;
  oneLiner: string;
  evTargetAchieved: boolean | null;
  cheapestSlotTime: string | null;   // "HH:MM"
  cheapestSlotPence: number | null;
  peakAvoidedTime: string | null;    // "HH:MM" battery discharged
  peakAvoidedPence: number | null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = req.query.userId as string | undefined;
  if (!userId?.trim()) {
    return res.status(400).json({ error: "userId query param is required" });
  }

  try {
    const key = `aveum:results:${userId.trim()}`;
    const raw = await redis.lrange<string>(key, 0, 29); // last 30 results
    const results: DailyResult[] = raw.map((entry) =>
      typeof entry === "string" ? JSON.parse(entry) : entry
    );
    return res.status(200).json({ results });
  } catch (err: unknown) {
    return res.status(500).json({
      error: `Failed to read results: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
