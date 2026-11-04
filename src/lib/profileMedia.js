// Profile pictures and banners. Images are resized in the browser, then sent
// to /api/profile/media, which stores them in the public `profile-media`
// bucket at <user id>/<kind>.jpg. Pages build the URL from the user id, so
// nothing has to be stored in the profiles table.

import { supabase } from './supabase.js'

export const IMAGE_LIMITS = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 600 },
}
export const UPLOAD_ERROR = "Couldn't upload that image. Check your connection and try again."
export const NOT_AN_IMAGE = 'Choose an image file (JPEG, PNG or WebP).'

// Public URL of a user's avatar or banner. The image may not exist; show a
// fallback when it fails to load. `version` busts the cache after an upload.
export function profileImageUrl(userId, kind, version = '') {
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base || !userId) return null
  return `${base}/storage/v1/object/public/profile-media/${userId}/${kind}.jpg${version ? `?v=${version}` : ''}`
}

// Shrinks and centre-crops an image file so uploads stay small: avatars
// become a 512px square, banners a 1600×600 strip. Returns a JPEG data URL.
export function resizeImage(file, { width, height }) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error(NOT_AN_IMAGE))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.max(width / img.width, height / img.height)
      const w = Math.min(width, Math.round(img.width * scale))
      const h = Math.min(height, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const sw = w / scale
      const sh = h / scale
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(NOT_AN_IMAGE))
    }
    img.src = url
  })
}

async function call(method, body, query = '') {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Log in to change your profile.')
  const response = await fetch(`/api/profile/media${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || UPLOAD_ERROR)
  return json
}

// Uploads an avatar or banner for the signed-in user. Returns its URL
// (cache-busted) so the page can show it right away.
export async function uploadProfileImage(kind, file) {
  const image = await resizeImage(file, IMAGE_LIMITS[kind])
  const { url } = await call('PUT', { kind, image })
  return url
}

export async function removeProfileImage(kind) {
  await call('DELETE', null, `?kind=${encodeURIComponent(kind)}`)
}
