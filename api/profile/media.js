import { getAdminClient, getUserFromRequest } from '../_lib/supabaseAdmin.js';

// Profile pictures and banners, stored in Supabase Storage.
//
//   PUT    /api/profile/media   { kind: 'avatar' | 'banner', image: 'data:image/jpeg;base64,...' }
//   DELETE /api/profile/media?kind=avatar
//
// The frontend resizes the image first (see src/lib/profileMedia.js), so
// uploads are small. Files live at <user id>/<kind>.jpg in the public bucket
// `profile-media`, which this handler creates the first time it's needed, so
// no database migration or storage policy is required: the server writes
// with the secret key after checking who's asking, and anyone can read.
// Because the path comes from the user id, pages build the image URL
// themselves (publicProfileImageUrl) instead of storing it in `profiles`.

export const BUCKET = 'profile-media';
const KINDS = new Set(['avatar', 'banner']);
const MAX_BYTES = 2 * 1024 * 1024;
const DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

let bucketReady = false;

async function ensureBucket(db) {
  if (bucketReady) return;
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ['image/jpeg'],
    });
    // Another request may have created it in the meantime.
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketReady = true;
}

export default async function handler(req, res) {
  if (req.method !== 'PUT' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const kind = req.method === 'DELETE' ? req.query?.kind : body.kind;
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'kind must be avatar or banner' });

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Log in to change your profile.' });

    const db = getAdminClient();
    await ensureBucket(db);
    const path = `${user.id}/${kind}.jpg`;

    if (req.method === 'DELETE') {
      const { error } = await db.storage.from(BUCKET).remove([path]);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const match = DATA_URL.exec(typeof body.image === 'string' ? body.image : '');
    if (!match) return res.status(400).json({ error: 'image must be a JPEG data URL' });
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Image is too large' });

    const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '60',
    });
    if (error) throw error;
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return res.status(200).json({ url: `${data.publicUrl}?v=${Date.now()}` });
  } catch (error) {
    console.error('Profile media failed:', error.message);
    return res.status(502).json({ error: "Couldn't save that image, try again later." });
  }
}
