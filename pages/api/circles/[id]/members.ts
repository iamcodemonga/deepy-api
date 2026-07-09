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
  id?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type MemberRow = {
  id: string;
  user_id: string;
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

function getUser(users: MemberRow["users"]): UserRecord | null {
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
  const user = getUser(row.users);

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
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
    const { data: requester, error: requesterErr } = await db
      .from("members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (requesterErr) {
      console.error("GET /circles/[id]/members requester error:", requesterErr);
      return res.status(500).json({ error: "Failed to fetch circle members" });
    }

    if (!requester) {
      return res.status(403).json({ error: "Not authorized to view circle members" });
    }

    const { data, error } = await db
      .from("members")
      .select("id, user_id, role, joined_at, users(id, firstname, lastname, nickname, avatar)")
      .eq("circle_id", circleId);

    if (error) {
      console.error("GET /circles/[id]/members error:", error);
      return res.status(500).json({ error: "Failed to fetch circle members" });
    }

    const members = ((data ?? []) as MemberRow[]).map(normalizeMember).sort(sortMembers);

    return res.status(200).json(members);
  } catch (err) {
    console.error("GET /circles/[id]/members error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
