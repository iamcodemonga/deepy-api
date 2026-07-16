import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

type UserRecord = {
  firstname?: string | null;
  lastname?: string | null;
  nickname?: string | null;
  avatar?: string | null;
};

type CircleRow = {
  id: string;
  private: boolean;
};

type PostRow = {
  id: string;
  circle_id: string;
};

type CommentRow = {
  id: string;
  circle_id: string;
  post_id: string;
  commentor_id: string;
  text: string | null;
  commented_at: string;
  users: UserRecord | UserRecord[] | null;
};

const COMMENT_SELECT =
  "id, circle_id, post_id, commentor_id, text, commented_at, users(firstname, lastname, nickname, avatar)";

function extractUser(users: CommentRow["users"]): UserRecord | null {
  if (!users) return null;
  return Array.isArray(users) ? users[0] ?? null : users;
}

function normalizeComment(row: CommentRow) {
  const commentor = extractUser(row.users);

  return {
    id: row.id,
    circleId: row.circle_id,
    postId: row.post_id,
    commentorId: row.commentor_id,
    text: row.text ?? "",
    commentedAt: row.commented_at,
    commentor: {
      firstname: commentor?.firstname ?? null,
      lastname: commentor?.lastname ?? null,
      nickname: commentor?.nickname ?? null,
      avatar: commentor?.avatar ?? null,
    },
  };
}

async function authorizePublicPost(
  circleId: string,
  postId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: circle, error: circleErr } = await db
    .from("circles")
    .select("id, private")
    .eq("id", circleId)
    .maybeSingle();

  if (circleErr) {
    console.error("comments authorize circle error:", circleErr);
    return { ok: false, status: 500, error: "Failed to fetch comments" };
  }

  if (!(circle as CircleRow | null)) {
    return { ok: false, status: 404, error: "Circle not found" };
  }

  if ((circle as CircleRow).private) {
    return {
      ok: false,
      status: 403,
      error: "Comments are not available for private circles",
    };
  }

  const { data: post, error: postErr } = await db
    .from("posts")
    .select("id, circle_id")
    .eq("id", postId)
    .eq("circle_id", circleId)
    .is("deleted_at", null)
    .maybeSingle();

  if (postErr) {
    console.error("comments authorize post error:", postErr);
    return { ok: false, status: 500, error: "Failed to fetch comments" };
  }

  if (!(post as PostRow | null)) {
    return { ok: false, status: 404, error: "Post not found" };
  }

  return { ok: true };
}

async function handleGetComments(
  res: NextApiResponse,
  circleId: string,
  postId: string
) {
  const authz = await authorizePublicPost(circleId, postId);
  if (!authz.ok) {
    return res.status(authz.status).json({ error: authz.error });
  }

  const { data: comments, error: commentsErr } = await db
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("circle_id", circleId)
    .eq("post_id", postId)
    .order("commented_at", { ascending: true })
    .order("id", { ascending: true });

  if (commentsErr) {
    console.error("GET /circles/[id]/posts/[postId]/comments error:", commentsErr);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }

  return res
    .status(200)
    .json(((comments ?? []) as CommentRow[]).map(normalizeComment));
}

async function handleCreateComment(
  req: NextApiRequest,
  res: NextApiResponse,
  circleId: string,
  postId: string,
  userId: string
) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

  if (!text) {
    return res.status(400).json({ error: "Comment text is required" });
  }

  const authz = await authorizePublicPost(circleId, postId);
  if (!authz.ok) {
    return res.status(authz.status).json({
      error:
        authz.status === 500 ? "Failed to create comment" : authz.error,
    });
  }

  const { data: comment, error: commentErr } = await db
    .from("comments")
    .insert({
      circle_id: circleId,
      post_id: postId,
      commentor_id: userId,
      text,
    })
    .select(COMMENT_SELECT)
    .single();

  if (commentErr) {
    console.error("POST /circles/[id]/posts/[postId]/comments error:", commentErr);
    return res.status(500).json({ error: "Failed to create comment" });
  }

  return res.status(201).json(normalizeComment(comment as CommentRow));
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
  const postId = String(req.query.postId ?? "").trim();

  if (!circleId || !postId) {
    return res.status(400).json({ error: "Circle id and post id are required" });
  }

  try {
    if (req.method === "POST") {
      return handleCreateComment(req, res, circleId, postId, auth.userId);
    }

    return handleGetComments(res, circleId, postId);
  } catch (err) {
    console.error(`${req.method} /circles/[id]/posts/[postId]/comments error:`, err);
    return res.status(500).json({ error: "Server error" });
  }
}
