import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import cloudinary from "@/src/lib/cloudinary";
import { db } from "@/src/lib/supabase";

export const config = {
  api: { bodyParser: false }, // Required for formidable
};

type FormFields = { oldPublicId?: string[]; userId?: string[] };

/**
 * Parse multipart form using formidable
 */
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1️⃣ Extract and verify the token (Bearer <access_token>)
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization token" });
    }

    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const userId = userData.user.id;

    // 2️⃣ Parse the multipart form
    const { fields, files } = await parseForm(req);

    const f = (files as any).file;
    const file = Array.isArray(f) ? f[0] : f;

    if (!file || !file.filepath) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        error: "Invalid file type. Only JPG, JPEG, PNG are allowed.",
      });
    }

    // Optional: old Cloudinary public ID
    const oldPublicId = (fields as FormFields).oldPublicId?.[0] ?? null;

    // Optional: Validate client userId (extra security)
    const clientUserId = (fields as FormFields).userId?.[0];
    if (clientUserId && clientUserId !== userId) {
      return res.status(403).json({ error: "User ID mismatch" });
    }

    // 3️⃣ Delete old image (best effort)
    if (oldPublicId) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
      } catch (err) {
        console.warn("Failed to delete old image:", err);
      }
    }

    // 4️⃣ Upload new avatar
    const extension = file.originalFilename.split(".").pop(); // jpg, png, gif
    const upload = await cloudinary.uploader.upload(file.filepath, {
      folder: "avatars", // Your Cloudinary folder
      public_id: `avatar_${userId}`,
      overwrite: true,
      resource_type: "image",
      format: extension,  
      allowed_formats: ["jpg", "jpeg", "png", "gif"],
      transformation: [
        { width: 512, height: 512, crop: "fill", gravity: "face" },
      ],
    });

    const avatarUrl = upload.secure_url;
    const avatarPublicId = upload.public_id;

    // 5️⃣ Update Supabase DB
    const { error: updateErr } = await db
      .from("users")
      .update({
        avatar: avatarUrl,
        avatar_public_id: avatarPublicId,
      })
      .eq("id", userId);

    if (updateErr) {
      // Rollback Cloudinary upload to avoid orphaned images
      try {
        await cloudinary.uploader.destroy(avatarPublicId);
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr);
      }
      return res.status(500).json({ error: "Failed to update avatar" });
    }

    // 6️⃣ Done
    return res.status(200).json({
      url: avatarUrl,
      public_id: avatarPublicId,
    });
  } catch (err: any) {
    console.error("Upload API error:", err);
    return res.status(500).json({ error: err.message ?? "Server error" });
  }
}
