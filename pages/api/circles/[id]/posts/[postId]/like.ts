import type { NextApiRequest, NextApiResponse } from "next";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

type CircleRow = {
  id: string;
  private: boolean;
};

type PostRow = {
  id: string;
  circle_id: string;
};

async function getLikeCount(circleId: string, postId: string): Promise<number> {
  const { count, error } = await db
    .from("likes")
    .select("id", { count: "exact", head: true })
    .eq("circle_id", circleId)
    .eq("post_id", postId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
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
    const { data: circle, error: circleErr } = await db
      .from("circles")
      .select("id, private")
      .eq("id", circleId)
      .maybeSingle();

    if (circleErr) {
      console.error(`${req.method} /circles/[id]/posts/[postId]/like circle error:`, circleErr);
      return res.status(500).json({ error: "Failed to update like" });
    }

    if (!(circle as CircleRow | null)) {
      return res.status(404).json({ error: "Circle not found" });
    }

    if ((circle as CircleRow).private) {
      return res.status(403).json({ error: "Likes are not available for private circles" });
    }

    const { data: post, error: postErr } = await db
      .from("posts")
      .select("id, circle_id")
      .eq("id", postId)
      .eq("circle_id", circleId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postErr) {
      console.error(`${req.method} /circles/[id]/posts/[postId]/like post error:`, postErr);
      return res.status(500).json({ error: "Failed to update like" });
    }

    if (!(post as PostRow | null)) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (req.method === "POST") {
      const { error: likeErr } = await db.from("likes").upsert(
        {
          circle_id: circleId,
          post_id: postId,
          lover_id: auth.userId,
        },
        { onConflict: "post_id,lover_id", ignoreDuplicates: true }
      );

      if (likeErr) {
        console.error("POST /circles/[id]/posts/[postId]/like error:", likeErr);
        return res.status(500).json({ error: "Failed to like post" });
      }

      const likeCount = await getLikeCount(circleId, postId);
      return res.status(200).json({ postId, likeCount, isLiked: true });
    }

    const { error: unlikeErr } = await db
      .from("likes")
      .delete()
      .eq("circle_id", circleId)
      .eq("post_id", postId)
      .eq("lover_id", auth.userId);

    if (unlikeErr) {
      console.error("DELETE /circles/[id]/posts/[postId]/like error:", unlikeErr);
      return res.status(500).json({ error: "Failed to unlike post" });
    }

    const likeCount = await getLikeCount(circleId, postId);
    return res.status(200).json({ postId, likeCount, isLiked: false });
  } catch (err) {
    console.error(`${req.method} /circles/[id]/posts/[postId]/like error:`, err);
    return res.status(500).json({ error: "Server error" });
  }
}
