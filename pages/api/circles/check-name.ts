import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/src/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const name = String(req.query.name ?? "").trim();
  const exclude = String(req.query.exclude ?? "").trim();

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  try {
    let query = db
      .from("circles")
      .select("id")
      .eq("private", false)
      .ilike("name", name);

    if (exclude) {
      query = query.neq("id", exclude);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("check-name error:", error);
      return res.status(500).json({ error: "Failed to check circle name" });
    }

    return res.status(200).json({ exists: !!data });
  } catch (err) {
    console.error("check-name error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
