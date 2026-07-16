import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

type UserRecord = {
  firstname?: string | null;
  lastname?: string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type PostRow = {
  id: string;
  circle_id: string;
  sender_id: string;
  text: string | null;
  created_at: string;
  edited_at: string | null;
  users: UserRecord | UserRecord[] | null;
};

type LikeRow = {
  post_id: string;
  lover_id: string;
};

type CommentCountRow = {
  post_id: string;
};

type CircleRow = {
  id: string;
  private: boolean;
};

type MembershipRow = {
  id: string;
  role: string | null;
};

const POST_SELECT =
  "id, circle_id, sender_id, text, created_at, edited_at, users(firstname, lastname, nickname, avatar)";

function extractUser(users: PostRow["users"]): UserRecord | null {
  if (!users) return null;
  return Array.isArray(users) ? users[0] ?? null : users;
}

function normalizePost(
  row: PostRow,
  likeCounts: Map<string, number> = new Map(),
  likedPostIds: Set<string> = new Set(),
  commentCounts: Map<string, number> = new Map()
) {
  const sender = extractUser(row.users);

  return {
    id: row.id,
    circleId: row.circle_id,
    senderId: row.sender_id,
    text: row.text ?? "",
    createdAt: row.created_at,
    editedAt: row.edited_at,
    likeCount: likeCounts.get(row.id) ?? 0,
    isLiked: likedPostIds.has(row.id),
    commentCount: commentCounts.get(row.id) ?? 0,
    sender: {
      firstname: sender?.firstname ?? null,
      lastname: sender?.lastname ?? null,
      nickname: sender?.nickname ?? null,
      avatar: sender?.avatar ?? null,
    },
  };
}

function buildCommentCounts(comments: CommentCountRow[]): Map<string, number> {
  const commentCounts = new Map<string, number>();

  for (const comment of comments) {
    commentCounts.set(
      comment.post_id,
      (commentCounts.get(comment.post_id) ?? 0) + 1
    );
  }

  return commentCounts;
}

function buildLikeMetadata(
  likes: LikeRow[],
  userId: string
): { likeCounts: Map<string, number>; likedPostIds: Set<string> } {
  const likeCounts = new Map<string, number>();
  const likedPostIds = new Set<string>();

  for (const like of likes) {
    likeCounts.set(like.post_id, (likeCounts.get(like.post_id) ?? 0) + 1);

    if (like.lover_id === userId) {
      likedPostIds.add(like.post_id);
    }
  }

  return { likeCounts, likedPostIds };
}

async function getCircle(circleId: string): Promise<{
  circle: CircleRow | null;
  error: unknown;
}> {
  const { data, error } = await db
    .from("circles")
    .select("id, private")
    .eq("id", circleId)
    .maybeSingle();

  return { circle: data as CircleRow | null, error };
}

async function getMembership(
  userId: string,
  circleId: string
): Promise<{ membership: MembershipRow | null; error: unknown }> {
  const { data, error } = await db
    .from("members")
    .select("id, role")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();

  return { membership: data as MembershipRow | null, error };
}

async function handleGetPosts(
  res: NextApiResponse,
  circleId: string,
  userId: string
) {
  const { circle, error: circleErr } = await getCircle(circleId);

  if (circleErr) {
    console.error("GET /circles/[id]/posts circle error:", circleErr);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }

  if (!circle) {
    return res.status(404).json({ error: "Circle not found" });
  }

  if (circle.private) {
    const { membership, error: membershipErr } = await getMembership(userId, circleId);

    if (membershipErr) {
      console.error("GET /circles/[id]/posts membership error:", membershipErr);
      return res.status(500).json({ error: "Failed to fetch posts" });
    }

    if (!membership) {
      return res.status(403).json({ error: "Not authorized to view posts" });
    }
  }

  const { data: posts, error: postsErr } = await db
    .from("posts")
    .select(POST_SELECT)
    .eq("circle_id", circleId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (postsErr) {
    console.error("GET /circles/[id]/posts posts error:", postsErr);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }

  const postRows = (posts ?? []) as PostRow[];
  const postIds = postRows.map((post) => post.id);

  if (postIds.length === 0) {
    return res.status(200).json([]);
  }

  const { data: likes, error: likesErr } = await db
    .from("likes")
    .select("post_id, lover_id")
    .eq("circle_id", circleId)
    .in("post_id", postIds);

  if (likesErr) {
    console.error("GET /circles/[id]/posts likes error:", likesErr);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }

  const { data: comments, error: commentsErr } = await db
    .from("comments")
    .select("post_id")
    .eq("circle_id", circleId)
    .in("post_id", postIds);

  if (commentsErr) {
    console.error("GET /circles/[id]/posts comments error:", commentsErr);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }

  const { likeCounts, likedPostIds } = buildLikeMetadata(
    (likes ?? []) as LikeRow[],
    userId
  );
  const commentCounts = buildCommentCounts((comments ?? []) as CommentCountRow[]);

  return res.status(200).json(
    postRows.map((post) =>
      normalizePost(post, likeCounts, likedPostIds, commentCounts)
    )
  );
}

async function handleCreatePost(
  req: NextApiRequest,
  res: NextApiResponse,
  circleId: string,
  userId: string
) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!text) {
    return res.status(400).json({ error: "Post text is required" });
  }

  const { circle, error: circleErr } = await getCircle(circleId);

  if (circleErr) {
    console.error("POST /circles/[id]/posts circle error:", circleErr);
    return res.status(500).json({ error: "Failed to create post" });
  }

  if (!circle) {
    return res.status(404).json({ error: "Circle not found" });
  }

  const { membership, error: membershipErr } = await getMembership(userId, circleId);

  if (membershipErr) {
    console.error("POST /circles/[id]/posts membership error:", membershipErr);
    return res.status(500).json({ error: "Failed to create post" });
  }

  if (!membership || membership.role?.toLowerCase() === "audience") {
    return res.status(403).json({ error: "Not authorized to create posts" });
  }

  const { data: post, error: postErr } = await db
    .from("posts")
    .insert({
      circle_id: circleId,
      sender_id: userId,
      text,
    })
    .select(POST_SELECT)
    .single();

  if (postErr) {
    console.error("POST /circles/[id]/posts insert error:", postErr);
    return res.status(500).json({ error: "Failed to create post" });
  }

  return res.status(201).json(normalizePost(post as PostRow));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
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
    if (req.method === "POST") {
      return handleCreatePost(req, res, circleId, auth.userId);
    }

    return handleGetPosts(res, circleId, auth.userId);
  } catch (err) {
    console.error(`${req.method} /circles/[id]/posts error:`, err);
    return res.status(500).json({ error: "Server error" });
  }
}
