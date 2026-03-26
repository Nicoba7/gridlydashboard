// api/user.ts — Vercel serverless function
// GET  /api/user?userId=...  — returns the stored user config (no passwords)
// PUT  /api/user             — updates departureTime, targetChargePct, notifyEmail

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";
import type { StoredUser } from "./register";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "aveum:users";

// Fields that PUT is allowed to update
interface UpdateableFields {
  departureTime?: string;   // HH:MM, e.g. "07:30"
  targetChargePct?: number; // 20–100
  notifyEmail?: string;
}

interface UpdateRequestBody extends UpdateableFields {
  userId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function readAllUsers(): Promise<StoredUser[]> {
  const raw = await redis.lrange<string>(KV_KEY, 0, -1);
  return raw.map((entry) => JSON.parse(entry) as StoredUser);
}

async function writeAllUsers(users: StoredUser[]): Promise<void> {
  const pipeline = redis.pipeline();
  pipeline.del(KV_KEY);
  // lpush in reverse so the list order (newest-first) is preserved
  for (const user of [...users].reverse()) {
    pipeline.lpush(KV_KEY, JSON.stringify(user));
  }
  await pipeline.exec();
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.userId as string | undefined;
    if (!userId?.trim()) {
      return res.status(400).json({ error: "userId query param is required" });
    }

    try {
      const users = await readAllUsers();
      const user = users.find((u) => u.userId === userId.trim());
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Return config without credentials
      const { ohmePassword: _ohmePassword, octopusApiKey: _octopusApiKey, ...safe } = user as StoredUser & {
        departureTime?: string;
        targetChargePct?: number;
      };
      return res.status(200).json({ user: safe });
    } catch (err: unknown) {
      return res.status(500).json({
        error: `Failed to read user: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    const body = req.body as UpdateRequestBody;

    if (!body?.userId?.trim()) {
      return res.status(400).json({ error: "userId is required" });
    }

    const updates: UpdateableFields = {};
    if (body.departureTime !== undefined) {
      const t = String(body.departureTime).trim();
      if (!/^\d{1,2}:\d{2}$/.test(t)) {
        return res.status(400).json({ error: "departureTime must be HH:MM" });
      }
      updates.departureTime = t;
    }
    if (body.targetChargePct !== undefined) {
      const pct = Number(body.targetChargePct);
      if (!Number.isFinite(pct) || pct < 20 || pct > 100) {
        return res.status(400).json({ error: "targetChargePct must be 20–100" });
      }
      updates.targetChargePct = pct;
    }
    if (body.notifyEmail !== undefined) {
      const email = String(body.notifyEmail).trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "notifyEmail is not a valid email" });
      }
      updates.notifyEmail = email || undefined;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    try {
      const users = await readAllUsers();
      const idx = users.findIndex((u) => u.userId === body.userId.trim());
      if (idx === -1) {
        return res.status(404).json({ error: "User not found" });
      }

      users[idx] = { ...users[idx], ...updates } as StoredUser;
      await writeAllUsers(users);

      return res.status(200).json({ success: true });
    } catch (err: unknown) {
      return res.status(500).json({
        error: `Failed to update user: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
