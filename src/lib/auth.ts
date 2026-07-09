import type { NextApiRequest } from "next";
import type { User } from "@supabase/supabase-js";
import { db } from "@/src/lib/supabase";

export type BearerAuthResult =
  | { ok: true; userId: string; user: User }
  | { ok: false; status: 401; error: string };

export async function getBearerUser(req: NextApiRequest): Promise<BearerAuthResult> {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization token" };
  }

  const { data, error } = await db.auth.getUser(token);

  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }

  return { ok: true, userId: data.user.id, user: data.user };
}
