import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import cloudinary from "@/src/lib/cloudinary";
import { getBearerUser } from "@/src/lib/auth";
import { db } from "@/src/lib/supabase";

export const config = {
  api: { bodyParser: false },
};

type FormFields = { circleId?: string[] };

function parseForm(req: NextApiRequest) {
  return new Promise<{ fields: formidable.Fields; files: formidable.Files }>(
    (resolve, reject) => {
      const form = formidable({ multiples: false });

      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    }
  );
}

async function canEditCircleBanner(
  userId: string,
  circleId: string
): Promise<boolean> {
  const { data: circle, error: circleErr } = await db
    .from("circles")
    .select("creator_id")
    .eq("id", circleId)
    .maybeSingle();

  if (circleErr || !circle) return false;

  if (circle.creator_id === userId) return true;

  const { data: member, error: memberErr } = await db
    .from("members")
    .select("role")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr || !member) return false;

  return member.role === "owner";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await getBearerUser(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const { fields, files } = await parseForm(req);

    const circleId = (fields as FormFields).circleId?.[0]?.trim();

    if (circleId) {
      const allowed = await canEditCircleBanner(auth.userId, circleId);
      if (!allowed) {
        return res.status(403).json({ error: "Not authorized to update this circle banner" });
      }
    }

    const f = (files as { file?: formidable.File | formidable.File[] }).file;
    const file = Array.isArray(f) ? f[0] : f;

    if (!file?.filepath) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];

    if (!file.mimetype || !allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        error: "Invalid file type. Only JPG, JPEG, PNG are allowed.",
      });
    }

    const extension = file.originalFilename?.split(".").pop() ?? "jpg";
    const timestamp = Date.now();

    const upload = await cloudinary.uploader.upload(file.filepath, {
      folder: "circle-banners",
      public_id: `circle_banner_${auth.userId}_${timestamp}`,
      resource_type: "image",
      format: extension,
      allowed_formats: ["jpg", "jpeg", "png", "gif"],
      transformation: [{ width: 512, height: 512, crop: "fill" }],
    });

    const bannerUrl = upload.secure_url;
    const bannerPublicId = upload.public_id;

    if (circleId) {
      const { error: updateErr } = await db
        .from("circles")
        .update({ banner: bannerUrl })
        .eq("id", circleId);

      if (updateErr) {
        try {
          await cloudinary.uploader.destroy(bannerPublicId);
        } catch (rollbackErr) {
          console.error("Cloudinary rollback failed:", rollbackErr);
        }
        return res.status(500).json({ error: "Failed to update circle banner" });
      }
    }

    return res.status(200).json({
      url: bannerUrl,
      public_id: bannerPublicId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("Circle banner upload error:", err);
    return res.status(500).json({ error: message });
  }
}
