import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

const ROLE_RANK: Record<string, number> = {
  owner: 0,
  partner: 1,
  moderator: 2,
  audience: 3,
};

type MemberWithCircle = {
  role: string;
  circles: Record<string, unknown> | Record<string, unknown>[] | null;
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

function extractCircle(
  circles: MemberWithCircle["circles"]
): Record<string, unknown> | null {
  if (circles == null) return null;
  if (Array.isArray(circles)) return circles[0] ?? null;
  return circles;
}

function extractMemberCount(circle: Record<string, unknown>): number {
  const members = circle.members;
  if (!Array.isArray(members) || members.length === 0) return 1;

  const first = members[0];
  if (first && typeof first === "object" && "count" in first) {
    const count = Number((first as { count: number }).count);
    return Number.isFinite(count) && count > 0 ? count : 1;
  }

  return 1;
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
    grouped.set(circleId, members.sort(sortMembers).slice(0, 10));
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
    const { data, error } = await db
      .from("members")
      .select("role, circles(*, members(count))")
      .eq("user_id", auth.userId)
      .order("joined_at", { ascending: false });

    if (error) {
      console.error("GET /circles/active error:", error);
      return res.status(500).json({ error: "Failed to fetch active circles" });
    }

    const circles = ((data ?? []) as MemberWithCircle[])
      .map((row) => {
        const circle = extractCircle(row.circles);
        if (!circle) return null;
        return { ...normalizeCircle(circle), role: row.role };
      })
      .filter((circle): circle is Record<string, unknown> & { role: string } => circle != null);

    const circleIds = circles
      .map((circle) => String(circle.id ?? ""))
      .filter(Boolean);

    if (circleIds.length === 0) {
      return res.status(200).json(circles);
    }

    const { data: previewRows, error: previewErr } = await db
      .from("members")
      .select("user_id, circle_id, role, joined_at, users(firstname, lastname, nickname, avatar)")
      .in("circle_id", circleIds);

    if (previewErr) {
      console.error("GET /circles/active members preview error:", previewErr);
      return res.status(500).json({ error: "Failed to fetch active circles" });
    }

    const previewByCircleId = groupPreviewMembers((previewRows ?? []) as MemberRow[]);

    const circlesWithPreview = circles.map((circle) => ({
      ...circle,
      members_preview: previewByCircleId.get(String(circle.id)) ?? [],
    }));

    return res.status(200).json(circlesWithPreview);
  } catch (err) {
    console.error("GET /circles/active error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
