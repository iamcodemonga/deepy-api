import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const ROLE_RANK: Record<string, number> = {
  owner: 0,
  partner: 1,
  moderator: 2,
  audience: 3,
};

type UserRecord = {
  firstname?: string | null;
  lastname?: string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type MemberRow = {
  user_id: string;
  circle_id: string;
  role: string | null;
  joined_at: string | null;
  users: UserRecord | UserRecord[] | null;
};

type CircleMember = {
  userid: string;
  firstname: string | null;
  lastname: string | null;
  nickname: string;
  role: string;
  avatar: string | null;
  joinedAt: string | null;
};

function extractMemberCount(circle: Record<string, unknown>): number {
  const members = circle.members;
  if (!Array.isArray(members) || members.length === 0) return 0;

  const first = members[0];
  if (first && typeof first === "object" && "count" in first) {
    const count = Number((first as { count: number }).count);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  return 0;
}

function normalizeCircle(circle: Record<string, unknown>): Record<string, unknown> {
  const { members, ...rest } = circle;
  return { ...rest, member_count: extractMemberCount(circle) };
}

function extractUser(users: MemberRow["users"]): UserRecord | null {
  if (!users) return null;
  return Array.isArray(users) ? users[0] ?? null : users;
}

function getDisplayName(user: UserRecord | null, fallback: string): string {
  const nickname = user?.nickname?.trim();
  if (nickname) return nickname;

  const fullName = [user?.firstname, user?.lastname]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || fallback;
}

function normalizeMember(row: MemberRow): CircleMember {
  const user = extractUser(row.users);

  return {
    userid: row.user_id,
    firstname: user?.firstname ?? null,
    lastname: user?.lastname ?? null,
    nickname: getDisplayName(user, row.user_id),
    role: row.role ?? "audience",
    avatar: user?.avatar ?? null,
    joinedAt: row.joined_at ?? null,
  };
}

function sortMembers(a: CircleMember, b: CircleMember): number {
  const rankA = ROLE_RANK[a.role.toLowerCase()] ?? Number.MAX_SAFE_INTEGER;
  const rankB = ROLE_RANK[b.role.toLowerCase()] ?? Number.MAX_SAFE_INTEGER;

  if (rankA !== rankB) return rankA - rankB;

  const nameCompare = a.nickname.localeCompare(b.nickname);
  if (nameCompare !== 0) return nameCompare;

  return (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "");
}

function groupPreviewMembers(rows: MemberRow[]): Map<string, CircleMember[]> {
  const grouped = new Map<string, CircleMember[]>();

  for (const row of rows) {
    const members = grouped.get(row.circle_id) ?? [];
    members.push(normalizeMember(row));
    grouped.set(row.circle_id, members);
  }

  for (const [circleId, members] of grouped) {
    grouped.set(circleId, members.sort(sortMembers).slice(0, 3));
  }

  return grouped;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getBearerUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    const { data: memberships, error: membersErr } = await db
      .from("members")
      .select("circle_id")
      .eq("user_id", auth.userId);

    if (membersErr) {
      console.error("GET /circles/for-you memberships error:", membersErr);
      return res.status(500).json({ error: "Failed to fetch circles" });
    }

    const { data: pendingInvites, error: invitesErr } = await db
      .from("invites")
      .select("circle_id")
      .eq("invitee_id", auth.userId)
      .eq("status", "pending");

    if (invitesErr) {
      console.error("GET /circles/for-you invites error:", invitesErr);
      return res.status(500).json({ error: "Failed to fetch circles" });
    }

    const excludedCircleIds = Array.from(
      new Set([
        ...((memberships ?? []) as Array<{ circle_id: string }>).map((row) => row.circle_id),
        ...((pendingInvites ?? []) as Array<{ circle_id: string }>).map((row) => row.circle_id),
      ])
    );

    let query = db
      .from("circles")
      .select("*, members(count)")
      .eq("private", false)
      .neq("creator_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (excludedCircleIds.length > 0) {
      query = query.not("id", "in", `(${excludedCircleIds.join(",")})`);
    }

    const { data: circlesData, error: circlesErr } = await query;

    if (circlesErr) {
      console.error("GET /circles/for-you circles error:", circlesErr);
      return res.status(500).json({ error: "Failed to fetch circles" });
    }

    const circles = ((circlesData ?? []) as Record<string, unknown>[]).map(normalizeCircle);
    const circleIds = circles.map((circle) => String(circle.id ?? "")).filter(Boolean);

    if (circleIds.length === 0) {
      return res.status(200).json([]);
    }

    const { data: previewRows, error: previewErr } = await db
      .from("members")
      .select("user_id, circle_id, role, joined_at, users(firstname, lastname, nickname, avatar)")
      .in("circle_id", circleIds);

    if (previewErr) {
      console.error("GET /circles/for-you members preview error:", previewErr);
      return res.status(500).json({ error: "Failed to fetch circles" });
    }

    const previewByCircleId = groupPreviewMembers((previewRows ?? []) as MemberRow[]);
    const circlesWithPreview = circles.map((circle) => ({
      ...circle,
      members_preview: previewByCircleId.get(String(circle.id)) ?? [],
    }));

    return res.status(200).json(circlesWithPreview);
  } catch (err) {
    console.error("GET /circles/for-you error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
