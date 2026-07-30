import * as Crypto from "expo-crypto";
// SDK 56: legacy subpath keeps the string-URI FS surface (documentDirectory,
// copyAsync, uploadAsync…) used across the media plane.
import * as FileSystem from "expo-file-system/legacy";
import {
  FEATURE_MEDIA_PIPELINE,
  FEATURE_OFFLINE_OUTBOX,
  MEDIA_MAX_ATTEMPTS,
  MEDIA_RETRY_BASE_MS,
  MEDIA_RETRY_MAX_MS,
  UPLOAD_MAX_CONCURRENT,
} from "@/src/lib/constants";
import { supabase } from "@/src/lib/supabase";
import { diag } from "@/src/lib/diagnostics";
import {
  processFile,
  processImage,
  processVideo,
  type StagedMedia,
} from "@/src/lib/imagePipeline";
import { cacheService } from "@/src/services/cacheService";
import { databaseService } from "@/src/services/databaseService";
import { outboxService } from "@/src/services/outboxService";
import { useChatStore } from "@/src/stores/chatStore";
import type {
  MediaAttachmentKind,
  MessageAttachment,
  MessageWithMeta,
  UploadTask,
} from "@/src/types";

/**
 * Media pipeline worker (Phase 7A/7B — design §2, §4, §10, §11).
 *
 * The single owner of the media plane's *when*: it stages/compresses at
 * authoring, drains the durable upload_queue (global FIFO, concurrency cap),
 * applies bounded backoff, parks permanent failures at message level, and —
 * at the completion gate — rewrites attachments local→remote and hands the
 * message to the Phase 5A outbox. It never decides queue *state* — that is
 * `UploadQueueRepository`; and it never touches delivery — after the gate,
 * retry/ACK/dedup are entirely the outbox's (unchanged).
 *
 * Layering mirrors outboxService: persistence only through `cacheService`,
 * store patches via `getState()`, diagnostics passive. The ONLY call into the
 * message plane is `outboxService.poke()` after the gate txn commits.
 *
 * Flag delegation: with `FEATURE_MEDIA_PIPELINE` off (or capabilities unmet —
 * web, cache init failure) every public entry no-ops/returns false, so media
 * sends stay today's legacy `sendAlbumMessage` path byte-for-byte.
 */

// One picked attachment, as handed over by the composer (picker output).
export interface MediaSource {
  uri: string;
  kind: MediaAttachmentKind;
  /** Original filename (kind='file'). */
  name?: string;
  mime?: string;
  /** Playback length from the picker (kind='video'); probing is unavailable. */
  duration_ms?: number;
}

// ---------------------------------------------------------------------------
// Capability gate & staging paths (design §9: L3a lives under documentDirectory
// — the OS must never evict an unsent message's only binary)
// ---------------------------------------------------------------------------

const STAGING_ROOT = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}media/outbox/`
  : null;

// L3c downloads (§9): tapped video/file payloads live under cacheDirectory
// (OS-evictable, always re-fetchable). Only the wipe path touches it here.
const DOWNLOADS_ROOT = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}media/downloads/`
  : null;

function stagingDir(messageId: string): string {
  return `${STAGING_ROOT}${messageId}/`;
}

function isEnabled(): boolean {
  return (
    FEATURE_MEDIA_PIPELINE &&
    // Delivery rides the outbox — the media plane is meaningless without it
    FEATURE_OFFLINE_OUTBOX &&
    STAGING_ROOT != null &&
    // No durable queue (web / init failure) → legacy path (design M12)
    databaseService.repositories != null
  );
}

// ---------------------------------------------------------------------------
// Module state (rebuilt on relaunch — all durable state is in upload_queue)
// ---------------------------------------------------------------------------

// Single-flight per task id: a PUT in flight is never re-picked (M14).
const inFlight = new Set<string>();

// Coalesce overlapping wakeups into one pass (same shape as outboxService).
let draining = false;
let rerun = false;

// One timer, re-armed for the soonest future next_attempt_at.
let timer: ReturnType<typeof setTimeout> | null = null;

// Guards the completion gate per message so a burst of markUploaded events
// can't run two COMPLETING txns concurrently (the txn itself is idempotent —
// this only avoids the redundant work).
const completing = new Set<string>();

// ---------------------------------------------------------------------------
// Error classification (§10.1) — worker policy, not the repository's
// ---------------------------------------------------------------------------

// Marker for errors that can never succeed by retrying (staged file missing…)
interface ClassifiedError extends Error {
  permanent?: boolean;
  status?: number;
}

function permanentError(message: string): ClassifiedError {
  const err = new Error(message) as ClassifiedError;
  err.permanent = true;
  return err;
}

function isPermanent(err: unknown): boolean {
  const e = err as ClassifiedError & { code?: string; statusCode?: number };
  if (e?.permanent === true) return true;

  // Postgres SQLSTATE class: 42xxx (access/RLS), 23xxx (integrity),
  // 22xxx (data/validation) → can't succeed by retrying.
  const code = typeof e?.code === "string" ? e.code : undefined;
  if (
    code &&
    (code.startsWith("42") || code.startsWith("23") || code.startsWith("22"))
  ) {
    return true;
  }

  // HTTP status (storage REST / fetch wrappers): 403 policy, 413 too large,
  // 415 bad MIME → permanent; 408/429 → transient; 5xx → transient.
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 429) return false;
    if (status >= 400 && status < 500) return true;
    return false;
  }

  // Unknown (offline / no code / no status) → transient: safe to retry.
  return false;
}

function errorText(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? String(err);
}

// ---------------------------------------------------------------------------
// Store bridges (RAM annotations only — durable truth is the queue)
// ---------------------------------------------------------------------------

async function publishProgress(messageId: string): Promise<void> {
  const c = await cacheService.getUploadCompletion(messageId);
  if (c.total === 0) {
    useChatStore.getState().setUploadProgress(messageId, null);
    return;
  }
  useChatStore.getState().setUploadProgress(messageId, {
    done: c.uploaded,
    total: c.total,
    failed: c.failed,
  });
}

// Merge remote fields over whatever the RAM row currently shows so
// authoring-only fields (file `name`…) survive — mirrors the repo-side merge.
function patchRamAttachments(
  roomId: string,
  messageId: string,
  attachments: MessageAttachment[]
): void {
  const store = useChatStore.getState();
  const current = store.messages[roomId]?.find((m) => m.id === messageId);
  const existing = Array.isArray(current?.attachments)
    ? (current.attachments as unknown as MessageAttachment[])
    : [];
  const merged = attachments.map((a, i) => ({ ...existing[i], ...a }));
  store.applyAttachmentsPatch(roomId, messageId, merged, merged[0]?.url ?? null);
}

// ---------------------------------------------------------------------------
// Transport (§4.5) — idempotent by deterministic object path (§4.3)
// ---------------------------------------------------------------------------

const BUCKET = "chat-media";

function remotePathFor(task: UploadTask): string {
  const clean = task.local_uri.split("?")[0];
  const dot = clean.lastIndexOf(".");
  const ext = dot === -1 ? "bin" : clean.slice(dot + 1).toLowerCase();
  return `${task.room_id}/${task.message_id}/${task.position}.${ext}`;
}

async function uploadOne(
  task: UploadTask
): Promise<{ path: string; url: string }> {
  const path = remotePathFor(task);

  if (task.kind === "image") {
    // Compressed images are small (≤ ~1 MB class) — the arrayBuffer path is
    // today's proven route with bounded RAM (§14).
    const resp = await fetch(task.local_uri);
    const buffer = await resp.arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: task.mime, upsert: true });
    if (error) throw error;
  } else {
    // Videos/files stream from disk — the blob never materializes in JS RAM.
    // Same Storage REST endpoint the SDK uses; x-upsert matches upsert:true.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("no auth session for upload");
    const endpoint = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
    const result = await FileSystem.uploadAsync(endpoint, task.local_uri, {
      httpMethod: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        "Content-Type": task.mime,
        "x-upsert": "true",
      },
    });
    if (result.status >= 400) {
      const err = new Error(
        `storage upload failed: ${result.status}`
      ) as ClassifiedError;
      err.status = result.status;
      throw err;
    }
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: pub.publicUrl };
}

// ---------------------------------------------------------------------------
// Completion gate (§4.4) — the ONLY media→message-plane hand-off
// ---------------------------------------------------------------------------

async function maybeComplete(messageId: string, roomId: string): Promise<void> {
  if (completing.has(messageId)) return;
  completing.add(messageId);
  try {
    const c = await cacheService.getUploadCompletion(messageId);
    if (c.total === 0 || c.failed > 0 || c.uploaded !== c.total) return;

    const startedAt = Date.now();
    const tasks = await cacheService.listUploadsForMessage(messageId);
    if (tasks.length === 0 || tasks.some((t) => !t.remote_url)) return;

    // Final attachment shape: remote URLs + everything progressive loading
    // needs (dims for the aspect box, inline thumb, kind, size, duration).
    const attachments: MessageAttachment[] = tasks.map((t) => ({
      url: t.remote_url!,
      width: t.width ?? undefined,
      height: t.height ?? undefined,
      kind: t.kind,
      thumb: t.thumb ?? undefined,
      bytes: t.bytes ?? undefined,
      mime: t.mime,
      duration_ms: t.duration_ms ?? undefined,
    }));

    // ONE txn: rewrite attachments/media_url + insert the outbox row (§2.1
    // rule 5). If it fails, nothing was handed off — resume() retries (M5).
    const ok = await cacheService.completeUploadsForMessage(
      messageId,
      attachments
    );
    if (!ok) return;

    // RAM swap: same id → expo-image transitions seamlessly; the staged file
    // stays on disk until SENT so there is zero visual gap (§8).
    patchRamAttachments(roomId, messageId, attachments);
    useChatStore.getState().setUploadProgress(messageId, null);

    diag.observe("media.gate_ms", Date.now() - startedAt);
    diag.count("media.handoff", 1);

    // Delivery begins NOW — the outbox's existing public wake surface.
    outboxService.poke();
  } finally {
    completing.delete(messageId);
  }
}

// ---------------------------------------------------------------------------
// Single-task attempt
// ---------------------------------------------------------------------------

async function runTask(task: UploadTask): Promise<void> {
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);
  diag.gauge("media.inflight", inFlight.size);
  try {
    await cacheService.markUploadUploading(task.id);

    // Staged file gone (user cleared storage / M3 partial) → permanent (M8):
    // the picker URI may be gone too, so delete is the honest affordance.
    const info = await FileSystem.getInfoAsync(task.local_uri);
    if (!info.exists) throw permanentError("staged file missing");

    const startedAt = Date.now();
    const { path, url } = await uploadOne(task);
    diag.observe("media.upload_ms", Date.now() - startedAt, {
      kind: task.kind,
    });

    await cacheService.markUploadUploaded(task.id, path, url);
    await publishProgress(task.message_id);
    await maybeComplete(task.message_id, task.room_id);
  } catch (err) {
    await handleUploadError(task, err);
  } finally {
    inFlight.delete(task.id);
    diag.gauge("media.inflight", inFlight.size);
  }
}

async function handleUploadError(task: UploadTask, err: unknown): Promise<void> {
  const text = errorText(err);

  // Permanent → park the task AND the whole message (§2.1 rule 6). Uploaded
  // siblings keep their objects — a manual retry reuses them as-is.
  if (isPermanent(err)) {
    await cacheService.markUploadFailed(task.id, text);
    useChatStore.getState().markMessageFailed(task.message_id);
    await publishProgress(task.message_id);
    diag.count("media.upload_failed", 1, { class: "permanent" });
    diag.event("media.parked", { id: task.message_id, reason: "permanent" });
    console.error(`[mediaService] permanent failure ${task.id}`, err);
    return;
  }

  // Transient: bump attempts; park once the cap is reached (§10.2).
  const nextAttempts = task.attempts + 1;
  if (nextAttempts >= MEDIA_MAX_ATTEMPTS) {
    await cacheService.markUploadFailed(task.id, text);
    useChatStore.getState().markMessageFailed(task.message_id);
    await publishProgress(task.message_id);
    diag.count("media.upload_failed", 1, { class: "max-attempts" });
    diag.event("media.parked", { id: task.message_id, reason: "max-attempts" });
    console.error(
      `[mediaService] exhausted ${task.id} after ${nextAttempts} attempts`,
      err
    );
    return;
  }

  // Bounded exponential backoff, persisted (survives restart):
  // min(BASE * 2^(n-1), MAX) → 2s, 4s, 8s, 16s, 32s (then park at the cap).
  const delay = Math.min(
    MEDIA_RETRY_BASE_MS * 2 ** (nextAttempts - 1),
    MEDIA_RETRY_MAX_MS
  );
  await cacheService.rescheduleUpload(
    task.id,
    nextAttempts,
    new Date(Date.now() + delay).toISOString(),
    text
  );
  diag.count("media.upload_retry", 1, { reason: "transient" });
  diag.observe("media.backoff.ms", delay);
}

// ---------------------------------------------------------------------------
// Drain (§4.2): global FIFO, concurrency cap, due-check per task
// ---------------------------------------------------------------------------

/**
 * One pass: repeatedly pick up to UPLOAD_MAX_CONCURRENT due tasks
 * (oldest-first; parked messages' remaining tasks skipped) until nothing is
 * due. Returns the soonest future next_attempt_at (feeds the single timer).
 */
async function drainOnce(): Promise<number | null> {
  // Message ids parked mid-pass — their queued siblings must not upload.
  const parked = new Set<string>();

  for (;;) {
    const tasks = await cacheService.listActiveUploads();
    diag.gauge("media.queue_depth", tasks.length);
    if (tasks.length === 0) return null;

    const now = Date.now();
    const due = tasks.filter(
      (t) =>
        !inFlight.has(t.id) &&
        !parked.has(t.message_id) &&
        (t.next_attempt_at == null ||
          new Date(t.next_attempt_at).getTime() <= now)
    );

    const slots = UPLOAD_MAX_CONCURRENT - inFlight.size;
    if (due.length === 0 || slots <= 0) {
      // Nothing runnable now → schedule for the soonest future retry.
      let soonest: number | null = null;
      for (const t of tasks) {
        if (t.next_attempt_at == null || inFlight.has(t.id)) continue;
        const at = new Date(t.next_attempt_at).getTime();
        if (at > now && (soonest == null || at < soonest)) soonest = at;
      }
      return soonest;
    }

    // Skip tasks whose message is already parked (a failed sibling parks the
    // whole message — rule 6); check once per distinct candidate message.
    const runnable: UploadTask[] = [];
    for (const t of due) {
      if (runnable.length >= slots) break;
      if (!parked.has(t.message_id)) {
        const c = await cacheService.getUploadCompletion(t.message_id);
        if (c.failed > 0) {
          parked.add(t.message_id);
          continue;
        }
      }
      runnable.push(t);
    }
    if (runnable.length === 0) continue;

    await Promise.all(runnable.map(runTask));
  }
}

function armTimer(soonestMs: number | null): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (soonestMs == null) return;
  const delay = Math.max(0, soonestMs - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delay);
}

async function drain(): Promise<void> {
  if (draining) {
    rerun = true;
    return;
  }
  draining = true;
  let soonest: number | null = null;
  try {
    do {
      rerun = false;
      soonest = await drainOnce();
    } while (rerun);
  } catch (err) {
    console.error("[mediaService] drain", err);
  } finally {
    draining = false;
    armTimer(soonest);
  }
}

// ---------------------------------------------------------------------------
// Staging (authoring path — §2.1 rules 1–3)
// ---------------------------------------------------------------------------

async function stageOne(
  source: MediaSource,
  dir: string,
  position: number
): Promise<StagedMedia> {
  const startedAt = Date.now();
  // Original bytes (§16 media.bytes_in, pairs with media.bytes_out for the
  // §14 compression-ratio budget). Guarded by the flag so the extra stat is
  // never paid in production — this is the flag check, not a value branch.
  if (diag.enabled()) {
    try {
      const info = await FileSystem.getInfoAsync(source.uri);
      if (info.exists && "size" in info && typeof info.size === "number") {
        diag.count("media.bytes_in", info.size, { kind: source.kind });
      }
    } catch {
      // observability only — never fails the stage
    }
  }
  let staged: StagedMedia;
  switch (source.kind) {
    case "image":
      staged = await processImage(source.uri, dir, position);
      diag.observe("media.compress_ms", Date.now() - startedAt);
      break;
    case "video":
      staged = await processVideo(source.uri, dir, position, source.duration_ms);
      break;
    case "file":
      staged = await processFile(
        source.uri,
        dir,
        position,
        source.name,
        source.mime
      );
      break;
  }
  diag.observe("media.stage_ms", Date.now() - startedAt);
  diag.count("media.bytes_out", staged.bytes);
  return staged;
}

async function removeStagingDir(messageId: string): Promise<void> {
  if (STAGING_ROOT == null) return;
  try {
    await FileSystem.deleteAsync(stagingDir(messageId), { idempotent: true });
  } catch {
    // best-effort — the boot orphan sweep catches leftovers
  }
}

// ---------------------------------------------------------------------------
// Maintenance sweeps (§9, §11.2)
// ---------------------------------------------------------------------------

// Post-ACK cleanup (§2.1 rule 7), run lazily after resume/drain rather than
// event-driven from the outbox ACK — an ACK callback would couple the outbox
// to the media plane (import cycle) for no durability gain.
async function sweepSent(): Promise<void> {
  const ids = await cacheService.listSentUploadMessageIds();
  for (const id of ids) {
    await cacheService.clearSentUploads(id);
    await removeStagingDir(id);
  }
}

// Staging dirs with no queue rows are orphans: M3 partial staging, or dirs
// left behind after a sweep raced a crash. Queue rows are the ownership index.
async function sweepOrphanDirs(): Promise<void> {
  if (STAGING_ROOT == null) return;
  let entries: string[];
  try {
    entries = await FileSystem.readDirectoryAsync(STAGING_ROOT);
  } catch {
    return; // staging root doesn't exist yet
  }
  let swept = 0;
  for (const entry of entries) {
    const tasks = await cacheService.listUploadsForMessage(entry);
    if (tasks.length > 0) continue;
    await removeStagingDir(entry);
    swept += 1;
  }
  if (swept > 0) diag.count("media.orphans_swept", swept);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const mediaService = {
  /** Capability gate: flag + outbox + native FS + durable cache. */
  isEnabled,

  /**
   * Authoring (§2.1 rules 1–3): stage/compress every attachment into the
   * app-owned dir, then persist message row + upload tasks in ONE txn, patch
   * the RAM bubble to the staged URIs, and wake the worker.
   *
   * THROWS on staging/persist failure (M9): the caller owns the optimistic
   * RAM bubble and must remove it — the send fails synchronously at
   * authoring, exactly today's semantics.
   */
  async enqueueMediaMessage(
    message: MessageWithMeta,
    sources: MediaSource[]
  ): Promise<void> {
    if (!isEnabled() || sources.length === 0) {
      throw new Error("media pipeline unavailable");
    }
    const dir = stagingDir(message.id);
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      // One attachment at a time — a single decode in flight (§14).
      const staged: StagedMedia[] = [];
      for (let i = 0; i < sources.length; i++) {
        staged.push(await stageOne(sources[i], dir, i));
      }

      const attachments: MessageAttachment[] = staged.map((s, i) => ({
        url: s.uri,
        width: s.width,
        height: s.height,
        kind: sources[i].kind,
        thumb: s.thumb,
        bytes: s.bytes,
        mime: s.mime,
        name: s.name,
        duration_ms: s.duration_ms,
      }));

      const now = message.created_at ?? new Date().toISOString();
      const tasks: UploadTask[] = staged.map((s, i) => ({
        id: Crypto.randomUUID(),
        message_id: message.id,
        room_id: message.room_id,
        position: i,
        kind: sources[i].kind,
        local_uri: s.uri,
        mime: s.mime,
        bytes: s.bytes,
        width: s.width ?? null,
        height: s.height ?? null,
        duration_ms: s.duration_ms ?? null,
        thumb: s.thumb ?? null,
        remote_path: null,
        remote_url: null,
        state: "queued",
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        created_at: now,
        updated_at: null,
      }));

      // Durability boundary (M3): message row (status='pending', staged
      // attachments) + N queue rows, one txn. Throws when the cache is broken.
      await cacheService.enqueueUploads(
        {
          ...message,
          attachments: attachments as unknown as MessageWithMeta["attachments"],
          media_url: attachments[0]?.url ?? null,
          outbox_status: "pending",
        },
        tasks
      );

      // RAM: picker URIs → staged URIs (+thumbs/dims), progress 0/N.
      patchRamAttachments(message.room_id, message.id, attachments);
      useChatStore.getState().setUploadProgress(message.id, {
        done: 0,
        total: tasks.length,
        failed: 0,
      });

      void drain();
    } catch (err) {
      // Nothing durable may survive a failed authoring: best-effort unstage.
      await removeStagingDir(message.id);
      throw err;
    }
  },

  /**
   * Restart recovery (§11.2, extends 5A §8.1 by one line): revert stale
   * 'uploading' rows, re-run the completion gate for all-uploaded messages
   * (M5), sweep ACKed/orphaned staging, then schedule + drain. Safe to re-run.
   */
  async resume(): Promise<void> {
    if (!isEnabled()) return;
    diag.event("media.resume", {});

    await cacheService.revertStaleUploads();

    // M5: crashed between last markUploaded and the COMPLETING txn.
    const completable = await cacheService.listCompletableUploadMessageIds();
    for (const id of completable) {
      const tasks = await cacheService.listUploadsForMessage(id);
      const roomId = tasks[0]?.room_id;
      if (roomId) await maybeComplete(id, roomId);
    }

    await sweepSent();
    await sweepOrphanDirs();

    // Surface hydrated pending uploads in the footer again.
    const active = await cacheService.listActiveUploads();
    const seen = new Set<string>();
    for (const t of active) {
      if (seen.has(t.message_id)) continue;
      seen.add(t.message_id);
      await publishProgress(t.message_id);
    }

    await drain();
  },

  /**
   * Wake the worker (enqueue, connectivity regained, foreground). Fire-and-
   * forget; coalesced with any in-flight pass.
   */
  poke(): void {
    if (!isEnabled()) return;
    void drain();
  },

  /**
   * Manual retry (§10.3). Returns true when the media plane owns this retry
   * (the message still has un-uploaded/failed tasks); false hands ownership
   * back to the caller's 5A path (no tasks, or already handed off).
   * Only failed tasks reset — a 9/10 album never re-uploads the 9.
   */
  async retryMedia(message: MessageWithMeta): Promise<boolean> {
    if (!isEnabled()) return false;
    const c = await cacheService.getUploadCompletion(message.id);
    if (c.total === 0) return false; // no media plane involvement
    if (c.failed === 0 && c.uploaded === c.total) {
      // Fully uploaded ⇒ already handed off; the failure is delivery-plane —
      // 5A's retry (re-enqueue) owns it.
      return false;
    }
    await cacheService.resetUploadsForRetry(message.id);
    useChatStore.getState().markMessagePending(message.id);
    await publishProgress(message.id);
    diag.count("media.retry", 1);
    void drain();
    return true;
  },

  /**
   * Discard a pending/failed media message. Returns true when the media plane
   * owned it (queue rows existed): removes queue rows + message row + staging
   * dir + any already-uploaded storage objects (best-effort) + a lingering
   * outbox row (post-gate discard). False → caller's 5A/legacy path applies.
   */
  async discardMedia(message: MessageWithMeta): Promise<boolean> {
    if (!isEnabled()) return false;
    const tasks = await cacheService.listUploadsForMessage(message.id);
    if (tasks.length === 0) return false;

    await cacheService.removeUploadsForMessage(message.id);
    // Post-gate discard: the outbox row would otherwise linger (its message
    // row is gone). removeOutbox is a no-op when no row exists.
    await cacheService.removeOutbox(message.id);
    await removeStagingDir(message.id);

    const remotePaths = tasks
      .map((t) => t.remote_path)
      .filter((p): p is string => p != null);
    if (remotePaths.length > 0) {
      // Best-effort: deterministic paths make later cleanup possible anyway.
      void supabase.storage
        .from(BUCKET)
        .remove(remotePaths)
        .catch((err) => console.error("[mediaService] discard objects", err));
    }

    useChatStore.getState().setUploadProgress(message.id, null);
    diag.event("media.discarded", { id: message.id });
    return true;
  },

  /**
   * Logout cleanup (§9): delete the media-owned on-disk tiers — staged outgoing
   * artifacts (documentDirectory) and tapped downloads (cacheDirectory) — so
   * cached plaintext media never survives an account switch (extends 5A's
   * drain-then-wipe by two deleteAsync calls). Best-effort, never throws; a
   * no-op for accounts that never used the pipeline (the dirs are absent).
   */
  async wipe(): Promise<void> {
    const dirs = [STAGING_ROOT, DOWNLOADS_ROOT].filter(
      (d): d is string => d != null
    );
    for (const dir of dirs) {
      try {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      } catch (err) {
        console.error("[mediaService] wipe", err);
      }
    }
  },
};
