// api/register.ts — Vercel serverless function
// Accepts a POST with user config, pushes to Vercel KV, returns { success, userId }.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";
import * as crypto from "node:crypto";

const KV_KEY = "aveum:users";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RegisterRequestBody {
  userName: string;
  notifyEmail: string;
  octopusApiKey: string;
  octopusAccountNumber: string;
  region?: string;
  optimizationMode?: string;
  devices?: string[];
}

export interface StoredUser {
  userId: string;
  registeredAt: string;
  userName: string;
  notifyEmail: string;
  octopusApiKey: string;
  octopusAccountNumber: string;
  region: string;
  optimizationMode: string;
  devices: string[];
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body as RegisterRequestBody;

  if (!body?.userName?.trim()) {
    return res.status(400).json({ error: "userName is required" });
  }
  if (!body?.notifyEmail?.trim()) {
    return res.status(400).json({ error: "notifyEmail is required" });
  }
  if (!body?.octopusApiKey?.trim()) {
    return res.status(400).json({ error: "octopusApiKey is required" });
  }
  if (!body?.octopusAccountNumber?.trim()) {
    return res.status(400).json({ error: "octopusAccountNumber is required" });
  }

  const userId = crypto.randomUUID();
  const newUser: StoredUser = {
    userId,
    registeredAt: new Date().toISOString(),
    userName: body.userName.trim(),
    notifyEmail: body.notifyEmail.trim(),
    octopusApiKey: body.octopusApiKey.trim(),
    octopusAccountNumber: body.octopusAccountNumber.trim(),
    region: body.region?.trim() || "C",
    optimizationMode: body.optimizationMode?.trim() || "balanced",
    devices: Array.isArray(body.devices) ? body.devices : [],
  };

  try {
    await kv.lpush(KV_KEY, JSON.stringify(newUser));
  } catch (err: unknown) {
    return res.status(500).json({
      error: `Failed to save user: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return res.status(201).json({ success: true, userId });
}
