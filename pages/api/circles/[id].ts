import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

type UpdateCircleBody = {
  name?: string;
  description?: string | null;
};

async function canEditCircle(userId: string, circleId: string): Promise<boolean> {
  const { data: circle, error: circleErr } = await db
    .from("circles")
    .select("creator_id")
    .eq("id", circleId)
    .maybeSingle();

  if (circleErr || !circle) return false;

  if (circle.creator_id === userId) return true;

  const { data: member, error: memberErr } = await db
    .from("members")
    .select("role")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr || !member) return false;

  return member.role === "owner" || member.role === "partner";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const circleId = String(req.query.id ?? "").trim();
  if (!circleId) {
    return res.status(400).json({ error: "Circle id is required" });
  }

  const body = (req.body ?? {}) as UpdateCircleBody;

  if (!("name" in body)) {
    return res.status(400).json({ error: "name is required" });
  }

  const trimmedName = body.name?.trim() ?? "";
  if (!trimmedName) {
    return res.status(400).json({ error: "name is required" });
  }

  const trimmedDescription =
    body.description === undefined || body.description === null
      ? null
      : String(body.description).trim() || null;

  try {
    const allowed = await canEditCircle(auth.userId, circleId);
    if (!allowed) {
      return res.status(403).json({ error: "Not authorized to update this circle" });
    }

    const { data: current, error: currentErr } = await db
      .from("circles")
      .select("id, private, name")
      .eq("id", circleId)
      .maybeSingle();

    if (currentErr || !current) {
      return res.status(404).json({ error: "Circle not found" });
    }

    const nameChanged =
      trimmedName.localeCompare(current.name, undefined, { sensitivity: "accent" }) !== 0;

    if (!current.private && nameChanged) {
      const { data: existing, error: existingErr } = await db
        .from("circles")
        .select("id")
        .eq("private", false)
        .ilike("name", trimmedName)
        .neq("id", circleId)
        .maybeSingle();

      if (existingErr) {
        console.error("PATCH /circles/[id] name check error:", existingErr);
        return res.status(500).json({ error: "Failed to update circle" });
      }

      if (existing) {
        return res.status(409).json({ error: "Circle name already taken" });
      }
    }

    const { data: circle, error: updateErr } = await db
      .from("circles")
      .update({
        name: trimmedName,
        description: trimmedDescription,
      })
      .eq("id", circleId)
      .select("*")
      .single();

    if (updateErr || !circle) {
      console.error("PATCH /circles/[id] update error:", updateErr);
      return res.status(500).json({ error: "Failed to update circle" });
    }

    return res.status(200).json(circle);
  } catch (err) {
    console.error("PATCH /circles/[id] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
