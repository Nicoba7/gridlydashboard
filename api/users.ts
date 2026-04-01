// api/users.ts — consolidated user management endpoint
//
// Routes:
//   POST   /api/users                  → register a new user
//   POST   /api/users?action=waitlist  → add email to early-access waitlist
//   GET    /api/users?userId=<id>      → get user config (no passwords)
//   GET    /api/users?action=count     → count of registered users
//   PUT    /api/users                  → update user fields
//
// Replaces: api/register.ts, api/user.ts, api/waitlist.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";
import * as crypto from "node:crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const KV_KEY = "aveum:users";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RegisterRequestBody {
  userName: string;
  notifyEmail: string;
  octopusApiKey?: string;
  octopusAccountNumber?: string;
  region?: string;
  optimizationMode?: string;
  devices?: string[];
  ohmeEmail?: string;
  ohmePassword?: string;
  departureTime?: string;
  targetSocPercent?: number;
}

export interface StoredUser {
  userId: string;
  registeredAt: string;
  userName: string;
  notifyEmail: string;
  octopusApiKey?: string;
  octopusAccountNumber?: string;
  region: string;
  optimizationMode: string;
  devices: string[];
  ohmeEmail?: string;
  ohmePassword?: string;
  departureTime?: string;
  targetSocPercent?: number;
}

interface UpdateableFields {
  departureTime?: string;
  targetChargePct?: number;
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
  for (const user of [...users].reverse()) {
    pipeline.lpush(KV_KEY, JSON.stringify(user));
  }
  await pipeline.exec();
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query.action as string | undefined;

  // ── POST /api/users?action=waitlist ────────────────────────────────────────
  if (req.method === "POST" && action === "waitlist") {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await redis.lpush("aveum:waitlist", normalizedEmail);
      return res.status(200).json({ success: true });
    } catch (err: unknown) {
      console.error("Failed to write waitlist email to Redis", {
        email: normalizedEmail,
        error: err,
      });
      return res.status(500).json({ error: "Failed to save waitlist email" });
    }
  }

  // ── POST /api/users  (register) ────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body as RegisterRequestBody;
    if (!body?.userName?.trim()) return res.status(400).json({ error: "userName is required" });
    if (!body?.notifyEmail?.trim()) return res.status(400).json({ error: "notifyEmail is required" });

    const userId = crypto.randomUUID();
    const newUser: StoredUser = {
      userId,
      registeredAt: new Date().toISOString(),
      userName: body.userName.trim(),
      notifyEmail: body.notifyEmail.trim(),
      ...(body.octopusApiKey?.trim() && { octopusApiKey: body.octopusApiKey.trim() }),
      ...(body.octopusAccountNumber?.trim() && { octopusAccountNumber: body.octopusAccountNumber.trim() }),
      region: body.region?.trim() || "C",
      optimizationMode: body.optimizationMode?.trim() || "balanced",
      devices: Array.isArray(body.devices) ? body.devices : [],
      ...(body.ohmeEmail?.trim() && { ohmeEmail: body.ohmeEmail.trim() }),
      ...(body.ohmePassword?.trim() && { ohmePassword: body.ohmePassword.trim() }),
      ...(body.departureTime?.trim() && { departureTime: body.departureTime.trim() }),
      ...(body.targetSocPercent != null && { targetSocPercent: Number(body.targetSocPercent) }),
    };

    try {
      await redis.lpush(KV_KEY, JSON.stringify(newUser));
    } catch (err: unknown) {
      return res.status(500).json({
        error: `Failed to save user: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return res.status(201).json({ success: true, userId });
  }

  // ── GET /api/users?action=count ────────────────────────────────────────────
  if (req.method === "GET" && action === "count") {
    try {
      const count = await redis.llen(KV_KEY);
      return res.status(200).json({ registeredUsers: count });
    } catch (err: unknown) {
      return res.status(500).json({
        error: `Failed to read user count: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── GET /api/users?userId=<id> ─────────────────────────────────────────────
  if (req.method === "GET") {
    const userId = req.query.userId as string | undefined;
    if (!userId?.trim()) {
      return res.status(400).json({ error: "userId query param is required" });
    }
    try {
      const users = await readAllUsers();
      const user = users.find((u) => u.userId === userId.trim());
      if (!user) return res.status(404).json({ error: "User not found" });
      const { ohmePassword: _p, octopusApiKey: _k, ...safe } = user as any;
      return res.status(200).json({ user: safe });
    } catch (err: unknown) {
      return res.status(500).json({
        error: `Failed to read user: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── PUT /api/users  (update user fields) ───────────────────────────────────
  if (req.method === "PUT") {
    const body = req.body as UpdateRequestBody;
    if (!body?.userId?.trim()) return res.status(400).json({ error: "userId is required" });

    const updates: UpdateableFields = {};
    if (body.departureTime !== undefined) {
      const t = String(body.departureTime).trim();
      if (!/^\d{1,2}:\d{2}$/.test(t)) return res.status(400).json({ error: "departureTime must be HH:MM" });
      updates.departureTime = t;
    }
    if (body.targetChargePct !== undefined) {
      const pct = Number(body.targetChargePct);
      if (!Number.isFinite(pct) || pct < 20 || pct > 100)
        return res.status(400).json({ error: "targetChargePct must be 20–100" });
      updates.targetChargePct = pct;
    }
    if (body.notifyEmail !== undefined) {
      const email = String(body.notifyEmail).trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: "notifyEmail is not a valid email" });
      updates.notifyEmail = email || undefined;
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: "No valid fields to update" });

    try {
      const users = await readAllUsers();
      const idx = users.findIndex((u) => u.userId === body.userId.trim());
      if (idx === -1) return res.status(404).json({ error: "User not found" });
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
