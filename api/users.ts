// api/users.ts — Vercel serverless function
// GET /api/users — returns the count of registered users. No personal data exposed.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

const KV_KEY = "aveum:users";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const count = await kv.llen(KV_KEY);
    return res.status(200).json({ registeredUsers: count });
  } catch (err: unknown) {
    return res.status(500).json({
      error: `Failed to read user count: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
