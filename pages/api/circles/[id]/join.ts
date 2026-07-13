import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const JOIN_ROLE = "audience" as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
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

  try {
    const { data: circle, error: circleErr } = await db
      .from("circles")
      .select("id, creator_id, private")
      .eq("id", circleId)
      .maybeSingle();

    if (circleErr) {
      console.error("POST /circles/[id]/join circle error:", circleErr);
      return res.status(500).json({ error: "Failed to join circle" });
    }

    if (!circle) {
      return res.status(404).json({ error: "Circle not found" });
    }

    if (circle.private) {
      return res.status(403).json({ error: "Private circles require an invite" });
    }

    if (circle.creator_id === auth.userId) {
      return res.status(409).json({ error: "You already own this circle" });
    }

    const { data: existingMember, error: memberErr } = await db
      .from("members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (memberErr) {
      console.error("POST /circles/[id]/join member check error:", memberErr);
      return res.status(500).json({ error: "Failed to join circle" });
    }

    if (existingMember) {
      return res.status(409).json({ error: "You are already a member of this circle" });
    }

    const { data: pendingInvite, error: inviteErr } = await db
      .from("invites")
      .select("id")
      .eq("circle_id", circleId)
      .eq("invitee_id", auth.userId)
      .eq("status", "pending")
      .maybeSingle();

    if (inviteErr) {
      console.error("POST /circles/[id]/join invite check error:", inviteErr);
      return res.status(500).json({ error: "Failed to join circle" });
    }

    if (pendingInvite) {
      return res.status(409).json({ error: "You already have a pending invite" });
    }

    const { error: insertErr } = await db.from("members").insert({
      circle_id: circleId,
      user_id: auth.userId,
      role: JOIN_ROLE,
    });

    if (insertErr) {
      console.error("POST /circles/[id]/join insert error:", insertErr);
      return res.status(500).json({ error: "Failed to join circle" });
    }

    return res.status(201).json({
      circleId,
      role: JOIN_ROLE,
    });
  } catch (err) {
    console.error("POST /circles/[id]/join error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
