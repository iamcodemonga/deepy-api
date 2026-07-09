import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const ALLOWED_PATCH_FIELDS = [
  "firstname",
  "lastname",
  "nickname",
  "email",
  "phone",
  "bio",
  "notifications",
  "location",
  "lockup",
] as const;

type PatchField = (typeof ALLOWED_PATCH_FIELDS)[number];

async function emailTakenByOther(email: string, excludeEmail: string) {
  const { data } = await db
    .from("users")
    .select("email")
    .eq("email", email.toLowerCase())
    .neq("email", excludeEmail.toLowerCase())
    .maybeSingle();

  return !!data;
}

async function nicknameTakenByOther(nickname: string, excludeNickname: string) {
  const { data } = await db
    .from("users")
    .select("nickname")
    .eq("nickname", nickname.toLowerCase())
    .neq("nickname", excludeNickname.toLowerCase())
    .maybeSingle();

  return !!data;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await db
        .from("users")
        .select("*")
        .eq("id", auth.userId)
        .maybeSingle();

      if (error) {
        console.error("GET /users/me error:", error);
        return res.status(500).json({ error: "Failed to fetch profile" });
      }

      if (!data) {
        return res.status(404).json({ error: "Profile not found" });
      }

      return res.status(200).json(data);
    } catch (err) {
      console.error("GET /users/me error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = req.body ?? {};
      const update: Partial<Record<PatchField, unknown>> = {};

      for (const field of ALLOWED_PATCH_FIELDS) {
        if (field in body) {
          update[field] = body[field];
        }
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const { data: current, error: currentErr } = await db
        .from("users")
        .select("email, nickname")
        .eq("id", auth.userId)
        .maybeSingle();

      if (currentErr || !current) {
        return res.status(404).json({ error: "Profile not found" });
      }

      if (typeof update.email === "string") {
        const nextEmail = update.email.toLowerCase();
        if (await emailTakenByOther(nextEmail, current.email)) {
          return res.status(409).json({ error: "Email already taken" });
        }
        update.email = nextEmail;
      }

      if (typeof update.nickname === "string") {
        const nextNickname = update.nickname.toLowerCase();
        if (await nicknameTakenByOther(nextNickname, current.nickname)) {
          return res.status(409).json({ error: "Nickname already taken" });
        }
        update.nickname = nextNickname;
      }

      const { data, error } = await db
        .from("users")
        .update(update)
        .eq("id", auth.userId)
        .select("*")
        .single();

      if (error) {
        console.error("PATCH /users/me error:", error);
        return res.status(500).json({ error: "Failed to update profile" });
      }

      return res.status(200).json(data);
    } catch (err) {
      console.error("PATCH /users/me error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
