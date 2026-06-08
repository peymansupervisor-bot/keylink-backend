import { supabase, BUCKET } from './supabase';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';

// Resize + compress an image buffer, upload to Supabase Storage, return public URL
export async function uploadImage(
  buffer: Buffer,
  folder: 'avatars' | 'listings' | 'misc',
  options: { width?: number; height?: number; quality?: number } = {}
): Promise<string> {
  const { width = 1200, height, quality = 82 } = options;

  const compressed = await sharp(buffer)
    .rotate()                          // auto-orient from EXIF
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, progressive: true })
    .toBuffer();

  const filename = `${folder}/${uuid()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, compressed, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

export async function deleteImage(url: string): Promise<void> {
  // Extract path after the bucket name
  const parts = url.split(`/${BUCKET}/`);
  if (parts.length < 2) return;
  await supabase.storage.from(BUCKET).remove([parts[1]]);
}
