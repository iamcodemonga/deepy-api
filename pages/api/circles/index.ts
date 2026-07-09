import type { NextApiRequest, NextApiResponse } from "next";
import cloudinary from "@/src/lib/cloudinary";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const LINK_REGEX = /^[a-z0-9_-]+$/;

type CreateCircleBody = {
  name?: string;
  invite_link?: string;
  description?: string;
  banner?: string;
  banner_public_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { name, invite_link, description, banner, banner_public_id } =
    (req.body ?? {}) as CreateCircleBody;

  const trimmedName = name?.trim() ?? "";
  const normalizedLink = invite_link?.trim().toLowerCase() ?? "";

  if (!trimmedName) {
    return res.status(400).json({ error: "name is required" });
  }

  if (!normalizedLink) {
    return res.status(400).json({ error: "invite_link is required" });
  }

  if (!LINK_REGEX.test(normalizedLink)) {
    return res.status(400).json({
      error: "invite_link must use letters, numbers, hyphens, or underscores",
    });
  }

  try {
    const { data: existing, error: existingErr } = await db
      .from("circles")
      .select("invite_link")
      .eq("invite_link", normalizedLink)
      .maybeSingle();

    if (existingErr) {
      console.error("POST /circles invite_link check error:", existingErr);
      return res.status(500).json({ error: "Failed to create circle" });
    }

    if (existing) {
      return res.status(409).json({ error: "Invite link already taken" });
    }

    const insertPayload: Record<string, unknown> = {
      name: trimmedName,
      invite_link: normalizedLink,
      creator_id: auth.userId,
      private: false,
    };

    const trimmedDescription = description?.trim();
    if (trimmedDescription) {
      insertPayload.description = trimmedDescription;
    }

    const trimmedBanner = banner?.trim();
    if (trimmedBanner) {
      insertPayload.banner = trimmedBanner;
    }

    const { data: circle, error: insertErr } = await db
      .from("circles")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !circle) {
      console.error("POST /circles insert error:", insertErr);

      if (banner_public_id) {
        try {
          await cloudinary.uploader.destroy(banner_public_id);
        } catch (rollbackErr) {
          console.error("Cloudinary rollback failed:", rollbackErr);
        }
      }

      return res.status(500).json({ error: "Failed to create circle" });
    }

    const { error: memberErr } = await db.from("members").insert({
      user_id: auth.userId,
      circle_id: circle.id,
      role: "owner",
    });

    if (memberErr) {
      console.error("POST /circles members insert error:", memberErr);

      await db.from("circles").delete().eq("id", circle.id);

      if (banner_public_id) {
        try {
          await cloudinary.uploader.destroy(banner_public_id);
        } catch (rollbackErr) {
          console.error("Cloudinary rollback failed:", rollbackErr);
        }
      }

      return res.status(500).json({ error: "Failed to create circle membership" });
    }

    return res.status(201).json(circle);
  } catch (err) {
    console.error("POST /circles error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
