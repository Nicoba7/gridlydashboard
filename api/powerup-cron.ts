import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readStoredUsers, runPowerUpSweepForUsers } from "./cron";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const userConfigs = await readStoredUsers();
  const now = new Date();
  const sweep = await runPowerUpSweepForUsers(userConfigs, now);

  return res.status(200).json({
    ranAt: now.toISOString(),
    checkedUsers: sweep.checkedUsers,
    triggeredUsers: sweep.triggeredUsers,
    results: sweep.results,
  });
}
