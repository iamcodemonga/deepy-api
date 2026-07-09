import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

type CreateUserBody = {
  firstname?: string;
  nickname?: string;
  email?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { firstname, nickname, email } = (req.body ?? {}) as CreateUserBody;

  if (!firstname?.trim() || !nickname?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "firstname, nickname, and email are required" });
  }

  try {
    const { data: existing, error: existingErr } = await db
      .from("users")
      .select("id")
      .eq("id", auth.userId)
      .maybeSingle();

    if (existingErr) {
      console.error("POST /users existing check error:", existingErr);
      return res.status(500).json({ error: "Failed to create profile" });
    }

    if (existing) {
      return res.status(409).json({ error: "Profile already exists" });
    }

    const { data, error } = await db
      .from("users")
      .insert({
        id: auth.userId,
        firstname: firstname.trim(),
        nickname: nickname.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
      })
      .select("*")
      .single();

    if (error) {
      console.error("POST /users insert error:", error);
      return res.status(500).json({ error: "Failed to create profile" });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("POST /users error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
