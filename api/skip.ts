// api/skip.ts — persists a user's "skip tonight" request to Redis so
// api/cron.ts can honour it during the overnight optimisation run.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body as { userId?: string; date?: string } | undefined;
  const userId = body?.userId?.trim();
  const date = body?.date?.trim();

  if (!userId || !date) {
    return res.status(400).json({ error: "userId and date are required" });
  }

  // Validate date format to prevent key injection
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
  }

  const key = `aveum:skip:${userId}:${date}`;
  // TTL of 30 hours — expires well before the next day's cron runs
  await redis.set(key, "true", { ex: 30 * 60 * 60 });

  return res.status(200).json({ skipped: true });
}
