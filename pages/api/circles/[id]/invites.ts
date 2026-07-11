import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const INVITER_ROLES = new Set(["owner", "partner"]);
const INVITE_ROLE = "partner" as const;
const INVITE_STATUS = "pending" as const;

type InviteRow = {
  id: string;
  invitee_id: string | null;
};

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

function normalizeUser(user: UserRow, inviteId: string) {
  return {
    id: user.id,
    inviteId,
    firstname: user.firstname,
    lastname: user.lastname,
    nickname: user.nickname?.trim() || user.email,
    email: user.email,
    avatar: user.avatar,
    inviteStatus: INVITE_STATUS,
  };
}

async function listPendingInvites(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const circleId = String(req.query.id ?? "").trim();

  if (!circleId) {
    return res.status(400).json({ error: "Circle id is required" });
  }

  try {
    const requesterRole = await getRequesterRole(auth.userId, circleId);
    if (!requesterRole || !INVITER_ROLES.has(requesterRole)) {
      return res.status(403).json({ error: "Not authorized to view invitations" });
    }

    const { data: invites, error: invitesErr } = await db
      .from("invites")
      .select("id, invitee_id")
      .eq("circle_id", circleId)
      .eq("status", INVITE_STATUS)
      .order("invited_at", { ascending: false });

    if (invitesErr) {
      console.error("GET /circles/[id]/invites list error:", invitesErr);
      return res.status(500).json({ error: "Failed to load invitations" });
    }

    const pendingInvites = (invites ?? []) as InviteRow[];
    const inviteeIds = Array.from(
      new Set(
        pendingInvites
          .map((invite) => invite.invitee_id)
          .filter((inviteeId): inviteeId is string => Boolean(inviteeId))
      )
    );

    if (inviteeIds.length === 0) {
      return res.status(200).json([]);
    }

    const { data: users, error: usersErr } = await db
      .from("users")
      .select("id, firstname, lastname, nickname, email, avatar")
      .in("id", inviteeIds);

    if (usersErr) {
      console.error("GET /circles/[id]/invites users error:", usersErr);
      return res.status(500).json({ error: "Failed to load invitations" });
    }

    const usersById = new Map(((users ?? []) as UserRow[]).map((user) => [user.id, user]));
    const pendingUsers = pendingInvites
      .map((invite) => {
        if (!invite.invitee_id) return null;
        const user = usersById.get(invite.invitee_id);
        return user ? normalizeUser(user, invite.id) : null;
      })
      .filter(Boolean);

    return res.status(200).json(pendingUsers);
  } catch (err) {
    console.error("GET /circles/[id]/invites error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function createInvite(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const circleId = String(req.query.id ?? "").trim();
  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

  if (!circleId) {
    return res.status(400).json({ error: "Circle id is required" });
  }

  if (!userId) {
    return res.status(400).json({ error: "User id is required" });
  }

  if (userId === auth.userId) {
    return res.status(400).json({ error: "You cannot invite yourself" });
  }

  try {
    const requesterRole = await getRequesterRole(auth.userId, circleId);
    if (!requesterRole || !INVITER_ROLES.has(requesterRole)) {
      return res.status(403).json({ error: "Not authorized to invite members" });
    }

    const { data: targetUser, error: targetErr } = await db
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (targetErr) {
      console.error("POST /circles/[id]/invites target user error:", targetErr);
      return res.status(500).json({ error: "Failed to create invitation" });
    }

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const { data: existingMember, error: memberErr } = await db
      .from("members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberErr) {
      console.error("POST /circles/[id]/invites member check error:", memberErr);
      return res.status(500).json({ error: "Failed to create invitation" });
    }

    if (existingMember) {
      return res.status(409).json({ error: "User is already a circle member" });
    }

    const { data: existingInvite, error: inviteErr } = await db
      .from("invites")
      .select("id")
      .eq("circle_id", circleId)
      .eq("invitee_id", userId)
      .eq("status", INVITE_STATUS)
      .maybeSingle();

    if (inviteErr) {
      console.error("POST /circles/[id]/invites pending check error:", inviteErr);
      return res.status(500).json({ error: "Failed to create invitation" });
    }

    if (existingInvite) {
      return res.status(409).json({ error: "User already has a pending invitation" });
    }

    const { error: insertErr } = await db.from("invites").insert({
      inviter_id: auth.userId,
      invitee_id: userId,
      circle_id: circleId,
      role: INVITE_ROLE,
      status: INVITE_STATUS,
    });

    if (insertErr) {
      console.error("POST /circles/[id]/invites insert error:", insertErr);
      return res.status(500).json({ error: "Failed to create invitation" });
    }

    return res.status(201).json({
      userId,
      role: INVITE_ROLE,
      status: INVITE_STATUS,
    });
  } catch (err) {
    console.error("POST /circles/[id]/invites error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return listPendingInvites(req, res);
  }

  if (req.method === "POST") {
    return createInvite(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
