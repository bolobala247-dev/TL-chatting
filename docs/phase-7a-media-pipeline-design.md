# Phase 7A — Media Pipeline Architecture (Design)

> **Status:** Design only. No production code in this phase.
> **Roadmap anchor:** Milestone A · **A3 — Image pipeline** (roadmap §9) + the media half of
> Milestone B deferred out of Phase 5A ("Offline media/album/image send survival across restart"
> — Phase 5A §0, §7, §12 F12 explicitly parked it here).
> **Feature flag:** `FEATURE_MEDIA_PIPELINE`.
> **Depends on:** Phase 3 (SQLite cache — `cacheService`, repositories, hydrate-first stores,
> logout wipe); Phase 4 (Incremental Sync — server-clock `updated_at`, `mergeMessageWindow`,
> `sync_state`, `syncService`); Phase 5A (Offline Outbox — client-UUID ids, `outbox` table,
> `outboxService`, `send_message_idempotent`); Phase 6B (Reliability Diagnostics — `diag`
> registry, harnesses, `consistencyAuditor`).
> **Goal of this doc:** be complete enough that Phase 7A can be implemented without any further
> design decisions.

### Requirement → section map

| Requirement | Section |
|---|---|
| 1. Upload Queue | §3 |
| 2. Upload Worker | §4 |
| 3. Media Lifecycle | §2 |
| 4. Image / Video / File architecture | §5 |
| 5. Compression strategy | §6 |
| 6. Thumbnail strategy | §7 |
| 7. Progressive loading | §8 |
| 8. Local cache strategy | §9 |
| 9. Retry strategy | §10 |
| 10. Failure recovery | §11 |
| 11. Offline behavior | §12 |
| 12. Security | §13 |
| 13. Performance budget | §14 |
| 14. Benchmark strategy | §15 |
| 15. Sequence diagrams | §17 |
| 16. Rollout strategy | §18 |
| Diagnostics observation (invariant) | §16 |
| Invariants compliance | §19 |

---

## 0. Problem statement & scope

### What we have today (verified against the repository)

- **Send path (media):** `useMessages.sendAlbum` mints a `temp-${Date.now()}` id, renders an
  optimistic bubble whose `attachments` carry the **picker's local URIs**, then awaits
  `messageService.sendAlbumMessage`: per image `fetch(uri) → arrayBuffer →
  supabase.storage.from("chat-media").upload(`${roomId}/${ts}-${i}.jpg`)` in parallel, then one
  `messages` INSERT with the public URLs. On **any** error the optimistic bubble is removed —
  the media message is lost. Nothing survives an app kill mid-upload.
- **No processing:** originals are uploaded at picker quality 0.8 — no resize, no thumbnail,
  no width/height metadata (roadmap bottleneck **B8**). `src/lib/imagePipeline.ts` from the
  roadmap file plan does **not** exist yet.
- **Storage:** one **public** bucket `chat-media`; object paths are `${roomId}/${timestamp}.jpg`
  (guessable ordering, no message linkage). Cleanup on recall is client best-effort
  (`removeChatMediaObjects`).
- **Outbox (Phase 5A):** queues **text and poll** messages durably; media was explicitly out of
  scope because *"local file URIs are not guaranteed to persist (OS cache eviction) and
  re-upload is a separate concern"*. The `outbox` table (SQLite v3) is a thin index over
  `messages` rows; `outboxService` drains it head-first per room; the idempotency key is the
  client-minted message UUID.
- **SQLite v1 already reserves an `attachments` table** (`message_id, position, url, width,
  height`) that is currently written from the `attachments` JSON on the message row; the domain
  type is `MessageAttachment { url, width?, height? }`.
- **Diagnostics (Phase 6B):** a passive, exception-isolated `diag` registry
  (counters/gauges/histograms/event-ring) plus `benchmarkHarness`, `stressHarness`,
  `chaosHarness`, `consistencyAuditor`, `memoryLeakDetector` — all flag-gated, zero-cost when
  off.
- **Renderers:** `MessageBubble` / `AlbumGrid` already render `attachments[].url` through
  `expo-image` (`memory-disk`, `recyclingKey`) and already tolerate local `file://` URIs (the
  optimistic path uses them today).

### The cost we are removing

1. **Media loss:** an offline or interrupted media send silently disappears (B4 for media).
2. **Original-size payloads:** full-resolution uploads and downloads, no placeholders, layout
   shift on load (B8).
3. **No durability:** app kill mid-upload = lost message + orphaned storage bytes.
4. **No observability:** media operations are invisible to the Phase 6B reliability suite.

### Phase 7A objective

Make an outgoing media message a **durable, idempotent, ordered** unit of work with a
**two-plane pipeline**:

- **Media plane (NEW):** a durable **Upload Queue** + **Upload Worker** that stage, compress,
  thumbnail, and upload attachment binaries — independent of the Outbox.
- **Message plane (UNCHANGED):** the Phase 5A Outbox delivers the message **row** exactly as it
  delivers text today — but a media message is handed to the Outbox **only after every one of
  its attachments has finished uploading**.

And make incoming media **progressive**: reserved aspect-ratio boxes, inline thumbnails, cached
full assets — without changing the rendering flow (same components, same store, additive data).

### In scope

- Client media processing: resize/compress (images), poster + caps (video), passthrough (files).
- Durable **`upload_queue`** (SQLite migration v4) + **`UploadQueueRepository`**.
- **`mediaService`** (staging + coordinator) and its **upload worker** (mirrors
  `outboxService`'s shape: single-flight, bounded backoff, wakeups, `resume()`).
- Deterministic, idempotent storage object paths keyed by `messageId/position`.
- Attachment metadata enrichment: `width/height/thumb/kind/bytes/mime` riding in the existing
  `attachments` JSON (no server schema migration for messages).
- Local media cache tiers, staging directory, GC, byte budgets.
- Storage hardening: bucket write RLS by room membership, MIME/size limits, EXIF stripping.
- Passive `media.*` diagnostics taps + auditor/harness extensions (observe-only).
- Everything behind `FEATURE_MEDIA_PIPELINE` (flag off ⇒ byte-identical to today).

### Explicitly OUT of scope (hard constraints)

- ❌ Any change to `syncService`, cursors, `mergeMessageWindow`, realtime channels, or the
  Phase 4 delta flow (Invariant: *existing synchronization architecture must not change*).
- ❌ Any change to the Phase 5A outbox internals (schema, drain algorithm, RPC). The outbox
  gains **zero** new columns; media integrates by *enqueueing later*, not by changing it.
- ❌ Client-side **video transcoding** (no Expo-first-party transcoder; caps + passthrough in
  7A; transcode is a flagged 7B follow-up).
- ❌ Private bucket / signed-URL delivery (changes the rendering flow — forbidden by invariant;
  documented as the 7B security follow-up, §13.6).
- ❌ Resumable (TUS) uploads (whole-object retry with size caps in 7A; TUS noted in §20).
- ❌ In-chat media editing (crop/draw), voice notes, stickers.
- ❌ Changing public store/hook API surfaces consumed by screens (additive only).

### New dependencies (PREP-gated)

Per the roadmap PREP hard rule (native deps land in a dedicated zero-behavior-change PR + new
dev client **before** any feature work):

| Package | Why | SDK 56 status |
|---|---|---|
| `expo-image-manipulator` | resize / re-encode / EXIF-strip / thumbnails | first-party (already planned in roadmap PREP) |
| `expo-file-system` | staging copies, streamed `uploadAsync`, cache GC | first-party |
| `expo-video-thumbnails` | video poster frame extraction | first-party |

No other new dependency. `expo-crypto` (UUIDs) and `expo-sqlite` are already present.

---

## 1. Architecture

### 1.1 Two planes, one coupling point

```
 useMessages.sendAlbum / sendFile / sendVideo (flag-gated)          ── unchanged public API
        │ enqueueMediaMessage(payload, localUris)
        ▼
┌───────────────────────────── mediaService (NEW) ─────────────────────────────────┐
│ MEDIA PLANE                                                                       │
│  1. mint message UUID (same rule as 5A)                                           │
│  2. stage: copy → app-owned dir; compress; thumb; probe w/h  (per attachment)     │
│  3. persist: messages row (status='pending', local URIs)  +  upload_queue rows    │
│  4. worker: upload staged files (concurrency-capped, backoff, idempotent paths)   │
│  5. completion gate: ALL attachments UPLOADED →                                   │
│        rewrite attachments JSON (local → remote URLs)                             │
│        THEN cacheService.enqueueOutbox(message)   ←── the ONLY coupling point     │
└───────────────────────────────────────────────────────────────────────────────────┘
                                                     │
        MESSAGE PLANE (Phase 5A, byte-for-byte unchanged)
                                                     ▼
                outbox table → outboxService → send_message_idempotent RPC → SENT
                                                     │
                realtime echo / delta sync / mergeMessageWindow (Phase 4, unchanged)
```

**Why the Upload Queue is independent of the Outbox (invariant, and the right call):**

| Concern | Outbox (message rows) | Upload Queue (binaries) |
|---|---|---|
| Payload | ~1 KB JSON row | 0.1–100 MB blobs |
| Ordering | strict FIFO per room (head-first) | unordered; global concurrency cap |
| Retry economics | cheap, aggressive (2 s base) | expensive; longer cap, fewer attempts |
| Idempotency key | message UUID = server PK | deterministic object path (upsert) |
| Failure blast radius | blocks its room's queue | blocks only its own message |
| Terminal ACK | server row returned | storage object exists |

A stuck 80 MB video must never block a room's text queue; conversely a room blocked on a
failing text head must not stall unrelated uploads. Two queues with one hand-off edge give
that isolation *by construction*. While uploads run, the media message has **no outbox row**,
so `outboxService` cannot see it — *upload completion strictly precedes message delivery*
(invariant #2) without touching the outbox drain algorithm.

### 1.2 Layering (Phase 3/4/5A layering; one worker + one table added)

```
   Screen (app/) ── useMessages (sendAlbum / retryMedia / discardMedia) ── unchanged API
                              │
                    Memory Store (Zustand)                ← single source of truth for render
              chatStore.messages[roomId]  (media msg = normal row, local URIs → remote URLs)
              chatStore.uploadProgress[messageId]         (client-only annotation, additive)
                              ▲              │
              status patches  │              │ stage / markUploaded / markFailed
                              │              ▼
   ┌──────────────────────────┴────────── mediaService ───────────────────────────┐
   │ staging · compression · upload worker · completion gate · GC     (NEW)       │
   └──────┬──────────────────────────────┬─────────────────────────┬──────────────┘
   durable│ (via cacheService)     binary│ upload            enqueue│ on completion
   ┌──────▼─────────┐        ┌───────────▼──────────┐   ┌───────────▼───────────┐
   │ cacheService   │        │ Supabase Storage      │   │ outboxService (5A)     │
   │ repositories   │        │ bucket: chat-media    │   │ send_message_          │
   │ + UploadQueue  │ (NEW)  │ path: room/msg/pos    │   │ idempotent (unchanged) │
   │   Repo         │        └───────────────────────┘   └────────────────────────┘
   └──────┬─────────┘
   ┌──────▼─────────┐        ┌────────────────────────────────────────────────────┐
   │ SQLite (WAL)   │        │ FileSystem (app-owned dirs)                         │
   │ upload_queue   │ (NEW)  │  media/outbox/<msgId>/<pos>.<ext>   (staging)       │
   │ messages(status)│       │  media/downloads/…                  (video/file L3) │
   └────────────────┘        └────────────────────────────────────────────────────┘
```

**Key rules preserved:** the memory store is the only render source (a pending media message
*is* a `messages` row with local-URI attachments — `AlbumGrid` renders it today already);
SQLite is persistence only; the upload queue is read only by the worker to orchestrate, never
by the UI. Repository ownership is unchanged — one **new** repository is added, no existing
repository gains or loses responsibility (invariant #4). Rendering flow is unchanged — same
components, same props; progress is an additive client-only annotation (invariant #5).

### 1.3 New / changed components at a glance

| Component | Type | Responsibility |
|---|---|---|
| `src/services/mediaService.ts` | **NEW** | Staging (copy/compress/thumb), enqueue, upload worker (single-flight, concurrency cap, backoff, wakeups, `resume()`), completion gate → outbox hand-off, retry/discard, staging GC, flag delegation. Mirrors `outboxService`'s shape. |
| `src/lib/imagePipeline.ts` | **NEW** | Pure processing helpers: `processImage(uri) → {stagedUri, width, height, bytes, thumb}`, `processVideo(uri)`, `probeFile(uri)`. No store/service imports (roadmap §16 file plan). |
| `UploadQueueRepository` — `createUploadQueueRepository` in `repositories/sqlite.ts` (+ interface in `types.ts`) | **NEW** | Durable upload-task state: enqueue (txn with the message row), list (ordered), state transitions, backoff bookkeeping, per-message completion check, remove/clear. Owns *persisted* queue state only — no network/timers (same split as `OutboxRepository`). |
| SQLite migration v4 | **NEW** | `upload_queue` table (§3.2). |
| `cacheService` | **+ methods** | Never-throw wrappers: `enqueueUploads`, `listUploads`, `markUploadState`, `rescheduleUpload`, `completeUploadsForMessage`, `removeUploadsForMessage` — 1:1 over the repository surface the worker uses. |
| `chatStore` | **+ annotation** | `uploadProgress: Record<messageId, {done, total, failed}>` (client-only, additive); reuses 5A `outbox_status='pending'` for the bubble state. |
| `useMessages` | **behavior swap (flagged)** | `sendAlbum` → `mediaService.enqueueMediaMessage`; add `retryMedia` / `discardMedia`. Flag off delegates to today's exact path. |
| `messageService` | **unchanged send** | `sendAlbumMessage` kept verbatim for the flag-off path. Media messages under the flag ride the existing 5A `sendMessageIdempotent`. |
| Supabase migration 000NN | **NEW** | Storage hardening: bucket size/MIME limits, INSERT policy by room membership + path shape (§13). Additive, no RPC change. |
| `constants.ts` | **+ constants** | `FEATURE_MEDIA_PIPELINE` + tuning constants (§14.3). |
| Renderers (`MessageBubble`, `AlbumGrid`) | **additive props only** | Reserved aspect box from `width/height`, `placeholder` from `thumb`, optional progress ring from `uploadProgress`. Absent fields ⇒ today's behavior (old messages degrade gracefully). |
| App bootstrap | **hook** | `mediaService.resume()` after DB init + auth, right beside `outboxService.resume()`. |

---

## 2. Media message lifecycle

State lives in `upload_queue.state` per attachment; the **message-level** state is derived
(all-uploaded / any-failed) plus the 5A `messages.status`. Projected to RAM as
`outbox_status` + `uploadProgress` for render.

```
        user picks media, hits send
              │ id = Crypto.randomUUID()   (final message id — 5A rule, no temp-)
              ▼
        ┌──────────┐  per attachment: copy → app dir, compress, thumb, probe w/h
        │ STAGING  │  (off the UI thread; bubble already rendered from picker URIs)
        └────┬─────┘
             │ one SQLite txn: messages row (status='pending', local URIs)
             │                 + N upload_queue rows (state='queued')
             ▼
        ┌──────────┐ worker picks task  ┌───────────┐  storage PUT ok   ┌──────────┐
        │  QUEUED  │───────────────────►│ UPLOADING │──────────────────►│ UPLOADED │ (per task)
        └────┬─────┘                    └─────┬─────┘                   └────┬─────┘
             │                                │ transient error:             │
             │                                │ attempts<MAX → backoff,      │ ALL tasks of the
             │                                │ back to QUEUED               │ message UPLOADED?
             │                                │ permanent / exhausted        ▼
             │                                ▼                    ┌────────────────┐
             │                          ┌──────────┐               │  COMPLETING    │ one txn:
             │  user taps retry ───────►│  FAILED  │               │ rewrite        │ attachments
             │  (attempts reset)        │ (parked) │               │ local→remote,  │ JSON + enqueue
             │                          └────┬─────┘               │ outbox row     │
             │                               │ user taps delete    └───────┬────────┘
             │                               ▼                             ▼
             │                        message + queue rows +      ── Phase 5A outbox ──
             │                        staged files + uploaded     PENDING → SENT (unchanged)
             │                        objects removed (best-              │
             │                        effort remote)                      ▼ post-ACK
             └──────────────────────────────────────────────────  staging files GC'd
```

### 2.1 Lifecycle rules

1. **The id never changes.** Message UUID minted at authoring; used for the SQLite row, every
   storage object path, the outbox row, the RPC, the echo, the merge — the 5A idempotency
   spine extended into storage.
2. **`created_at` is the authoring instant**, stamped through the same per-room monotonic
   guard as 5A §6.3. Uploads may take minutes; the timeline position is fixed at authoring.
   Delivery order vs. later text messages is therefore *not* FIFO across kinds (a slow album
   does **not** block texts — deliberate, matches Telegram; §12.3).
3. **Enqueue is atomic + durable:** message row + all `upload_queue` rows commit in one
   transaction (`withExclusiveTransactionAsync`), *after* staging succeeded. The message is on
   screen and on disk with app-owned file copies before any network attempt.
4. **No outbox row exists until COMPLETING.** The outbox cannot deliver a message whose media
   is not fully uploaded — invariant #2 holds structurally, not by timing.
5. **COMPLETING is one transaction:** rewrite `attachments` JSON (+ `media_url` = first
   attachment URL, today's convention) on the `messages` row **and** insert the outbox row.
   Crash between upload-done and this txn ⇒ `resume()` re-runs the completion gate (uploads
   are verifiable: every task row is `state='uploaded'` with `remote_url` set).
6. **FAILED is message-level parking:** one permanently-failed attachment parks the whole
   message (partial albums are never sent). Rendered via the existing 5A affordance:
   "Gửi lỗi · Thử lại / Xóa". Retry resets only the failed tasks' attempts.
7. **SENT cleans up:** after the outbox ACK flips `status='sent'` (5A path), `mediaService`
   deletes `media/outbox/<msgId>/` and the message's `upload_queue` rows (they are terminal;
   kept until SENT only so a pre-ACK crash can re-verify the gate — rule 5).
8. **Discard of a pending media message:** remove queue rows + staged dir + message row (RAM
   + SQLite) and best-effort `storage.remove` of any already-uploaded objects (same
   "orphaned file only wastes storage" stance as `removeChatMediaObjects`).

---

## 3. Upload Queue

### 3.1 Storage model — "the message is the payload; the upload queue is the binary work list"

Mirrors 5A's proven shape: the media message is a **real `messages` row** (hydrates & renders
after restart with zero special-casing, local URIs intact); `upload_queue` holds one row per
attachment — the unit of upload work, retry, and progress.

### 3.2 Schema — SQLite migration v4 (append-only, `toVersion = 4`)

```sql
-- src/db/migrations.ts : MIGRATION_004_UPLOAD_QUEUE
CREATE TABLE IF NOT EXISTS upload_queue (
  id              TEXT PRIMARY KEY NOT NULL,   -- task UUID (not the message id)
  message_id      TEXT NOT NULL,               -- owning messages.id (client UUID)
  room_id         TEXT NOT NULL,
  position        INTEGER NOT NULL,            -- attachment index within the message
  kind            TEXT NOT NULL,               -- 'image' | 'video' | 'file'
  local_uri       TEXT NOT NULL,               -- staged copy under media/outbox/ (app-owned)
  mime            TEXT NOT NULL,
  bytes           INTEGER,                     -- staged (post-compression) size
  width           INTEGER,                     -- images/videos (aspect box)
  height          INTEGER,
  duration_ms     INTEGER,                     -- videos
  thumb           TEXT,                        -- base64 data-URI micro thumbnail (§7)
  remote_path     TEXT,                        -- storage object path once PUT succeeds
  remote_url      TEXT,                        -- public URL once PUT succeeds
  state           TEXT NOT NULL DEFAULT 'queued',
                                               -- 'queued' | 'uploading' | 'uploaded' | 'failed'
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,                        -- ISO-8601; null = due now
  last_error      TEXT,                        -- diagnostics only
  created_at      TEXT NOT NULL,               -- authoring instant (global FIFO key)
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_queue_message ON upload_queue (message_id, position);
CREATE INDEX IF NOT EXISTS idx_upload_queue_scan    ON upload_queue (state, created_at);
```

- Same droppable-cache lifecycle as everything else (wiped on logout with the DB file; logout
  interaction in §12.4).
- `messages.status` needs **no new value**: a media message pending upload is simply
  `status='pending'` with no outbox row — exactly the 5A vocabulary. Whether it is
  "uploading" vs "delivering" is derivable (has queue rows ⇒ uploading; has outbox row ⇒
  delivering) and surfaces in RAM as `uploadProgress`.

### 3.3 Enumeration & ordering

```
listActive():
  SELECT * FROM upload_queue
  WHERE state IN ('queued','uploading')        -- 'uploading' rows are stale after a crash; §11.2
  ORDER BY created_at ASC, position ASC        -- oldest message first, attachments in order
```

- **Global FIFO by authoring time, no per-room seriality.** Uploads are commutative (they
  target distinct objects); ordering only decides *fairness* (oldest message's attachments
  first), and the concurrency cap (§4.2) decides parallelism. `failed` rows are parked and
  skipped (message-level parking, §2.1 rule 6).
- The worker applies the due-check (`next_attempt_at`) per task at pick time; the soonest
  future `next_attempt_at` feeds the single re-arm timer (same pattern as 5A §3.4).

### 3.4 `UploadQueueRepository` (interface in `repositories/types.ts`)

```
interface UploadQueueRepository {
  enqueueMessageWithUploads(message: MessageWithMeta, tasks: UploadTask[]): Promise<void>;
      // messages upsert (status='pending') + N upload_queue inserts, ONE txn (§2.1 rule 3)
  listActive(): Promise<UploadTask[]>;                    // §3.3 ordering; worker drain + resume
  markUploading(id: string): Promise<void>;
  markUploaded(id: string, remotePath: string, remoteUrl: string): Promise<void>;
  reschedule(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;   // permanent / exhausted → parked
  resetForRetry(messageId: string): Promise<void>;        // failed tasks → queued, attempts=0
  getMessageCompletion(messageId: string): Promise<{ total: number; uploaded: number; failed: number }>;
  completeMessage(messageId: string, rewrittenAttachments: MessageAttachment[]): Promise<void>;
      // rewrite messages.attachments/media_url + INSERT outbox row, ONE txn (§2.1 rule 5)
  removeForMessage(messageId: string): Promise<void>;     // discard: queue rows + message row, one txn
  clearSent(messageId: string): Promise<void>;            // post-ACK cleanup (§2.1 rule 7)
  clear(): Promise<void>;                                 // logout parity
}
// UploadTask = one upload_queue row (domain-mapped)
```

- **Owns persisted queue state and the atomic transitions** — including the completion-gate
  transaction, because it spans `messages` + `outbox` + `upload_queue` rows and row↔domain
  mapping lives in `sqlite.ts` (the same reason `OutboxRepository` is co-located there). It
  does **not** know about networks, timers, compression, or retry policy — that is
  `mediaService`. Repository ownership of existing repos is untouched: `MessageRepository`,
  `OutboxRepository`, `SyncStateRepository` keep their exact 5A surfaces; `completeMessage`
  reuses the same file-private SQL helpers rather than re-owning them.

### 3.5 Why not reuse the outbox table with a `kind='media'`

Rejected. It would (a) force media semantics (parallelism, per-attachment progress, byte
budgets, storage paths) into the outbox's strict per-room head-first FIFO — a slow video would
block the room's texts or require special-casing the drain algorithm, violating "outbox
internals unchanged"; (b) couple two different retry economies; (c) violate the stated
invariant outright. The two-table design keeps each queue's algorithm trivial.

---

## 4. Upload Worker

### 4.1 Shape (mirrors `outboxService`)

`mediaService` owns *when* to attempt. In-memory: a `Set<taskId>` single-flight guard, a
`draining` coalescing flag, one re-arm timer for the soonest `next_attempt_at`. All state that
must survive restart lives in `upload_queue` (attempts, schedule, states).

### 4.2 Drain pass

```
drainOnce():
  tasks = listActive(), skip ids in single-flight set
  due   = tasks where next_attempt_at is null or <= now
  run up to UPLOAD_MAX_CONCURRENT (2) due tasks at once (global cap, oldest first)
  per task:
    markUploading(id)
    verify staged file exists (FileSystem.getInfoAsync)   -- missing ⇒ permanent fail (§10.2)
    PUT to storage at the deterministic path (§4.3)
    ok        → markUploaded(id, path, url) → completion check (§4.4)
    transient → reschedule(attempts+1, now+backoff)       -- §10.1
    permanent → markFailed(id) → park message (§2.1 rule 6)
  re-arm timer for soonest future next_attempt_at
```

**Wakeup triggers** (identical set to 5A §3.4): enqueue poke; connectivity-regained (the same
reconnect signal `useRealtime`/`outboxService` observe); AppState `'active'`; the single timer.
Uploads run only while the app is foregrounded (Expo-managed background transfer is out of
scope; an interrupted upload simply resumes on next foreground — idempotent, §4.3).

### 4.3 Idempotent by object path (the storage-plane analog of the 5A UUID)

```
remote_path = `${roomId}/${messageId}/${position}.${ext}`
upload(..., { contentType: mime, upsert: true })
```

- Deterministic path + `upsert: true` ⇒ a retried PUT (including a missed-ACK re-drive after a
  crash) **overwrites the same object** — never a duplicate, never an orphan variant. The
  "three ways a send resolves" property of 5A §4.3 holds for binaries too.
- The path embeds the message id ⇒ recall/discard cleanup can derive every object from the
  message row alone (extends today's `collectChatMediaPaths`), and server-side policies can
  validate the path shape (§13.3).

### 4.4 Completion gate

After every `markUploaded`:

```
{total, uploaded, failed} = getMessageCompletion(messageId)
if failed > 0            → already parked; do nothing
if uploaded === total    → build final MessageAttachment[] (remote urls + width/height/thumb)
                           completeMessage(messageId, attachments)   // one txn: rewrite + outbox row
                           chatStore: swap the RAM row's attachments to remote URLs (same id
                                      → expo-image transitions seamlessly; local file still
                                      on disk until SENT so there is zero visual gap)
                           outboxService.poke()                      // delivery begins NOW
```

The hand-off is the **only** call from the media plane into the message plane, and it is the
existing public enqueue surface — `outboxService`/repository internals unchanged.

### 4.5 Transport per kind

| Kind | Transport | Why |
|---|---|---|
| image (≤ `MEDIA_MAX_IMAGE_BYTES` post-compress) | `fetch(stagedUri) → arrayBuffer → supabase.storage.upload` | today's proven path; bounded RAM (§14) |
| video / file (up to 100 MB) | `FileSystem.uploadAsync(storageObjectUrl, stagedUri, { httpMethod: 'POST', headers: { Authorization, apikey, 'x-upsert': 'true' } })` | streams from disk — never materializes the blob in JS RAM |

Both hit the same Storage REST endpoint the SDK uses; the streamed path is required to keep
the §14 memory budget for large files.

---

## 5. Image / Video / File architecture

### 5.1 One attachment model, per-kind processors

The domain type `MessageAttachment` is extended **additively** (client + `attachments` JSON
only — no server schema change; old messages simply lack the new fields):

```ts
interface MessageAttachment {
  url: string;                      // existing
  width?: number; height?: number;  // existing (finally populated)
  kind?: 'image' | 'video' | 'file';// NEW — absent ⇒ 'image' (today's only album kind)
  thumb?: string;                   // NEW — base64 data-URI micro thumbnail (§7)
  bytes?: number;                   // NEW — payload size (file bubble label, budgets)
  mime?: string;                    // NEW
  name?: string;                    // NEW — original filename (files)
  duration_ms?: number;             // NEW — videos
}
```

The SQLite v1 `attachments` table gains no columns — it stores what it stores; the enriched
JSON on the message row remains the authoritative denormalized shape (Phase 3 rule).

### 5.2 Per-kind pipeline

| Stage | Image | Video | File |
|---|---|---|---|
| message `type` | `"image"` (unchanged; albums as today) | `"video"` *(additive CHECK-constraint value, §5.3)* | `"file"` (exists in schema today) |
| Validate | decodable; count ≤ 10/album | `duration ≤ MEDIA_MAX_VIDEO_DURATION_S`, `bytes ≤ MEDIA_MAX_VIDEO_BYTES` | `bytes ≤ MEDIA_MAX_FILE_BYTES`; name sanitized |
| Stage (copy to app dir) | ✔ (compressed output *is* the staged copy) | ✔ raw copy | ✔ raw copy |
| Compress | resize + re-encode (§6) | **none in 7A** (caps only) | none |
| Thumb | 32 px inline data-URI | poster frame → 32 px data-URI (`expo-video-thumbnails`) | none (icon by extension) |
| Metadata | width/height from manipulator output | width/height/duration from probe | bytes/name/mime |
| Upload | arrayBuffer path | streamed `uploadAsync` | streamed `uploadAsync` |
| Render (recv) | AlbumGrid: reserved box + thumb + full (§8) | reserved box + poster thumb + play badge; playback fetches on demand | file bubble: icon, name, size; tap → download to L3 (§9) |

### 5.3 Server prerequisite (one additive migration line)

`messages.type` CHECK constraint today allows `text | image | file | system` (+ later
additions like `poll`). Adding `'video'` is one additive `ALTER ... DROP CONSTRAINT/ADD
CONSTRAINT` in the 000NN migration. Rendering falls back to the file bubble for unknown types
on old clients (verified behavior of the existing `MessageBubble` default branch — degrade,
don't crash).

---

## 6. Compression strategy

**Images** (`expo-image-manipulator`, executed during STAGING, one at a time — §14 memory):

```
input  → downscale so max(width, height) ≤ MEDIA_IMAGE_MAX_EDGE (2048)
       → re-encode JPEG quality MEDIA_IMAGE_QUALITY (0.8)
       → output written to media/outbox/<msgId>/<pos>.jpg   (staged copy = compressed artifact)
```

- Re-encoding **strips EXIF/GPS** as a side effect — a security requirement, not just a size
  win (§13.5).
- Typical result: a 12 MP / 4–6 MB HEIC/JPEG → ~300–600 KB (measured class, to be confirmed by
  the §15 benchmark). Never upscale; skip re-encode only when the source is already JPEG **and**
  ≤ max edge **and** ≤ 500 KB (then stage a plain copy — still strips nothing, so small
  screenshots keep pixel-perfect text; EXIF risk on this path is accepted for screenshots-class
  images and noted in §13.5).
- PNG stays PNG only when it has alpha; otherwise JPEG (albums are photos in practice).
- **Videos: no transcode in 7A.** Enforce caps (`MEDIA_MAX_VIDEO_BYTES` 100 MB,
  `MEDIA_MAX_VIDEO_DURATION_S` 180); over-cap → inline validation error under the composer
  (Vietnamese, no `Alert.alert` per project rule). Client transcode requires a non-Expo native
  dep (`react-native-compressor` class) — deferred to 7B with its own PREP gate (§20).
- **Files: passthrough**, cap `MEDIA_MAX_FILE_BYTES` (50 MB).
- Optional WebP re-encode (~30 % smaller) stays a separately-flagged follow-up as the roadmap
  already notes — not in 7A.

---

## 7. Thumbnail strategy

Telegram-style inline micro-thumbnails, riding **in the `attachments` JSON** — zero schema
migration, zero extra network round trip, zero extra storage object:

```
staged image (or video poster frame)
  → expo-image-manipulator resize max edge MEDIA_THUMB_EDGE (32 px) → JPEG q0.5
  → base64 data URI, ~0.5–1.5 KB
  → attachments[i].thumb
```

- **Send side:** thumb is generated during STAGING and is part of the message row from the
  first optimistic paint — the recipient's bubble and the sender's restart-hydrated bubble both
  paint it with zero network.
- **Receive side:** `expo-image` `placeholder={thumb}` + `placeholderContentFit="cover"` +
  short cross-fade; the reserved aspect box comes from `width`/`height` (§8).
- **Budget guard:** a 10-image album adds ≤ ~15 KB to the message row — within PostgREST/
  realtime payload norms; `MEDIA_THUMB_EDGE` is the single tuning knob if measurement says
  otherwise.
- No server-generated thumbnail variants in 7A (Supabase image transformation is paid-tier;
  roadmap already chose client-side). Full-size objects remain the only stored variant.
- Old messages without `thumb` degrade to exactly today's rendering.

---

## 8. Progressive loading

The rendering **flow** is unchanged (store → `MessageList` → `MessageBubble`/`AlbumGrid` →
`expo-image`); the pipeline only enriches the data those components already consume:

```
1. Bubble reserves the exact aspect-ratio box from width/height
      → zero layout shift; maintainVisibleContentPosition stays stable (roadmap §9 critical note)
2. placeholder = attachments[i].thumb (inline data URI — paints in the same frame, no network)
3. Full image: expo-image, cachePolicy="memory-disk", recyclingKey (all as today)
4. Prefetch: when a message page/delta is applied, Image.prefetch() the newest
   IMAGE_PREFETCH_COUNT (10) image URLs (roadmap §14 hook; flag-gated with the pipeline)
5. Video: poster (thumb) + play badge; the payload is fetched only on tap → L3 download (§9)
6. File: no auto-download; tap → download with per-message progress; open via OS share sheet
```

Sender's own bubble is progressive in reverse: local staged URI paints instantly → after
COMPLETING the row swaps to remote URLs (same component, same id, `recyclingKey` unchanged;
the staged file remains on disk until SENT so the swap is visually seamless).

---

## 9. Local cache strategy

Extends the Phase 3 three-tier table with an explicit media tier map:

| Tier | Store | Contents | Bound | Eviction |
|---|---|---|---|---|
| L1 RAM | Zustand | message rows incl. attachment metadata + `uploadProgress` map | existing window/LRU caps | existing (unchanged) |
| L2 SQLite | `messages.attachments` JSON, `upload_queue` | metadata + queue bookkeeping only — **never binaries** | existing prune rules | existing + §2.1 rule 7 cleanup |
| L3a Staging (NEW) | `FileSystem.documentDirectory + 'media/outbox/<msgId>/'` | outgoing staged/compressed artifacts | `MEDIA_STAGING_MAX_BYTES` (256 MB) soft cap | deleted at SENT / discard; boot sweep removes dirs with no matching pending message (orphans from crashes) |
| L3b Image cache | expo-image disk cache | incoming full images + posters | expo-image internal LRU | internal; `Image.clearDiskCache()` on logout (existing) |
| L3c Downloads (NEW) | `FileSystem.cacheDirectory + 'media/downloads/'` | tapped video/file payloads | `MEDIA_DOWNLOAD_CACHE_MAX_BYTES` (256 MB) | LRU by file mtime, swept on boot (deferred task); OS may also purge `cacheDirectory` freely — re-download is always possible |

Decisions:

- **Staging lives under `documentDirectory`** (not `cacheDirectory`): the OS must not evict an
  unsent message's only binary — this is precisely the gap that forced 5A to exclude media.
  Copying at authoring time also immunizes against photo-picker URI expiry.
- **Downloads live under `cacheDirectory`**: they are always re-fetchable; let the OS help.
- **No binary bytes in SQLite** (BLOB columns rejected — §20): the DB stays a cheap, droppable
  metadata cache; a schema-version wipe never destroys unsent media (staging dir is keyed by
  message id, and the boot sweep only deletes dirs whose message row is *absent or sent*).
- **Logout:** best-effort outbox drain already runs (5A §8.3) — media messages still uploading
  at logout are dropped **with** the account's data (expected); wipe removes DB + staging +
  downloads + `Image.clearDiskCache()` (extends the existing wipe by two `deleteAsync` calls).

---

## 10. Retry strategy

### 10.1 Error classification (worker policy — `mediaService`, not the repository)

| Class | Examples | Action |
|---|---|---|
| Transient | network offline, timeout, 5xx, storage 429/`quota temporarily exceeded`, socket reset | `attempts++`, `next_attempt_at = now + delay`, stay `queued` |
| Permanent | 403 (RLS/policy), 413 / bucket size limit, invalid MIME rejected by bucket, **staged file missing**, malformed source | task → `failed` immediately → message parked (§2.1 rule 6) |

### 10.2 Backoff (per task, persisted — survives restart)

```
MEDIA_RETRY_BASE_MS = 2000
MEDIA_RETRY_MAX_MS  = 60000          # higher cap than outbox: attempts are expensive
MEDIA_MAX_ATTEMPTS  = 5              # 2s, 4s, 8s, 16s, 32s → then parked
delay(n) = min(MEDIA_RETRY_BASE_MS * 2^(n-1), MEDIA_RETRY_MAX_MS)
```

- Retry re-PUTs the **same deterministic path with `upsert:true`** — a lost 200 (missed ACK)
  re-drive overwrites the identical object; no duplicate, no orphan (§4.3).
- Manual retry (`retryMedia(messageId)`) resets only failed tasks (`resetForRetry`), reuses
  already-`uploaded` siblings as-is — a 9/10 album never re-uploads the 9.
- Message-plane retries after hand-off are entirely 5A's (unchanged policy, unchanged code).

---

## 11. Failure recovery

### 11.1 Failure matrix

| # | Scenario | Behavior |
|---|---|---|
| M1 | No network at send | Stage + persist; bubble "đang gửi" with progress 0/N; worker waits for reconnect wake. Nothing lost. |
| M2 | Network drops mid-PUT | Transient → backoff → re-PUT same path (idempotent overwrite). |
| M3 | App killed during STAGING (before the enqueue txn) | Nothing persisted → optimistic RAM bubble gone on relaunch (identical to today's pre-network window); partial staged files removed by the boot orphan sweep. Accepted: the durability boundary is the enqueue txn, reached within ~1 s of send (§14). |
| M4 | App killed while QUEUED/UPLOADING | Rows + staged files persist → hydrate paints the pending bubble → `resume()`: stale `uploading` rows revert to `queued` (single-flight set is RAM-only, same as 5A §8.2) → drain. |
| M5 | App killed between last `markUploaded` and the COMPLETING txn | `resume()` runs the completion gate for every message with all-uploaded tasks → rewrite + outbox enqueue happen then. Deterministic paths make any re-verify PUT harmless. |
| M6 | App killed after COMPLETING, before outbox ACK | Pure 5A territory: outbox `resume()` re-drives `send_message_idempotent` → no duplicate (5A F3/F4). |
| M7 | One attachment permanently fails (413/403) | Task `failed` → message parked → "Gửi lỗi · Thử lại / Xóa"; already-uploaded siblings retained for retry; discard removes objects best-effort. |
| M8 | Staged file missing (user cleared app storage / M3 partial) | Permanent fail → parked; retry from the original picker URI is impossible (it may be gone) — delete is the honest affordance. |
| M9 | Storage full while staging | Staging throws → send fails **synchronously at authoring** with an inline error; no queue rows written; RAM bubble removed (today's semantics). `cacheService` never-throw rule intact (staging is not a cache write). |
| M10 | Realtime echo / delta arrives for the media message | Same id ⇒ 5A dedup layers apply verbatim; echo's attachments (remote URLs) match the COMPLETING rewrite — `mergeMessageWindow` idempotent. |
| M11 | Recall of a sent media message | Existing path unchanged; `collectChatMediaPaths` extended to also derive `${roomId}/${messageId}/` prefix objects (deterministic paths make cleanup complete rather than best-guess). |
| M12 | Web (no SQLite, no FileSystem) | Capability-gated: flag effectively off on web → today's in-session `sendAlbumMessage` path; documented, no crash (parity with 5A F10). |
| M13 | Very large backlog (20 queued messages after long offline) | Global concurrency cap 2, oldest-first fairness; texts unaffected (separate queue); UI responsive (all work off-render-path). |
| M14 | Duplicate wakeups (timer + reconnect + foreground) | `draining` flag coalesces; single-flight set guards per task — one PUT per object at a time. |

### 11.2 Boot sequence (extends 5A §8.1 by one line)

```
databaseService.init()  →  auth restored  →  hydrate-first paint (pending media bubbles render
from SQLite with local staged URIs)  →  outboxService.resume()  →  mediaService.resume():
   revert stale 'uploading' → 'queued'
   run completion gate for any all-uploaded messages (M5)
   orphan sweep: staging dirs without a pending message row; downloads LRU sweep (deferred)
   schedule from next_attempt_at, then drain
```

---

## 12. Offline behavior

1. **Authoring offline is fully functional:** pick → stage → persist → bubble with clock +
   0/N progress. Reads of already-cached media come from L3 tiers.
2. **Reconnect:** the same connectivity wake that pokes `outboxService` pokes `mediaService`;
   uploads drain (cap 2), each message hands off to the outbox as it completes; texts queued
   offline deliver immediately — never behind media.
3. **Ordering semantics (deliberate):** timeline position = authoring `created_at`
   (server sort key, 5A §6.1), so a media message always *appears* where it was authored even
   if a later text *delivered* first. Within the outbox, once enqueued, the media row obeys
   normal per-room FIFO. Cross-plane FIFO (text waits for older media) was rejected — it would
   reintroduce head-of-line blocking by megabyte-sized payloads (§20).
4. **Logout while uploads pending:** 5A §8.3 drain covers already-completed messages (they are
   outbox rows); messages still uploading are dropped with the wipe — logged out means gone,
   consistent with 5A's rule.
5. **Airplane-mode restart survival is the headline E2E criterion** (§15.4) — the exact case
   that 5A documented as impossible without this phase.

---

## 13. Security

### 13.1 Threat deltas introduced by media

| Threat | Mitigation |
|---|---|
| Arbitrary writes to `chat-media` (any authed user, any path — today's exposure) | INSERT policy: path's first folder must be a room the caller is a member of (§13.3) |
| Oversized/abusive payloads | bucket `file_size_limit` + client caps (§6); bucket `allowed_mime_types` allowlist |
| EXIF/GPS leakage in photos | stripped by re-encode during staging (§6) |
| Object enumeration on the public bucket | paths embed a v4 UUID (`roomId/messageId/pos`) — unguessable; roomId alone yields nothing |
| Path traversal / hostile filenames | object names are entirely client-constructed from UUIDs + position + fixed ext; original filename only ever rides in JSON metadata, sanitized for display |
| Malicious file content served to peers | files are never auto-opened (download → OS share sheet); no in-app HTML/JS rendering of attachments |

### 13.2 What deliberately does NOT change in 7A

The bucket stays **public-read** and rendering keeps plain public URLs — because moving to a
private bucket + signed URLs changes the rendering flow (URL refresh lifecycle in bubbles,
`expo-image` cache keys), which the invariants forbid here. This is the documented 7B
follow-up; the 7A path layout (`roomId/messageId/pos`) is chosen so per-room read policies can
be enforced later **without** re-uploading anything.

### 13.3 Storage policies (Supabase migration 000NN, additive)

```sql
-- Bucket hardening (idempotent update)
update storage.buckets
   set file_size_limit = 104857600,            -- 100 MB, matches MEDIA_MAX_VIDEO_BYTES
       allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4',
                                  'video/quicktime','application/pdf', /* … curated list … */]
 where id = 'chat-media';

-- Write: only room members, only into their room's folder, only well-formed paths
create policy "chat_media_member_insert" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.room_participants rp
      where rp.room_id = ((storage.foldername(name))[1])::uuid
        and rp.user_id = auth.uid()
    )
  );
-- Delete: same membership predicate (covers recall/discard cleanup); UPDATE not granted
-- (upsert:true issues an upload, which under Storage is insert-or-overwrite governed by
-- insert+update — grant update with the identical predicate).
```

- `service_role` never on the client (unchanged rule); policies are `authenticated`-scoped.
- Legacy objects (`roomId/timestamp.jpg`) remain readable (public bucket) — no data migration.

### 13.4 Client-side validation

MIME sniffed from file header where possible (not extension alone) for the allowlist check;
caps enforced before staging; album count ≤ 10 (existing composer rule).

### 13.5 Residual risks (accepted, documented)

Cached plaintext media on device — same trade-off as Phase 3 messages (roadmap R11; app-lock
gates UI, logout wipes). The §6 small-JPEG copy-through path can retain EXIF for
screenshot-class images; acceptable because screenshots carry no camera GPS — revisit if the
benchmark shows re-encode is cheap enough to run unconditionally.

---

## 14. Performance budget

Budgets are pass/fail gates for §15; measured on the reference low-end Android device.

| Metric | Budget | Enforced by |
|---|---|---|
| Send tap → optimistic bubble on screen | ≤ 150 ms p95 | bubble renders from picker URIs immediately; staging runs after paint |
| Send tap → durable (enqueue txn committed) | ≤ 1.5 s p95 (single 12 MP photo), ≤ 6 s p95 (10-photo album) | staging pipeline, serial compression |
| Image compress (12 MP → 2048/q0.8 + thumb) | ≤ 1.2 s p95 each | `media.compress_ms` histogram |
| Upload payload per reference photo | ≤ 15 % of original bytes | `media.bytes_out` vs probe |
| Thumb overhead per message row | ≤ 1.5 KB/attachment, ≤ 15 KB/album | `MEDIA_THUMB_EDGE` knob |
| JS heap during any upload | no full-file buffers > `MEDIA_MAX_IMAGE_BYTES` (10 MB); videos/files streamed (never in JS RAM) | §4.5 transport split |
| Concurrent uploads | ≤ `UPLOAD_MAX_CONCURRENT` (2) | worker cap |
| UI thread | zero dropped-frame regression while an album uploads during scroll | §15 frame profile |
| Recv: bubble paint with placeholder | same frame as row render (0 network) | inline thumb |
| Recv: no layout shift on full-image load | 0 px (reserved box) | width/height |
| Disk | staging ≤ 256 MB soft cap; downloads ≤ 256 MB LRU | §9 sweeps |
| Battery/network idle | no polling; wakeups are event-driven + single timer | §4.2 |

### 14.3 Constants (additions to `src/lib/constants.ts`)

```
FEATURE_MEDIA_PIPELINE            = false
UPLOAD_MAX_CONCURRENT             = 2
MEDIA_RETRY_BASE_MS               = 2000
MEDIA_RETRY_MAX_MS                = 60000
MEDIA_MAX_ATTEMPTS                = 5
MEDIA_IMAGE_MAX_EDGE              = 2048
MEDIA_IMAGE_QUALITY               = 0.8
MEDIA_THUMB_EDGE                  = 32
MEDIA_MAX_IMAGE_BYTES             = 10 * 1024 * 1024
MEDIA_MAX_VIDEO_BYTES             = 100 * 1024 * 1024
MEDIA_MAX_VIDEO_DURATION_S        = 180
MEDIA_MAX_FILE_BYTES              = 50 * 1024 * 1024
MEDIA_STAGING_MAX_BYTES           = 256 * 1024 * 1024
MEDIA_DOWNLOAD_CACHE_MAX_BYTES    = 256 * 1024 * 1024
IMAGE_PREFETCH_COUNT              = 10        (roadmap §14, activated with this flag)
```

---

## 15. Benchmark & test strategy

> Same enforcement posture as Phases 4/5A/6B: the repo has no test runner and no new dev
> dependency is allowed; suites below specify intended coverage, enforced via the Phase 6B
> harnesses, `tsc`, the layering grep, and the manual E2E checklist.

### 15.1 Benchmark harness extension (`benchmarkHarness`, additive scenario set)

New `media` scenario group, using synthetic fixtures from `src/diagnostics/fixtures.ts`
(reference images generated at 3 size classes; no binary fixtures committed — generated via
`expo-image-manipulator` at run time):

| Benchmark | Measures | Budget gate (§14) |
|---|---|---|
| `media.compress` | ms/photo across 3 size classes; output bytes ratio | ≤ 1.2 s p95; ≤ 15 % bytes |
| `media.stage_txn` | send-tap → enqueue-txn-commit (1 photo / 10-photo album) | ≤ 1.5 s / ≤ 6 s p95 |
| `media.thumb` | thumb bytes distribution | ≤ 1.5 KB p95 |
| `media.queue_scan` | `listActive()` at 0 / 50 / 500 rows | ≤ 5 ms p95 |
| `media.gate` | last-markUploaded → COMPLETING txn committed | ≤ 50 ms p95 |

### 15.2 Stress / chaos harness extension

- **Stress:** enqueue 20 messages × 5 attachments (fixtures); assert cap-2 concurrency,
  oldest-first fairness, heap stability (`memoryLeakDetector` window), no dropped frames on a
  scrolling room.
- **Chaos (`chaosHarness` profiles, upload fault injection):** `transient` (every PUT fails
  twice then succeeds → all messages deliver, attempts persisted); `permanent` (one 403 task →
  message parks, siblings retained, room's text queue unaffected); `flaky` (random 30 % PUT
  failure + random worker restarts → eventual delivery, zero duplicate objects, zero orphans
  after boot sweep).

### 15.3 Consistency auditor extension (observe-only)

New invariant checks over snapshots: every `queued/uploading` task has a pending message row
and an existing staged file; every all-uploaded message has an outbox row or is sent
(gate liveness); no outbox row exists for a message with incomplete uploads (**invariant #2
audit**); staging dir ↔ queue rows bijection (orphan detector).

### 15.4 End-to-end (manual)

- [ ] Airplane mode → send a 3-photo album + 1 text → both bubble as "đang gửi"; **force-quit;
      relaunch offline** → both still pending, album shows staged images. Enable network →
      text delivers first, album uploads (progress visible) then delivers **once** (verify on
      a second device: correct order by authoring time, thumbs + full images progressive).
- [ ] Kill the app mid-upload → relaunch → upload resumes; exactly one object per attachment
      in Storage (idempotent path verified in the dashboard).
- [ ] Toggle network rapidly during a PUT → single object, single message (missed-ACK path).
- [ ] One attachment over the bucket size limit → whole message parks with "Gửi lỗi"; Thử lại
      re-attempts only the failed task; Xóa removes message + objects.
- [ ] Video: cap enforcement inline error; under-cap video sends with poster thumb; recipient
      taps to download/play.
- [ ] File: send/receive PDF; tap downloads with progress; opens via share sheet.
- [ ] Recipient on old build receives a `video` message → file-bubble fallback, no crash.
- [ ] Recall a sent album → all storage objects under `roomId/messageId/` removed.
- [ ] Logout with uploads in flight → wipe completes; staging dir gone; re-login clean.
- [ ] **Flag OFF** → media send behavior byte-identical to today (network log: legacy
      `sendAlbumMessage` path; no `upload_queue` writes).
- [ ] Web → legacy path, no crash, no durability (documented parity with 5A F10).

### 15.5 Non-functional

- `npx tsc --noEmit` clean; layering grep: `src/db/*` imported only by
  `databaseService`/`cacheService`; `imagePipeline.ts` imports no store/service.
- New native deps land in a PREP-style zero-behavior PR + dev-client rebuild first.
- Diagnostics off ⇒ zero media-plane overhead beyond the flag check (Phase 6B contract).

---

## 16. Diagnostics integration (observe, never influence)

All taps use the Phase 6B `diag` registry — passive, exception-isolated, zero-cost when
disabled. **No code path branches on any diagnostic value** (Phase 6B contract, restated as
this phase's invariant #6).

| Tap | Type | Site |
|---|---|---|
| `media.enqueued` {kind} | counter | after enqueue txn |
| `media.compress_ms` | histogram | imagePipeline |
| `media.stage_ms` | histogram | send-tap → txn commit |
| `media.bytes_in` / `media.bytes_out` | counters | staging (original vs staged bytes) |
| `media.upload_ms` {kind} | histogram | PUT duration |
| `media.upload_retry` {reason} | counter | reschedule |
| `media.upload_failed` {class} | counter | permanent fail |
| `media.gate_ms` | histogram | completion gate txn |
| `media.handoff` | counter | outbox enqueue (the coupling edge — chaos assertions key on this) |
| `media.queue_depth` / `media.staging_bytes` | gauges | after each drain / sweep |
| `media.orphans_swept` | counter | boot sweep |
| events: `media.parked`, `media.discarded`, `media.resume` | ring | worker transitions |

---

## 17. Sequence diagrams

### 17.1 Online album send — happy path

```
useMessages      mediaService              SQLite/FS                Storage        outboxService     Supabase RPC
   │ sendAlbum(3 uris)│                        │                       │                │                │
   │ id=randomUUID()  │                        │                       │                │                │
   │ (bubble renders picker URIs immediately)  │                       │                │                │
   │─────────────────►│ stage: copy+compress+thumb ×3 ──► media/outbox/<id>/{0,1,2}.jpg  │                │
   │                  │ txn: messages(status=pending, local uris) + 3 upload_queue rows  │                │
   │                  │ poke worker            │                       │                │                │
   │                  │ PUT <room>/<id>/0.jpg (upsert) ───────────────►│ 200            │                │
   │                  │ PUT <room>/<id>/1.jpg  (cap 2, then 2.jpg) ───►│ 200,200        │                │
   │                  │ gate: 3/3 uploaded     │                       │                │                │
   │                  │ txn: attachments→remote urls + outbox row      │                │                │
   │  (RAM row swaps to remote urls; progress annotation cleared)      │                │                │
   │                  │ outboxService.poke() ───────────────────────────────────────► │ send_message_  │
   │                  │                        │                       │                │ idempotent(id) ─► row
   │                  │                        │   markSent: status=sent, outbox row deleted (5A, unchanged)
   │                  │ clearSent: delete upload_queue rows + media/outbox/<id>/         │
   │  bubble: clock → sent ✔   (realtime echo for same id → dedup no-op, 5A §5)
```

### 17.2 Offline album send → force-quit → reconnect (the 5A-deferred case)

```
[offline]
 sendAlbum → stage → txn(messages pending + queue rows)   worker: PUT fails (network) → backoff
 ...app killed mid-backoff...
[relaunch, still offline]
 db.init → hydrate: pending bubble paints from SQLite with staged local URIs
 mediaService.resume(): uploading→queued, schedule from next_attempt_at   (nothing due offline)
[network returns]
 connectivity wake → drain: PUT ×3 (idempotent paths) → gate → outbox row → outboxService drains
 → send_message_idempotent → SENT ✔      single message, single object per attachment
```

### 17.3 Partial permanent failure → manual retry

```
worker                     Storage                    UI (useMessages)
  │ PUT <id>/0.jpg ───────► 200                          │
  │ PUT <id>/1.jpg ───────► 413 (over bucket limit)      │
  │ markFailed(task1) → message parked                   │
  │──────────────────────────────────────────────► bubble "Gửi lỗi · Thử lại / Xóa"
  │                                              user taps Thử lại
  │◄───────────────────────────────── retryMedia(id): resetForRetry (task1 only)
  │ PUT <id>/1.jpg ───────► 200        (task0 NOT re-uploaded)
  │ gate 2/2 (+0 already) → COMPLETING → outbox → SENT ✔
```

### 17.4 Crash between last upload and completion gate (M5)

```
worker                          SQLite                          on relaunch
  │ markUploaded(task2)  → all 3 rows state='uploaded'             │
  ✖ crash (no COMPLETING txn — no outbox row exists)               │
                                                                   │ mediaService.resume()
                                                                   │ finds message with 3/3 uploaded
                                                                   │ COMPLETING txn → outbox row → poke
                                                                   │ delivery proceeds; no duplicate
                                                                   │ (paths idempotent, RPC idempotent)
```

### 17.5 Receive path — progressive render (flow unchanged)

```
Realtime/delta → (5A/4 ingest, unchanged) → chatStore row {attachments: [{url,w,h,thumb,kind}]}
  → MessageList → AlbumGrid:
       frame 0: reserved w/h box + inline thumb placeholder      (0 network)
       async  : expo-image loads url (memory-disk) → cross-fade  (no layout shift)
  → page applied → Image.prefetch(newest 10 image urls)
```

---

## 18. Rollout strategy

1. **PREP-M (infrastructure PR):** add `expo-image-manipulator`, `expo-file-system`,
   `expo-video-thumbnails`; rebuild dev client + EAS profiles; zero behavior change (roadmap
   PREP hard rule).
2. **Server migration 000NN:** bucket limits + storage policies + `'video'` CHECK value.
   Additive; legacy clients keep writing legacy paths (they are members, policy passes if the
   legacy path's first folder is the room id — it is).
3. **Ship dormant:** SQLite v4, `UploadQueueRepository`, `mediaService`, `imagePipeline`,
   flagged hook/store changes with `FEATURE_MEDIA_PIPELINE = false`. Flag off ⇒ legacy
   `sendAlbumMessage`, byte-identical; `upload_queue` exists but is never written.
4. **Internal dogfood:** flag on locally; run §15.4 checklist on device (airplane +
   force-quit are the headline cases) + reliability suite with media scenarios.
5. **Staged enable:** small cohort build/OTA; watch `get_logs` (storage 4xx), client
   `console.error("[mediaService] …")`, `media.upload_failed` counters, duplicate-object
   reports (should be zero by construction).
6. **Full enable**, then remove the legacy media path one release later (project convention).
7. **Kill switch:** `FEATURE_MEDIA_PIPELINE = false` → instant revert. In-flight rows: keep
   `mediaService.resume()` wired (recommended, mirrors 5A) so already-staged messages still
   drain; otherwise they surface as failed bubbles with delete — no silent loss.
8. **Cache-version safety:** `LATEST_SCHEMA_VERSION` bump wipes SQLite but **not**
   `documentDirectory` staging; the boot sweep then removes staged dirs with no matching
   message row — cold rebuild stays clean. Prefer the flag kill-switch over a wipe while
   unsent media exists (same guidance as 5A).
9. **Sequencing note:** `FEATURE_MEDIA_PIPELINE` requires `FEATURE_OFFLINE_OUTBOX` to be
   enabled (media durability rides the outbox for delivery). The service asserts this at
   init and degrades to legacy if unmet (logged, not thrown).

---

## 19. Architectural invariants — compliance

| # | Invariant | Mechanism in this design |
|---|---|---|
| 1 | Upload Queue independent from Outbox | Separate table (`upload_queue` v4 vs `outbox` v3), separate repository, separate worker with its own scheduling/backoff/concurrency model (§1.1 table). Neither reads the other's rows; the only edge is the one-way hand-off in the COMPLETING txn. Outbox schema, drain algorithm and RPC are untouched. |
| 2 | Upload completion before message delivery | Enforced **structurally**: no outbox row exists for a media message until every `upload_queue` task is `state='uploaded'` and the COMPLETING transaction commits (§2 rule 4–5). `outboxService` cannot deliver what it cannot see. Audited continuously by the §15.3 media invariants (I-M2). |
| 3 | Existing synchronization architecture unchanged | Zero edits to `syncService`, `sync_state`, cursors, `mergeMessageWindow`, realtime channels or ingest order. Media messages enter sync exactly like 5A text: as server rows after the RPC ACK, merged by the same repository-owned merge (§0 out-of-scope, §17.5). |
| 4 | Repository ownership unchanged | One **new** repository (`UploadQueueRepository`) is added beside the existing ones; no existing repository gains, loses, or shares responsibility. `MessageRepository` remains the sole writer of `messages`/`attachments`; the new repo owns only `upload_queue` (§3.3). |
| 5 | Rendering flow unchanged | Same components (`MessageBubble`, `AlbumGrid`), same data path (store → list → bubble), same `expo-image` usage. All render inputs are **additive optional fields** (`width/height/thumb/kind` in the existing `attachments` JSON, `uploadProgress` annotation); absent fields reproduce today's behavior exactly (§1.2, §8). |
| 6 | Diagnostics observe without affecting behavior | All media taps go through the Phase 6B `diag` registry: passive, exception-isolated, zero-cost when off — never awaited, never branched on (§16). Auditor/harness additions are read-only over snapshots and dev-only fixtures (§15). |

---

## 20. Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Media as outbox rows (one queue for everything) | ❌ | Violates invariant #1; couples blob retry economics to message FIFO — a stuck 80 MB video would block the room's text head (5A head-first drain). The §1.1 table is the full argument. |
| Upload inside the outbox attempt (upload-then-insert per drain tick) | ❌ | Re-uploads on every message retry, ties upload backoff to message backoff, and makes the outbox worker long-running/IO-heavy — 5A deliberately kept attempts small and cheap. |
| One global cross-plane FIFO (album blocks later texts) | ❌ | WhatsApp-style strict ordering punishes slow networks; Telegram-style independent delivery matches the existing product behavior (5A §6.3 keeps per-room text FIFO; media floats). |
| Binaries in SQLite (BLOB column) | ❌ | 100 MB rows in WAL, memory pressure on hydrate, DB file bloat; FileSystem is the platform-blessed store for large objects. SQLite keeps only paths + metadata. |
| Staging in `cacheDirectory` | ❌ | OS may evict at any time — this is exactly why 5A excluded media. `documentDirectory` is app-owned; eviction risk was *the* durability blocker (§9.1). |
| Resumable uploads (TUS) now | ⏭ 7B | Supabase supports TUS, but it adds a resumable-session state machine per task. With a 100 MB cap and whole-object idempotent retry (upsert), the win doesn't pay for the complexity in 7A. Revisit with transcoding. |
| Client-side video transcoding | ⏭ 7B | No first-party Expo transcoder in SDK 56; third-party native modules violate the Expo-first rule without a PREP case. 7A ships caps + passthrough; transcode is the flagged follow-up. |
| Server-side thumbnail generation (edge function) | ❌ for 7A | Adds a server hop before a message can render progressively, plus a new function to operate. A 32 px client thumb costs ~1 KB inline and works offline. Server derivatives can come with signed URLs in 7B. |
| Private bucket + signed URLs in 7A | ⏭ 7B | Correct end-state, but rewriting URL resolution changes the rendering flow — forbidden by invariant #5 this phase. Path hardening + write policies land now; read hardening lands with the URL-resolver layer (§13.6). |
| Random (non-deterministic) object names | ❌ | Breaks storage idempotency: a retry after an ACK-lost upload would orphan the first object and duplicate bytes. Deterministic `room/message/position` + upsert makes retry a no-op (§4.4). |
| Per-room upload FIFO (mirror outbox ordering) | ❌ | Uploads have no ordering semantics (delivery order is fixed by `created_at` at authoring); FIFO would let one big file starve a room's small images. Oldest-first global fairness + concurrency cap is strictly better (§4.2). |

---

## 21. Implementation checklist (build order)

1. **PREP-M:** add the three native deps, rebuild dev client, zero behavior change.
2. Supabase migration 000NN: bucket limits, storage policies, `'video'` CHECK value.
3. SQLite `MIGRATION_004_UPLOAD_QUEUE` + `UploadQueueRepository` (interface in
   `repositories/types.ts`, impl in `repositories/sqlite.ts`) + `cacheService` wrappers.
4. `src/lib/imagePipeline.ts` (pure helpers: `processImage`, `processVideo`, `probeFile`).
5. `src/services/mediaService.ts`: staging + `enqueueMediaMessage` (no worker yet); unit-test
   the enqueue transaction.
6. Upload worker inside `mediaService`: drain loop, concurrency cap, backoff, wakeups,
   `resume()`; then the COMPLETING gate → `enqueueOutbox` hand-off.
7. `chatStore.uploadProgress` annotation + `useMessages` flag-gated swap
   (`sendAlbum` → `mediaService`, add `retryMedia` / `discardMedia`).
8. Renderer additive props: reserved aspect box, `thumb` placeholder, progress ring,
   failed-state affordance reuse.
9. Boot wiring: `mediaService.resume()` beside `outboxService.resume()`; reconnect +
   foreground wakeups; logout drain-then-wipe extension.
10. Cache tiers: staging GC (post-SENT + boot sweep), downloads LRU GC, byte budgets.
11. Diagnostics taps (`media.*`), auditor invariants I-M1…I-M5, harness scenario packs,
    benchmark fixtures.
12. §15.4 manual device matrix (airplane, force-quit, permission revoke, storage-full).
13. Dogfood with flag on → staged rollout → full enable (§18).
14. One release later: remove the legacy `sendAlbumMessage` client path.

> Every step is additive or flag-gated; between steps the app is never worse than Phase 6B,
> and nothing changes user-visibly until `FEATURE_MEDIA_PIPELINE` is set.
