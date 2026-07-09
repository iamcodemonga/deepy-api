import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/src/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = String(req.query.email ?? "").trim().toLowerCase();
  const exclude = String(req.query.exclude ?? "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    let query = db.from("users").select("email").eq("email", email);

    if (exclude) {
      query = query.neq("email", exclude);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("check-email error:", error);
      return res.status(500).json({ error: "Failed to check email" });
    }

    return res.status(200).json({ exists: !!data });
  } catch (err) {
    console.error("check-email error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
