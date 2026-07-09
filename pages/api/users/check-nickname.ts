import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/src/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const nickname = String(req.query.nickname ?? "").trim().toLowerCase();
  const exclude = String(req.query.exclude ?? "").trim().toLowerCase();

  if (!nickname) {
    return res.status(400).json({ error: "nickname is required" });
  }

  try {
    let query = db.from("users").select("nickname").eq("nickname", nickname);

    if (exclude) {
      query = query.neq("nickname", exclude);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("check-nickname error:", error);
      return res.status(500).json({ error: "Failed to check nickname" });
    }

    return res.status(200).json({ exists: !!data });
  } catch (err) {
    console.error("check-nickname error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
