import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/src/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const inviteLink = String(req.query.invite_link ?? "").trim().toLowerCase();
  const exclude = String(req.query.exclude ?? "").trim().toLowerCase();

  if (!inviteLink) {
    return res.status(400).json({ error: "invite_link is required" });
  }

  try {
    let query = db.from("circles").select("invite_link").eq("invite_link", inviteLink);

    if (exclude) {
      query = query.neq("invite_link", exclude);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("check-invite-link error:", error);
      return res.status(500).json({ error: "Failed to check invite link" });
    }

    return res.status(200).json({ exists: !!data });
  } catch (err) {
    console.error("check-invite-link error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
