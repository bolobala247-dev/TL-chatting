import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
// SDK 56: the legacy subpath keeps the string-URI API surface the pipeline
// needs (documentDirectory, copyAsync, uploadAsync...) — same import style
// as the rest of the codebase will adopt for staging.
import * as FileSystem from "expo-file-system/legacy";
import {
  MEDIA_IMAGE_COPY_THROUGH_BYTES,
  MEDIA_IMAGE_MAX_EDGE,
  MEDIA_IMAGE_QUALITY,
  MEDIA_MAX_FILE_BYTES,
  MEDIA_MAX_IMAGE_BYTES,
  MEDIA_MAX_VIDEO_BYTES,
  MEDIA_MAX_VIDEO_DURATION_S,
  MEDIA_THUMB_EDGE,
  MEDIA_THUMB_QUALITY,
} from "@/src/lib/constants";

/**
 * Media staging pipeline (Phase 7A §5–§7) — pure per-kind processors.
 *
 * Each processor validates, stages (copies into the caller-provided
 * app-owned directory) and enriches one attachment. Runs during STAGING,
 * one attachment at a time (§14 memory budget: one decode in flight).
 *
 * Layering: knows files and pixels only — no stores, services, queues, or
 * network. Throwing here means "send fails synchronously at authoring"
 * (design M9); the caller owns cleanup of the staging directory.
 */

export interface StagedMedia {
  /** file:// URI of the staged artifact inside the caller's directory. */
  uri: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  /** base64 data-URI micro thumbnail (§7); images/videos only. */
  thumb?: string;
  /** Sanitized original filename (files only). */
  name?: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extensionOf(uri: string): string {
  const clean = uri.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

function mimeFromExtension(ext: string, fallback: string): string {
  return MIME_BY_EXTENSION[ext] ?? fallback;
}

async function statBytes(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error(`source file missing: ${uri}`);
  }
  return "size" in info && typeof info.size === "number" ? info.size : 0;
}

/**
 * Micro thumbnail (§7): longest edge → MEDIA_THUMB_EDGE px, JPEG q0.5,
 * inlined as a base64 data URI (~0.5–1.5 KB). Rides in the attachments JSON
 * so both sides paint it with zero network. Best-effort: a thumb failure
 * must never fail the send.
 */
async function makeThumbDataUri(
  sourceUri: string,
  width: number,
  height: number
): Promise<string | undefined> {
  try {
    const scale = MEDIA_THUMB_EDGE / Math.max(width, height, 1);
    const context = ImageManipulator.manipulate(sourceUri);
    if (scale < 1) {
      context.resize(
        width >= height
          ? { width: MEDIA_THUMB_EDGE }
          : { height: MEDIA_THUMB_EDGE }
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: MEDIA_THUMB_QUALITY,
      base64: true,
    });
    // The tiny temp file is not needed once the base64 is inlined
    void FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(
      () => undefined
    );
    return saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// image (§6) — downscale + re-encode; the compressed output IS the staged copy
// ---------------------------------------------------------------------------

export async function processImage(
  sourceUri: string,
  destDir: string,
  position: number
): Promise<StagedMedia> {
  const sourceBytes = await statBytes(sourceUri);
  const ext = extensionOf(sourceUri);

  // Decode once for dimensions (also EXIF-orientation-normalized by the
  // manipulator, so width/height match what actually renders).
  const probe = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const srcWidth = probe.width;
  const srcHeight = probe.height;
  const maxEdge = Math.max(srcWidth, srcHeight);

  // Copy-through (§6): already-JPEG + within edge cap + ≤ 500 KB → stage a
  // plain copy. Small screenshots keep pixel-perfect text; EXIF risk on this
  // path is accepted for screenshots-class images (§13.5).
  if (
    (ext === "jpg" || ext === "jpeg") &&
    maxEdge <= MEDIA_IMAGE_MAX_EDGE &&
    sourceBytes <= MEDIA_IMAGE_COPY_THROUGH_BYTES
  ) {
    const stagedUri = `${destDir}${position}.jpg`;
    await FileSystem.copyAsync({ from: sourceUri, to: stagedUri });
    const thumb = await makeThumbDataUri(stagedUri, srcWidth, srcHeight);
    return {
      uri: stagedUri,
      bytes: sourceBytes,
      mime: "image/jpeg",
      width: srcWidth,
      height: srcHeight,
      thumb,
    };
  }

  // Re-encode: downscale so max edge ≤ 2048 (never upscale) + JPEG q0.8.
  // Stripping EXIF/GPS is a deliberate side effect (§13.5). PNG stays PNG
  // (alpha-safe); everything else becomes JPEG (albums are photos).
  const keepPng = ext === "png";
  const context = ImageManipulator.manipulate(sourceUri);
  if (maxEdge > MEDIA_IMAGE_MAX_EDGE) {
    context.resize(
      srcWidth >= srcHeight
        ? { width: MEDIA_IMAGE_MAX_EDGE }
        : { height: MEDIA_IMAGE_MAX_EDGE }
    );
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: keepPng ? SaveFormat.PNG : SaveFormat.JPEG,
    compress: MEDIA_IMAGE_QUALITY,
  });

  const stagedUri = `${destDir}${position}.${keepPng ? "png" : "jpg"}`;
  await FileSystem.moveAsync({ from: saved.uri, to: stagedUri });
  const stagedBytes = await statBytes(stagedUri);
  if (stagedBytes > MEDIA_MAX_IMAGE_BYTES) {
    throw new Error(`image exceeds size cap after compression: ${stagedBytes}`);
  }
  const thumb = await makeThumbDataUri(stagedUri, saved.width, saved.height);
  return {
    uri: stagedUri,
    bytes: stagedBytes,
    mime: keepPng ? "image/png" : "image/jpeg",
    width: saved.width,
    height: saved.height,
    thumb,
  };
}

// ---------------------------------------------------------------------------
// video (§5.2) — no transcode in 7A: caps + raw copy + poster-frame thumb
// ---------------------------------------------------------------------------

export async function processVideo(
  sourceUri: string,
  destDir: string,
  position: number,
  durationMs?: number
): Promise<StagedMedia> {
  const sourceBytes = await statBytes(sourceUri);
  if (sourceBytes > MEDIA_MAX_VIDEO_BYTES) {
    throw new Error(`video exceeds size cap: ${sourceBytes}`);
  }
  if (
    durationMs != null &&
    durationMs > MEDIA_MAX_VIDEO_DURATION_S * 1000
  ) {
    throw new Error(`video exceeds duration cap: ${durationMs}ms`);
  }

  const ext = extensionOf(sourceUri) || "mp4";
  const stagedUri = `${destDir}${position}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: stagedUri });

  // Poster frame → 32px data-URI thumb. Lazy require keeps the native module
  // out of web bundles (the pipeline is only reached behind the native-only
  // capability gate, but the import itself must stay safe everywhere).
  let width: number | undefined;
  let height: number | undefined;
  let thumb: string | undefined;
  try {
    const VideoThumbnails =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("expo-video-thumbnails") as typeof import("expo-video-thumbnails");
    const poster = await VideoThumbnails.getThumbnailAsync(stagedUri, {
      time: 0,
    });
    width = poster.width;
    height = poster.height;
    thumb = await makeThumbDataUri(poster.uri, poster.width, poster.height);
    void FileSystem.deleteAsync(poster.uri, { idempotent: true }).catch(
      () => undefined
    );
  } catch {
    // Poster is progressive-loading sugar — its absence degrades rendering
    // (fixed-size box, no placeholder), never the send.
  }

  return {
    uri: stagedUri,
    bytes: sourceBytes,
    mime: mimeFromExtension(ext, "video/mp4"),
    width,
    height,
    duration_ms: durationMs,
    thumb,
  };
}

// ---------------------------------------------------------------------------
// file (§5.2) — passthrough: cap + sanitized name + raw copy
// ---------------------------------------------------------------------------

export async function processFile(
  sourceUri: string,
  destDir: string,
  position: number,
  originalName?: string,
  mime?: string
): Promise<StagedMedia> {
  const sourceBytes = await statBytes(sourceUri);
  if (sourceBytes > MEDIA_MAX_FILE_BYTES) {
    throw new Error(`file exceeds size cap: ${sourceBytes}`);
  }

  const rawName = originalName ?? sourceUri.split("/").pop() ?? "file";
  // Path separators / control chars out; the name is display + download only
  const name = rawName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 128);
  const ext = extensionOf(name) || extensionOf(sourceUri) || "bin";
  const stagedUri = `${destDir}${position}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: stagedUri });

  return {
    uri: stagedUri,
    bytes: sourceBytes,
    mime: mime ?? mimeFromExtension(ext, "application/octet-stream"),
    name,
  };
}
