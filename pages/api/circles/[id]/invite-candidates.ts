import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const INVITER_ROLES = new Set(["owner", "partner"]);
const MIN_QUERY_LENGTH = 2;

type UserRow = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  nickname: string | null;
  email: string;
  avatar: string | null;
};

async function getRequesterRole(userId: string, circleId: string): Promise<string | null> {
  const { data, error } = await db
    .from("members")
    .select("role")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data.role;
}

function sanitizeSearchQuery(query: string): string {
  return query.trim().replace(/,/g, " ");
}

function normalizeUser(user: UserRow) {
  return {
    id: user.id,
    firstname: user.firstname,
    lastname: user.lastname,
    nickname: user.nickname?.trim() || user.email,
    email: user.email,
    avatar: user.avatar,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const circleId = String(req.query.id ?? "").trim();
  const search = sanitizeSearchQuery(String(req.query.q ?? ""));

  if (!circleId) {
    return res.status(400).json({ error: "Circle id is required" });
  }

  if (search.length < MIN_QUERY_LENGTH) {
    return res.status(200).json([]);
  }

  try {
    const requesterRole = await getRequesterRole(auth.userId, circleId);
    if (!requesterRole || !INVITER_ROLES.has(requesterRole)) {
      return res.status(403).json({ error: "Not authorized to invite members" });
    }

    const { data: members, error: membersErr } = await db
      .from("members")
      .select("user_id")
      .eq("circle_id", circleId);

    if (membersErr) {
      console.error("GET /circles/[id]/invite-candidates members error:", membersErr);
      return res.status(500).json({ error: "Failed to search users" });
    }

    const { data: pendingInvites, error: invitesErr } = await db
      .from("invites")
      .select("invitee_id")
      .eq("circle_id", circleId)
      .eq("status", "pending");

    if (invitesErr) {
      console.error("GET /circles/[id]/invite-candidates invites error:", invitesErr);
      return res.status(500).json({ error: "Failed to search users" });
    }

    const excludedUserIds = new Set<string>([auth.userId]);
    for (const member of members ?? []) excludedUserIds.add(member.user_id);
    for (const invite of pendingInvites ?? []) excludedUserIds.add(invite.invitee_id);

    const pattern = `%${search}%`;
    let query = db
      .from("users")
      .select("id, firstname, lastname, nickname, email, avatar")
      .or(
        [
          `firstname.ilike.${pattern}`,
          `lastname.ilike.${pattern}`,
          `nickname.ilike.${pattern}`,
          `email.ilike.${pattern}`,
        ].join(",")
      )
      .order("nickname", { ascending: true })
      .limit(25);

    const excluded = Array.from(excludedUserIds);
    if (excluded.length > 0) {
      query = query.not("id", "in", `(${excluded.join(",")})`);
    }

    const { data: users, error: usersErr } = await query;

    if (usersErr) {
      console.error("GET /circles/[id]/invite-candidates users error:", usersErr);
      return res.status(500).json({ error: "Failed to search users" });
    }

    return res.status(200).json(((users ?? []) as UserRow[]).map(normalizeUser));
  } catch (err) {
    console.error("GET /circles/[id]/invite-candidates error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
