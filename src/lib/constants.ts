export const MESSAGES_PER_PAGE = 20;
export const MEDIA_PER_PAGE = 30;
// Bounded in-memory message cache (RAM tier only — no persistence).
// Active room holds up to MESSAGE_WINDOW_SIZE messages; leaving a room trims
// it to ROOM_CACHE_TRIM_SIZE (still an instant re-open paint); at most
// MAX_CACHED_ROOMS rooms stay resident — least-recently-used are evicted.
export const MESSAGE_WINDOW_SIZE = 200;
export const ROOM_CACHE_TRIM_SIZE = 50;
export const MAX_CACHED_ROOMS = 8;
export const PINNED_MESSAGES_LIMIT = 50;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;
// Grace window to recall a just-sent message (undo send)
export const UNDO_SEND_WINDOW_MS = 8000;
// A sent message can only be edited within this window
export const EDIT_MESSAGE_WINDOW_MS = 60000;
// Debounce before persisting a draft to on-device storage
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
// Upper bounds for album / poll composition
export const MAX_ALBUM_IMAGES = 10;
export const MAX_POLL_OPTIONS = 10;
// Presence: own heartbeat cadence + peer status refresh while a DM is open.
// Server counts a user online while last_active_at is within 75s.
export const PRESENCE_HEARTBEAT_MS = 45000;
export const PEER_PRESENCE_POLL_MS = 30000;

// Global search: debounce before hitting search_messages / search_profiles
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_PAGE_SIZE = 20;

// Local app lock: failed-attempt lockout (brute-force slowdown)
export const APP_LOCK_MAX_ATTEMPTS = 5;
export const APP_LOCK_COOLDOWN_SECONDS = 30;
export const APP_LOCK_PIN_LENGTH = { min: 4, max: 6 } as const;

// Quick-reaction palette (minimal, no full emoji keyboard)
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  FILE: "file",
  SYSTEM: "system",
  POLL: "poll",
} as const;

export const ROOM_TYPES = {
  DIRECT: "direct",
  GROUP: "group",
} as const;

export const USER_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  AWAY: "away",
} as const;

export const EAS_PROJECT_ID = "5ff3ce97-1320-44a7-b7f5-167bbfd02b6f";

// ============================================
// Incremental synchronization (Phase 4)
// ============================================

// Master flag. false ⇒ syncService.syncNow delegates to the legacy full
// fetch (reconnect → fetchMessages, foreground → fetchRooms), so behavior is
// byte-identical to today. Rollback is flipping this back to false.
export const FEATURE_DELTA_SYNC = true;
// A delta that returns this many rows is treated as "history diverged": we
// stop stitching and fall back to a fresh page-1 fetch (gap-overflow guard).
export const DELTA_SYNC_LIMIT = 200;
// Disk-history cap per room (prune older cached rows beyond this).
export const MAX_PERSISTED_PER_ROOM = 1000;
// Bounded exponential backoff for a failing delta sync (per scope).
export const DELTA_RETRY_BASE_MS = 2000;
export const DELTA_RETRY_MAX_MS = 30000;
export const DELTA_MAX_ATTEMPTS = 4;
// Reserved sync_state scope id for the room-list cursor (not a real room id).
export const ROOMS_SYNC_SCOPE = "@rooms";

// ============================================
// Offline outbox (Phase 5A)
// ============================================

// Master flag. false ⇒ sending stays exactly today's temp-/RAM-only path
// (optimistic in RAM, removed on error, no durability). true ⇒ outgoing
// messages become durable, idempotent, ordered units of work (client-minted
// UUID, persisted PENDING row + outbox queue, worker-driven delivery).
// Rollback is flipping this back to false (kill switch).
export const FEATURE_OFFLINE_OUTBOX = false;
// Bounded exponential backoff for a failing send (per message, persisted in
// outbox.next_attempt_at → survives restart): 2s,4s,8s,16s,30s,30s.
export const OUTBOX_RETRY_BASE_MS = 2000;
export const OUTBOX_RETRY_MAX_MS = 30000;
// Transient failures beyond this cap park the message as FAILED (manual retry).
export const OUTBOX_MAX_ATTEMPTS = 6;
// Logout drains the outbox best-effort before wiping the DB (§8.3). Bounded so
// a flaky network can never block sign-out; anything still pending is dropped
// with the account's data (expected — you logged out).
export const OUTBOX_LOGOUT_DRAIN_MS = 3000;

// ============================================
// Reliability & consistency diagnostics (Phase 6B)
// ============================================

// Master flag. false ⇒ every diagnostic tap is a guarded no-op (one boolean
// check) and no auditor/harness ever runs — behavior is byte-identical to
// today and the observability layer costs nothing. true ⇒ passive counters,
// gauges, histograms, a bounded event ring, and the read-only auditor become
// live. This flag is INDEPENDENT of FEATURE_DELTA_SYNC / FEATURE_OFFLINE_OUTBOX:
// toggling it can never change message delivery. Rollback is flipping to false.
export const FEATURE_RELIABILITY_DIAGNOSTICS = false;
// Fixed capacity of the in-memory diagnostic event ring (oldest overwritten).
export const DIAG_RING_CAPACITY = 200;
// Cardinality cap: max distinct metric series (name+labels) the registry holds.
// A hard leak guard so a mislabeled tap can never grow the registry unbounded.
export const DIAG_MAX_SERIES = 256;

// ============================================
// Media pipeline (Phase 7A/7B)
// ============================================

// Master flag. false ⇒ media sends stay today's legacy path byte-for-byte
// (in-session sendAlbumMessage, no durability, no upload_queue writes).
// true ⇒ media messages become durable two-plane work: staged + compressed
// locally, uploaded by the media worker (idempotent storage paths), then
// handed to the Phase 5A outbox for delivery. Requires FEATURE_OFFLINE_OUTBOX
// (delivery rides the outbox); mediaService verifies this at runtime and
// degrades to legacy when unmet (logged, not thrown). Rollback = flip false.
export const FEATURE_MEDIA_PIPELINE = false;
// Global upload concurrency cap (oldest message first, no per-room seriality).
export const UPLOAD_MAX_CONCURRENT = 2;
// Bounded exponential backoff per upload task, persisted in
// upload_queue.next_attempt_at (survives restart): 2s, 4s, 8s, 16s, 32s.
// Higher cap than the outbox — upload attempts are expensive.
export const MEDIA_RETRY_BASE_MS = 2000;
export const MEDIA_RETRY_MAX_MS = 60000;
// Transient failures beyond this cap park the whole message (manual retry).
export const MEDIA_MAX_ATTEMPTS = 5;
// Image compression: downscale so max(width, height) ≤ this, re-encode JPEG.
export const MEDIA_IMAGE_MAX_EDGE = 2048;
export const MEDIA_IMAGE_QUALITY = 0.8;
// Sources already JPEG, ≤ max edge AND ≤ this size stage as a plain copy
// (screenshots keep pixel-perfect text; EXIF risk accepted — design §6/§13.5).
export const MEDIA_IMAGE_COPY_THROUGH_BYTES = 500 * 1024;
// Inline micro-thumbnail (base64 data URI in attachments JSON, ~1 KB each).
export const MEDIA_THUMB_EDGE = 32;
export const MEDIA_THUMB_QUALITY = 0.5;
// Per-kind payload caps (client-side validation before staging).
export const MEDIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MEDIA_MAX_VIDEO_DURATION_S = 180;
export const MEDIA_MAX_FILE_BYTES = 50 * 1024 * 1024;
// Disk budgets: outgoing staging (documentDirectory, app-owned) soft cap and
// tapped video/file downloads (cacheDirectory) LRU cap — both swept on boot.
export const MEDIA_STAGING_MAX_BYTES = 256 * 1024 * 1024;
export const MEDIA_DOWNLOAD_CACHE_MAX_BYTES = 256 * 1024 * 1024;
// When a page/delta is applied, Image.prefetch the newest N image URLs
// (roadmap §14 hook — activated with FEATURE_MEDIA_PIPELINE).
export const IMAGE_PREFETCH_COUNT = 10;

// ============================================
// 1:1 Calling (WebRTC over Supabase Realtime signaling)
// ============================================

// Ring for this long before the outgoing call is marked missed
export const CALL_RING_TIMEOUT_MS = 35000;
// Connection-establishment guard: fail the call if media never connects
export const CALL_CONNECT_TIMEOUT_MS = 30000;

// Google public STUN + optional TURN (env-driven, TURN-ready by design).
// Provide EXPO_PUBLIC_TURN_URL/USERNAME/CREDENTIAL to add a relay for
// peers behind symmetric NATs; STUN-only still works for most networks.
export function getIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrl = process.env.EXPO_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.EXPO_PUBLIC_TURN_USERNAME,
      credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return servers;
}
