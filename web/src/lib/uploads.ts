/**
 * Client helpers for the /v1/uploads endpoint.
 *
 * Uploads are multipart/form-data with one field per file. The
 * engine stores each into a per-session work-dir under
 * `MOTION_FORGE_UPLOAD_DIR` and returns the server-side paths so the
 * caller can pass them straight back to `/v1/generate` as
 * `reference_video` (or, post-merge, `reference_images: [...]`).
 */

export type UploadedKind = 'video' | 'image' | 'audio' | 'pdf' | 'text' | 'binary';

export interface UploadedFile {
  kind: UploadedKind;
  path: string;
  original_name?: string;
  content_type?: string;
  bytes: number;
}

export interface UploadResponse {
  session: string;
  work_dir: string;
  files: UploadedFile[];
}

/**
 * Classify a browser File into one of the engine's accepted kinds.
 * Used by the drop-zone to label chips before upload.
 */
export function classifyFile(file: File): UploadedKind {
  const type = file.type || '';
  const name = file.name.toLowerCase();
  // PDF first — same priority as the engine-side classify().
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(name)) return 'video';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(name)) return 'image';
  if (type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a)$/i.test(name)) return 'audio';
  if (type.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(name)) return 'text';
  return 'binary';
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const UPLOAD_ENDPOINT =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ENGINE_BASE_URL
    ? `${process.env.NEXT_PUBLIC_ENGINE_BASE_URL}/v1/uploads`
    : '/v1/uploads');

/**
 * POST a list of browser Files as multipart/form-data to the engine.
 * `bearerToken` is the access_token from the NextAuth Keycloak
 * session (the engine validates it via JWKS).
 */
export async function uploadFiles(
  files: File[],
  bearerToken: string | null | undefined,
): Promise<UploadResponse> {
  if (files.length === 0) throw new Error('no files to upload');
  const fd = new FormData();
  for (const f of files) {
    // The field name is the safe form of the filename; the engine
    // uses content-type + extension to classify, so the field name
    // is purely cosmetic in the request log.
    fd.append(f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64), f, f.name);
  }
  const r = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
    body: fd,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`upload failed: HTTP ${r.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }
  return (await r.json()) as UploadResponse;
}
