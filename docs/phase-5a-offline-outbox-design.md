# Phase 5A — Offline Outbox & Optimistic Persistence Architecture (Design)

> **Status:** Design only. No production code in this phase.
> **Roadmap anchor:** Milestone B · **B2 — Offline write queue / outbox** (explicitly deferred out
> of Phase 4 scope, doc §0 "Explicitly OUT of scope").
> **Feature flag:** `FEATURE_OFFLINE_OUTBOX`.
> **Depends on:** Phase 3 (Local Cache) — `cacheService`, SQLite repositories, hydrate-first
> stores, logout wipe; Phase 4 (Incremental Sync) — `messages.updated_at` server-clock trigger,
> `mergeMessageWindow` (repository-owned merge), cursor `sync_state`, `syncService`.
> **Goal of this doc:** be complete enough that Phase 5A can be implemented without any further
> design decisions.

---

## 0. Problem statement & scope

### What we have today (Phase 3 + 4)

- Sending a message is **optimistic in RAM only**. `useMessages.sendMessage` mints a
  `temp-${Date.now()}` id, calls `addOptimisticMessage` (RAM only — `cacheService.saveMessages`
  filters `temp-` ids via `isPersistable`, so **nothing is persisted**), then awaits
  `messageService.sendMessage`. On success `replaceOptimisticMessage(tempId, serverRow)`; on **any**
  error `removeMessage(tempId, roomId)` — the message silently vanishes.
  See [useMessages.ts#L69-L121](file:///Users/dabeeovina/Documents/TL-chatting/src/hooks/useMessages.ts#L69-L121).
- The server generates the message `id` (`uuid default gen_random_uuid()`); the client never knows
  the id until the INSERT returns.
- The SQLite `messages` table **already reserves** a `status TEXT NOT NULL DEFAULT 'sent'` column
  "for the future outbox ('pending' | 'sent' | 'failed')"
  ([migrations.ts#L37-L38](file:///Users/dabeeovina/Documents/TL-chatting/src/db/migrations.ts#L37-L38)),
  but it is currently **never written or read** (not in `MessageRow`, `toMessageRowParams`,
  `UPSERT_MESSAGE_SQL`, or `rowToMessage`).

### The cost we are removing

On a flaky/absent network a send either blocks on a spinner or is **lost** the instant the promise
rejects (`removeMessage`). Nothing survives an app kill mid-send. There is no retry, no delivery
guarantee, and no "sending / failed / tap to retry" affordance. This is the last correctness gap
before Talo feels like a real messenger offline.

### Phase 5A objective

Make an outgoing message a **durable, idempotent, ordered** unit of work:

1. Persist it the instant the user hits send (optimistic **persistence**, not just optimistic RAM).
2. Deliver it exactly once whenever connectivity allows — across reconnects, backgrounding, and full
   app restarts.
3. Never create a duplicate, no matter how many times a send is retried or how a missed ACK is
   recovered.
4. Surface honest per-message state: **sending → sent**, or **failed → tap to retry / delete**.

### In scope

- Client-generated **UUID message id** = the idempotency key (replaces `temp-` ids when the flag is on).
- Durable **outbox**: pending/failed messages persisted in SQLite (`messages.status` + a sidecar
  `outbox` bookkeeping table), surviving restart.
- An **`outboxService`** worker: single-flight per message, FIFO per room, bounded backoff, network/
  foreground/enqueue-driven wakeups.
- One idempotent send **RPC** (`send_message_idempotent`) so a retried insert returns the existing
  row instead of duplicating (server-enforced).
- New **`OutboxRepository`** (durable queue state) + wiring `status` into the existing message
  row-mapping. SQLite migration v3.
- Store + hook changes so a message renders its send state and failed sends offer retry/delete.
- Everything behind `FEATURE_OFFLINE_OUTBOX` (flag off ⇒ byte-identical to today).

### Explicitly OUT of scope (hard constraints)

- ❌ **Offline media/album/image send survival across restart.** Local file URIs are not guaranteed
  to persist (OS cache eviction) and re-upload is a separate concern. Phase 5A queues **text and
  poll** messages durably; media send keeps today's in-session optimistic behavior (documented in
  §7, §12) and is a Phase 5B follow-up.
- ❌ Offline **edit/recall/react** queueing as first-class outbox ops. Editing/recalling a message
  that is **still pending** is handled locally (§7.4); editing/reacting an already-**sent** message
  keeps today's online-only behavior.
- ❌ Any change to steady-state realtime, delta sync, or pagination (Phase 3/4 stay byte-for-byte).
- ❌ New npm dependencies. (Idempotency keys use the already-present `expo-crypto`
  `Crypto.randomUUID()` — see [appLockService.ts#L32](file:///Users/dabeeovina/Documents/TL-chatting/src/services/appLockService.ts#L32).)
- ❌ Changing public store/hook API surfaces consumed by screens/components (additive only).
- ❌ CRDTs / operational transform / multi-device send reconciliation beyond id-dedup.

---

## 1. Architecture

### 1.1 Layering (Phase 3/4 layering, one worker + one table added)

```
        Screen (app/) ── useMessages (send / retry / delete) ── unchanged public API
                                   │  enqueue / retry / discard
                                   ▼
                         Memory Store (Zustand)            ← single source of truth for render
                    chatStore.messages[roomId] (with per-msg send state)
                                   ▲            │
                     status patch  │            │ enqueue / markSent / markFailed
                                   │            ▼
        ┌──────────────────────────┴───────── outboxService ─────────────────────────┐
        │  single-flight per msg · FIFO per room · backoff · network/foreground wake   │  (NEW)
        └───────┬───────────────────────────────────────────────────┬────────────────┘
        durable │ (via cacheService)                    idempotent send │ (via messageService)
                ┌──▼─────────────┐                          ┌──────────▼──────────┐
                │  cacheService  │  ← facade (+outbox)       │      Supabase        │
                │  repositories  │                          │ RPC: send_message_   │
                │  + OutboxRepo  │  (NEW)                    │      idempotent (NEW)│
                └──┬─────────────┘                          │ Realtime: room:$     │
                   │                                        │ (echo, unchanged)    │
                ┌──▼─────────────┐                          └──────────────────────┘
                │ SQLite (WAL)   │
                │ messages(status)│  status: pending|failed|sent
                │ + outbox        │  (NEW: attempts, next_attempt_at, last_error)
                └────────────────┘
```

**Key rule preserved:** the memory store is the only render source; SQLite is persistence only; the
outbox is read by `outboxService` to *orchestrate*, never rendered directly. A pending message is
rendered exactly like any other message (it *is* a `messages` row), just annotated with its send
state.

### 1.2 The idempotency key is the message id

The single most important decision: **the client mints the final `id` (a v4 UUID) at enqueue time**,
and that id is used unchanged through the entire lifecycle — optimistic render, SQLite row, the
INSERT, the realtime echo, delta sync, and the merge. There is **no `temp-` → real-id swap** when the
flag is on. Because every layer keys on the same stable id:

- the realtime INSERT echo dedups against the already-present row (`addMessage`'s `some(m.id===)`),
- a retried send hits the server PK unique constraint → the RPC returns the existing row (no dup),
- `mergeMessageWindow` (Phase 4) and the delta cursor all reconcile by that id.

This is exactly what makes Invariants #5/#6/#7 hold *by construction* rather than by careful timing.

### 1.3 New / changed components at a glance

| Component | Type | Responsibility |
|-----------|------|----------------|
| `src/services/outboxService.ts` | **NEW** | Worker: drain queue, single-flight per msg, FIFO per room, backoff, wakeups, ACK handling, flag delegation. Mirrors `syncService`'s shape. |
| `OutboxRepository` — `createOutboxRepository` in `repositories/sqlite.ts` (+ interface in `types.ts`) | **NEW** | Durable queue state: enqueue, list-due (ordered), attempt/backoff bookkeeping, markSent/markFailed, remove. Owns *synchronization* state (Invariant #3). **Co-located in `sqlite.ts`** (not a separate `outbox.ts`): `enqueue`/`listDue` reuse the file-private `UPSERT_MESSAGE_SQL` / `toMessageRowParams` / `rowToMessage`, and `sqlite.ts` states row↔domain mapping must live entirely in that one file — a separate file would force leaking those internals. |
| SQLite migration v3 | **NEW** | `outbox` table; wire `status` into message row-mapping. |
| `messageService.sendMessageIdempotent()` | **NEW method** | Wraps `send_message_idempotent` RPC (insert-or-return by id). |
| Supabase migration 00018 | **NEW** | `send_message_idempotent` RPC (`SECURITY INVOKER`, RLS-safe). |
| `cacheService` | **+ methods** | `enqueueOutbox` / `listOutboxAll` / `markOutboxSent` / `markOutboxFailed` / `rescheduleOutbox` / `removeOutbox` (never-throw). These are 1:1 never-throw wrappers over the `OutboxRepository` methods the worker calls (`resume()`/drain use `listOutboxAll` §3.2/§8.1; transient backoff uses `rescheduleOutbox` §3.4). *(Reconciled during implementation: the earlier draft listed a speculative `getPendingByRoom` that no detailed section calls, and a row-level `listOutboxDue` that cannot preserve §6.2 FIFO under a mid-backoff wakeup — the worker instead evaluates the single ordered `listOutboxAll` set head-first (§3.2); the facade mirrors exactly the repository surface the worker uses, no unused method.)* |
| `chatStore` | **+ send-state** | Persist optimistic sends (status=pending); `markMessageSent` / `markMessageFailed`; render annotation `outbox_status`. |
| `useMessages` | **behavior swap (flagged)** | send → enqueue+persist; add `retryMessage` / `discardMessage`. |
| `constants.ts` | **+ constants** | `FEATURE_OFFLINE_OUTBOX`, outbox backoff + attempt caps. |
| App bootstrap (`_layout` / db init) | **hook** | Kick `outboxService.resume()` after DB init + auth (restart recovery). |

---

## 2. Temporary message lifecycle

A message the local user sends moves through a small, persisted state machine. State lives in
`messages.status` (SQLite) + the `outbox` row; it is projected to RAM as `outbox_status` for render.

```
                       enqueue (user hits send)
                            │  id = Crypto.randomUUID()  (final id, not temp-)
                            ▼
                      ┌───────────┐   send ok (RPC returns row)      ┌────────┐
      (persisted) ───►│  PENDING  │─────────────────────────────────►│  SENT  │ (outbox row deleted)
                      └───────────┘                                  └────────┘
                            │  transient error (network/5xx)            ▲
                            │  attempts < MAX → backoff, stay PENDING    │ realtime echo also
                            │                                            │ resolves to same id
                            │  permanent error (RLS/validation/room gone)│ (dedup, no-op)
                            ▼            OR attempts == MAX               │
                      ┌───────────┐                                      │
                      │  FAILED   │── user taps "retry" ─────────────────┘ (re-enter PENDING)
                      └───────────┘── user taps "delete" ──► removed (row + outbox deleted)
```

### 2.1 States

| State | `messages.status` | outbox row? | Renders as | Auto-retried? |
|-------|-------------------|-------------|------------|---------------|
| PENDING | `pending` | yes | bubble + clock/"đang gửi" | yes (backoff) |
| SENT | `sent` | no | normal bubble | — |
| FAILED | `failed` | yes (paused) | bubble + "Gửi lỗi · Thử lại / Xóa" | no (manual) |

### 2.2 Lifecycle rules

1. **Enqueue is atomic + durable:** in one SQLite transaction, upsert the message row
   (`status='pending'`) **and** insert its `outbox` bookkeeping row. Only after that does the worker
   get poked. The message is on screen and on disk before any network attempt.
2. **The id never changes.** Optimistic id == persisted id == server id. `replaceOptimisticMessage`
   collapses to `markMessageSent` (status flip + adopt server-authored fields, e.g. `updated_at`).
3. **SENT is terminal & cleans up:** ACK sets `status='sent'` and **deletes the outbox row** in one
   transaction. A `sent` message is indistinguishable from a normally-received one.
4. **FAILED is a parking state:** it stays persisted and rendered, is **not** auto-retried, and only
   leaves via explicit user retry (→ PENDING, attempts reset) or delete.
5. **temp- compatibility:** with the flag **off**, the legacy `temp-` path is untouched (RAM-only,
   removed on error). The two paths never coexist for one message.

---

## 3. Outbox queue model

### 3.1 Storage model — "the message *is* the payload; the outbox is the index"

A pending message is a **real `messages` row** (so it hydrates & renders after restart with zero
special-casing). The `outbox` table holds only **queue bookkeeping**, keyed 1:1 by message id:

```sql
-- SQLite migration v3 : MIGRATION_003_OUTBOX (append-only, toVersion = 3)
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY NOT NULL,   -- == messages.id (client UUID, idempotency key)
  room_id         TEXT NOT NULL,               -- FIFO grouping key
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,                         -- ISO-8601; null = due now
  last_error      TEXT,                         -- diagnostics only
  state           TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'failed'
  created_at      TEXT NOT NULL,                -- client authoring instant (ordering key)
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (room_id, created_at);
```

- No payload duplication: the worker reads the send payload from the joined `messages` row.
- `messages.status` is wired into row-mapping (it already exists in schema v1) so hydration paints a
  pending bubble; the `outbox` row is what the worker enumerates.
- Same droppable-cache lifecycle: wiped on logout with the DB file — **but see §8.3** (we deliberately
  drain before wipe so a logout doesn't silently drop unsent messages).

### 3.2 Enumeration & ordering (head-first per room, FIFO)

The worker enumerates the queue with a single ordered read and evaluates each room **head-first** — it
only ever attempts a room's oldest unresolved message and never touches a follower while an older
sibling is still pending:

```
listAll():
  SELECT o.*, m.*  FROM outbox o JOIN messages m ON m.id = o.id
  ORDER BY o.created_at ASC        -- global authoring order (pending + failed)
```

Per room (rows already in `created_at` order), the worker walks from the oldest:

- a `failed` row is parked → **skip** it (it does not block the room; §3.4),
- the first `pending` row is the room **head**:
  - **not due** (`next_attempt_at > now`) → the room is blocked until then; the head's
    `next_attempt_at` feeds the timer and **no follower is attempted**,
  - **due** → attempt it; on ACK continue to the next row, on a transient failure the head is
    rescheduled (blocks the room), on a permanent/exhausted failure it parks and the room unblocks
    (continue to the next row).

Different rooms are evaluated in parallel; within a room the head is ACKed (or parked) before the next
starts, guaranteeing per-room ordering (§6).

> **Why head-first over `listAll`, not a row-level `listDue` filter.** A row-level "due" predicate
> (`next_attempt_at IS NULL OR <= now`) can return a **follower** whose older sibling is scheduled in
> the future: a head that fails transiently drops out of the due set (rescheduled to `now+delay`)
> while its never-attempted follower stays `next_attempt_at = null` ("due now"). An
> enqueue/foreground/reconnect wake landing inside that backoff window would then deliver the follower
> **before** the head — violating the §6.2 per-room FIFO guarantee (a "gap" published out of order),
> and it fires in the primary target scenario (flaky network, two quick sends in one room). Evaluating
> each room from its head with the due-check applied **at the head** closes that gap with one ordered
> read, and makes the earlier `listDue` method redundant (removed — §10.1). *(Reconciled during
> implementation: the earlier draft's `listDue`-group-drain mechanism could not uphold §6.2 under a
> mid-backoff wakeup; head-first evaluation is the minimal correct mechanism within the same
> architecture — repository still owns the FIFO order and transitions, the service still owns timing.)*

### 3.3 Why not a separate full-payload queue table

Considered a self-contained `outbox(payload_json, …)` decoupled from `messages`. Rejected: a pending
message would then **not** be a `messages` row, so hydration/rendering after restart would need a
second render source — violating "memory store is the single render source" and duplicating the row
shape. Keeping the message in `messages` (status='pending') and the queue as a thin index is the
minimal, single-source model.

### 3.4 Retry & wakeup strategy (worker policy)

The `outboxService` (not the repository) owns *when* to attempt. Policy:

**Error classification (decides transient vs terminal):**

| Class | Examples | Action |
|-------|----------|--------|
| Transient | network offline, request timeout, 5xx, `PGRST` connection errors | backoff & retry, stay `pending` |
| Permanent | RLS/403, room deleted / FK violation, validation/422 | → `failed` immediately, **no** backoff (manual retry only) |

**Backoff (per message, persisted in `outbox.next_attempt_at`):**

```
OUTBOX_RETRY_BASE_MS = 2000
OUTBOX_RETRY_MAX_MS  = 30000
OUTBOX_MAX_ATTEMPTS  = 6
attempt n delay = min(OUTBOX_RETRY_BASE_MS * 2^(n-1), OUTBOX_RETRY_MAX_MS)  → 2s,4s,8s,16s,30s,30s
```

- After each transient failure: `attempts++`, `next_attempt_at = now + delay`, persisted so the
  schedule survives restart. After `OUTBOX_MAX_ATTEMPTS` transient failures → `failed` (parked,
  manual retry resets `attempts=0`).
- Backoff is **per message**, but the per-room FIFO (§6) means a stuck head message holds its room's
  queue until it succeeds, is deleted, or moves to `failed` (which unblocks the room's next message).

**Wakeup triggers (when the worker drains the queue head-first, §3.2):**

1. **Enqueue** — a fresh send pokes the worker immediately.
2. **Connectivity regained** — a `NetInfo`/reconnect signal (reuse the same reconnect signal
   `useRealtime` already observes) triggers a drain.
3. **App foreground** — `AppState 'active'` drains (same hook point Phase 4 uses for room-list sync).
4. **Timer** — a single timer armed for the soonest `next_attempt_at` across the queue (one timer,
   re-armed after each drain; never one-timer-per-message).

**Single-flight & coalescing:** an in-memory `Set<id>` guards messages currently being sent, and a
`draining` flag coalesces overlapping wakeups into one pass (mirrors `syncService`'s in-flight map).
No retry storm: attempts are bounded, scheduled, and only run while the app is foregrounded/online.

---

## 4. ACK flow

"ACK" = the server has durably accepted the message. Because the id is client-minted, ACK is
**idempotent** and survives a lost response.

### 4.1 Idempotent send RPC (server-enforced dedup)

```sql
-- Supabase migration 00018
CREATE OR REPLACE FUNCTION public.send_message_idempotent(
  p_id        uuid,
  p_room_id   uuid,
  p_content   text,
  p_type      text,
  p_metadata  jsonb DEFAULT NULL,
  p_reply_to  uuid  DEFAULT NULL,
  p_created_at timestamptz DEFAULT now()
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY INVOKER              -- runs as caller → existing messages RLS applies unchanged
AS $$
BEGIN
  -- sender_id is forced to the caller (never trusted from the client)
  INSERT INTO public.messages (id, room_id, sender_id, content, type, metadata, reply_to, created_at)
  VALUES (p_id, p_room_id, auth.uid(), p_content, p_type, p_metadata, p_reply_to, p_created_at)
  ON CONFLICT (id) DO NOTHING;

  -- Return the row whether we just inserted it or it already existed (missed ACK).
  RETURN QUERY SELECT * FROM public.messages WHERE id = p_id;
END;
$$;
```

- `ON CONFLICT (id) DO NOTHING` + unconditional `RETURN QUERY SELECT` = **insert-or-return**: a
  retried send of the same id gets the existing row back, never a second row (Invariant #6/#7).
- `sender_id = auth.uid()` inside the function means the client cannot spoof a sender; RLS on
  `messages` (INSERT policy) still gates room membership. No new attack surface.
- `RETURNS SETOF messages` → reuses the existing row→domain mapping. Reactions/votes are not embedded
  (a brand-new message has none); the realtime path stays authoritative for later embeds.
- One RPC ⇒ one `database.ts` regeneration (standard workflow). Until regen, `messageService` types
  the call through a localized cast (same pattern as Phase 4B `getRoomsDelta`).

### 4.2 Client ACK handling

```
row = await messageService.sendMessageIdempotent(payload)   // insert-or-return
// ACK: one SQLite txn
markOutboxSent(id):
    UPDATE messages SET status='sent', updated_at = row.updated_at, created_at = row.created_at
    DELETE FROM outbox WHERE id = ?
// RAM
chatStore.markMessageSent(row)   // adopt server fields; clear outbox_status; keyed by id (idempotent)
```

- `markMessageSent` is keyed by id and is a no-op if the realtime echo already promoted the row —
  **no duplicate** (§5).
- The worker removes the message from its single-flight set only after the txn commits, so a crash
  between RPC-success and txn-commit simply re-drives on next launch → RPC returns the existing row →
  idempotent (the message re-promotes to sent).

### 4.3 The three ways a send resolves — all converge on one row

1. **RPC returns (normal):** insert happened → ACK.
2. **RPC returns on conflict (missed earlier ACK):** existing row returned → ACK, idempotent.
3. **Realtime echo arrives first:** `addMessage(echo)` finds the id already present (the pending
   row) and promotes/dedups it; the in-flight RPC then resolves and `markMessageSent` is a no-op.

---

## 5. Duplicate prevention (defense in depth)

Duplicates are prevented at **five** independent layers, all keyed on the one client UUID:

| Layer | Mechanism | Stops |
|-------|-----------|-------|
| 1. Client id | UUID minted once at enqueue; reused on every retry | retry forking a new message |
| 2. Server PK | `messages.id` primary key + `ON CONFLICT (id) DO NOTHING` in the RPC | a second server row for the same send |
| 3. Realtime echo dedup | `addMessage` / `markMessageSent` guard `some(m.id === id)` | echo + local optimistic copy coexisting |
| 4. Worker single-flight | in-memory `Set<id>` of in-flight sends; a message already sending is never re-picked | concurrent double-send of one id (e.g. network wake + timer wake) |
| 5. Idempotent merge | Phase 4 `mergeMessageWindow` dedups by id | delta/reconnect re-delivering the row |

> **Cross-restart note:** layer 4 (in-memory) resets on restart, but layer 2 (server PK) makes a
> re-drive after a crashed-mid-send harmless — the RPC returns the existing row.

---

## 6. Ordering guarantees

**Guarantee:** within a room, messages are delivered to the server in the same order the user
authored them; the on-screen order equals the eventual server order.

Mechanisms:

1. **Authoring-time `created_at`.** At enqueue the client stamps `created_at` (the authoring instant)
   and sends it to the RPC. This is the sort key everywhere (RAM sort, hydration `ORDER BY
   created_at DESC`, outbox `ORDER BY created_at ASC`), so optimistic order == final order even across
   restarts. (`updated_at` remains server-authored via the Phase 4 trigger — ordering never uses it.)
2. **Head-first per-room drain.** The worker evaluates each room from its head and attempts only the
   oldest unresolved message, awaiting its ACK before moving on. A follower is **never** attempted
   while an older sibling is still pending (§3.2), so a transient failure on the head **blocks the
   whole room** and a gap can never be published out of order — including across separate wakeups
   (enqueue/foreground/reconnect/timer), because every drain restarts at the room head. Other rooms
   proceed independently.
3. **Monotonic client clock caveat.** If the device clock jumps backward between two sends, two
   `created_at` could invert. Mitigation: the enqueue stamp is `max(now, lastEnqueuedCreatedAt + 1ms)`
   per room (a tiny monotonic guard held in the outbox repository), so intra-room order is stable
   regardless of wall-clock jitter. Cross-room ordering is best-effort (acceptable; rooms are
   independent timelines).

---

## 7. Conflict handling

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| **Missed ACK** (row inserted, response lost) | RPC insert-or-return → existing row → promote to sent | §4; idempotent by id |
| **Realtime echo before RPC returns** | echo promotes the pending row; RPC result is a no-op | §5 layer 3 |
| **Same message queued twice** (double-tap send) | UI guards a send in-flight; even if two rows enqueue, they carry **different** UUIDs → two distinct messages (correct: two taps = two messages). Accidental double-fire of the *same* enqueue is impossible (one UUID per call). | intent-preserving |
| **Edit a still-PENDING message** | local-only: mutate the pending `messages` row + outbox payload source; no server op (it was never sent). When it finally sends, the edited content is what's inserted. | no half-sent edits |
| **Recall/delete a still-PENDING message** | remove outbox row + message row locally; never contacts server | nothing to recall server-side |
| **Server rejects: not a room member / room deleted (RLS/FK)** | permanent failure → `FAILED`; surface "Gửi lỗi"; offer delete | can't succeed by retrying |
| **Server rejects: validation (bad payload)** | permanent failure → `FAILED` | non-transient |
| **Content edited server-side after send** (n/a for new msg) | last-write-wins by `updated_at` (Phase 4 merge) | consistent with Phase 4 |
| **Two devices, same user, both offline, both send** | different UUIDs → two messages (each device authored one) | expected semantics |
| **Media send while offline** (out of scope) | media stays in-session optimistic; if it fails it uses today's remove-on-error (flag-gated identical) | §0; Phase 5B |

---

## 8. App restart recovery

### 8.1 Boot sequence

```
app launch
  → databaseService.init()            (existing; runs migrations incl. v3)
  → auth restored (session)           (existing)
  → room/chat hydrate-first           (existing; pending messages hydrate & render as "đang gửi"
                                        because status is now mapped)
  → outboxService.resume()            (NEW): load all outbox rows (pending → schedule; failed → leave
                                        parked), then drain due ones respecting next_attempt_at
```

### 8.2 What survives

- The message content, its id, its `created_at`, and its `pending`/`failed` state all live in SQLite
  → they survive a kill. On relaunch the user sees their unsent messages exactly where they left
  them, already marked "đang gửi" / "gửi lỗi", and delivery resumes automatically (Invariant #4).
- The in-memory single-flight set and backoff timers do **not** survive — they are rebuilt from
  `outbox.next_attempt_at` on `resume()`. A message mid-flight when the app died re-drives safely
  (idempotent RPC).

### 8.3 Logout interaction (deliberate)

Logout wipes the DB ([cacheService.wipe](file:///Users/dabeeovina/Documents/TL-chatting/src/services/cacheService.ts#L199)).
A blind wipe would silently discard unsent messages. Rule: on logout, if the outbox is non-empty,
**attempt one best-effort synchronous drain** (bounded, e.g. 3s) before wipe; anything still pending
is dropped **with the account's data** (expected — you logged out). This is a small addition to the
logout path, not a new subsystem.

---

## 9. SQLite interaction

### 9.1 Migration v3 (client cache)

- Create the `outbox` table (§3.1).
- **Wire `status` into message row-mapping** (the column already exists since v1): add `status` to
  `MessageRow`, `toMessageRowParams`, `UPSERT_MESSAGE_SQL`, `rowToMessage`. Default `'sent'` keeps
  every existing/ingested row unchanged; only outbox writes set `'pending'`/`'failed'`.
- No destructive change; a Phase-4 DB upgrades `user_version 2 → 3` transactionally via the existing
  `runMigrations` framework.

### 9.2 `isPersistable` change (flag-gated behavior)

Today `isPersistable` blocks `temp-` ids from persisting. With the flag on there are **no** `temp-`
ids (ids are UUIDs), so pending messages persist normally. The `temp-` guard stays as a safety net
(and remains the whole story when the flag is off). `cacheService.saveMessages` continues to advance
the Phase 4 cursor — but note a **pending** row has a client `created_at` and (until sent) no server
`updated_at`; enqueue therefore writes the message via the outbox path (which does **not** advance the
messages sync cursor), so an un-ACKed local row can never poison the server-authored delta cursor
(Invariant #4 preserved). Only `markOutboxSent` (adopting the server row) flows through the normal
cursor-advancing `saveMessages`.

### 9.3 Transactions

- **Enqueue:** `messages` upsert + `outbox` insert in one `withExclusiveTransactionAsync`.
- **ACK:** `messages` status→sent (+ server fields) + `outbox` delete in one transaction.
- **Fail/backoff:** `outbox` update (attempts, next_attempt_at, last_error, state) — single row.

All writes stay fire-and-forget from the render path (never awaited by UI), consistent with the
never-throw `cacheService` facade.

---

## 10. Repository responsibilities

### 10.1 New `OutboxRepository` (interface in `repositories/types.ts`)

```
interface OutboxRepository {
  enqueue(message: MessageWithMeta, createdAt: string): Promise<void>;   // message+outbox row, one txn
  listAll(): Promise<OutboxItem[]>;                                      // JOIN messages, FIFO by created_at; drain + resume
  markSent(id: string, serverRow: MessageWithMeta): Promise<void>;       // status=sent + delete outbox, one txn
  markFailed(id: string, error: string, permanent: boolean): Promise<void>;
  reschedule(id: string, attempts: number, nextAttemptAt: string, error: string): Promise<void>;
  remove(id: string): Promise<void>;                                     // discard (message + outbox), one txn
  clear(): Promise<void>;                                                // logout parity
}
// OutboxItem = { message: MessageWithMeta; attempts: number; next_attempt_at: string | null; state }
// (No `listDue`: the due-check must be applied head-first per room to preserve §6.2 FIFO, so the
//  worker evaluates the single ordered `listAll` set itself — §3.2 — rather than a row-level filter.)
```

- **Owns synchronization state (Invariant #3):** durable queue rows, the FIFO read order, the
  monotonic per-room `created_at` guard (§6.3), and the atomic state transitions. It knows the queue;
  it does **not** know about networks, timers, or retry policy (that is `outboxService`). This mirrors
  Phase 4's split where `mergeMessageWindow`/`sync_state` are repository-owned and `syncService`
  orchestrates.
- Pure row↔domain mapping; added to the `Repositories` bundle in `sqlite.ts` + `createRepositories`.

### 10.2 Existing repositories — reused

| Repo | Used by Phase 5A | Change |
|------|------------------|--------|
| `MessageRepository` | `upsertMany` (pending row), `getPageByRoom` (hydrate incl. pending), `deleteById` (discard) | **+`status` in row-mapping** (§9.1); pending-aware page read is automatic (status is just a column) |
| `SyncStateRepository` | untouched | none — outbox never advances the messages cursor for un-ACKed rows (§9.2) |

> The merge stays the Phase-4 repository-owned `mergeMessageWindow`. Invariant #5 ("merge remains
> idempotent") is inherited unchanged: a pending row and its eventual server echo share an id, so
> merge/echo/delta all collapse to one row.

---

## 11. Store responsibilities

### 11.1 `chatStore` (additive; public API preserved)

- **Render annotation:** messages carry an optional client-only `outbox_status?: 'pending' | 'failed'`
  (absent = normal/sent). Set when hydrating an outbox-backed row and when enqueuing; cleared on ACK.
  This is a **client-only** field on the domain alias in `src/types/index.ts` — never sent to the
  server, never in `database.ts`.
- **`enqueueOptimistic(message)`** (generalizes `addOptimisticMessage`): prepend to RAM with
  `outbox_status='pending'` **and** persist via `cacheService.enqueueOutbox`. (Flag off → the old
  RAM-only `addOptimisticMessage`.)
- **`markMessageSent(serverRow)`** (generalizes `replaceOptimisticMessage`): keyed by id — adopt
  server fields, drop `outbox_status`; no-op if already promoted (echo raced). Persists sent row.
- **`markMessageFailed(id)`**: set `outbox_status='failed'` on the RAM row (persisted by the repo).
- **`removeMessage`**: already exists; discard path reuses it + `cacheService.removeOutbox`.
- Window-cap rules, selectors, realtime handlers: **unchanged**.

### 11.2 What stores do NOT do

- Stores never talk to the network, never run timers/backoff, never enumerate the queue. They expose
  mutators the `outboxService` calls. The queue lives in the repository; the policy lives in the
  service; the store only renders and holds the annotation (Zustand "select individual fields" rule).

---

## 12. Failure scenarios

| # | Scenario | Behavior |
|---|----------|----------|
| F1 | **No network at send** | Persist PENDING, render "đang gửi"; worker waits for a network/foreground wake; delivers on reconnect. Nothing lost. |
| F2 | **Network drops mid-flight** | RPC rejects → transient → backoff, stay PENDING; re-drive later (idempotent). |
| F3 | **App killed while PENDING** | Row + outbox persisted → on relaunch `resume()` re-drives (§8). |
| F4 | **App killed *between* RPC-success and local ACK-commit** | Re-drive on launch → RPC returns existing row → promote to sent. No dup (§4.2). |
| F5 | **Server 5xx / timeout** | transient → backoff (2s→4s→8s→16s, cap 30s) up to `OUTBOX_MAX_ATTEMPTS`; then → FAILED (manual retry). |
| F6 | **RLS reject / room deleted / not a member** | permanent → FAILED immediately (no futile retries); "Gửi lỗi · Thử lại / Xóa". |
| F7 | **Duplicate realtime echo** | id dedup at store + merge → single row (§5). |
| F8 | **Clock skew backward between sends** | per-room monotonic `created_at` guard keeps intra-room order (§6.3). |
| F9 | **Storage full / SQLite write fails** | `cacheService` never throws → falls back to today's in-RAM optimistic (message shows, but no durability); error logged. Degrade, don't crash. |
| F10 | **Web (no SQLite)** | outbox repo absent → `cacheService` outbox methods no-op → flag effectively behaves like today's RAM-only send (no durability on web). Documented, no crash. |
| F11 | **Edit/recall a PENDING message** | local mutation only (§7.4). |
| F12 | **Media send offline** (out of scope) | today's in-session optimistic + remove-on-error, flag-gated identical. |
| F13 | **Very large backlog after long offline** | FIFO drain, single-flight per room; UI stays responsive (fire-and-forget); no thundering herd (sequential per room). |

---

## 13. Sequence diagrams

### 13.1 Online send — happy path

```
useMessages     chatStore/cacheService        outboxService        messageService/Supabase
   │ send(text)      │                             │                        │
   │ id=randomUUID() │                             │                        │
   │ enqueueOptimistic(msg) ─► RAM(pending)+SQLite(status=pending,outbox)    │
   │────────────────►│ (txn commit)                │                        │
   │ poke() ─────────────────────────────────────► │ pick msg (single-flight)│
   │                 │                             │ sendMessageIdempotent() ─►│ INSERT (new id)
   │                 │                             │◄────────────────────────│ RETURNS row
   │                 │  markMessageSent(row) ◄──── │ markSent: status=sent,   │
   │                 │  (drop outbox_status)       │ delete outbox (txn)      │
   │  bubble: clock → sent ✔                       │                        │
   (realtime echo for same id later → addMessage no-op, already present)
```

### 13.2 Offline send → restart → reconnect

```
[offline]
 send → enqueueOptimistic → RAM(pending)+SQLite    worker: RPC fails (network) → backoff, stay PENDING
 ...app killed...
[relaunch, still offline]
 db.init (migrate) → hydrate room → pending bubble "đang gửi" painted from SQLite
 outboxService.resume() → schedules from next_attempt_at
[network returns]
 NetInfo/foreground wake → listDue → RPC insert-or-return → markSent → bubble "sent" ✔   (single delivery)
```

### 13.3 Missed ACK (idempotent retry)

```
worker         Supabase
  │ RPC(id=U) ──► INSERT U ok
  │      X◄────── (response lost: network drop after commit)
  │ (transient) backoff, re-drive
  │ RPC(id=U) ──► ON CONFLICT DO NOTHING; RETURN existing U
  │◄───────────── row U
  │ markSent(U)  → status=sent, delete outbox     (NO duplicate row on server or client)
```

### 13.4 Permanent failure → manual retry

```
worker                         Supabase                 useMessages / UI
  │ RPC(id=U) ──► 403 RLS (not a member) │                     │
  │◄──────────────────────────────────── │                     │
  │ markFailed(U, permanent=true)         │                     │
  │  status=failed (outbox parked)        │──► bubble "Gửi lỗi · Thử lại / Xóa"
  │                                       │   user taps Thử lại │
  │◄──────────────────────────────────────── retryMessage(U) ──│
  │ reset attempts, state=pending, poke() │                     │
```

---

## 14. Rollout strategy

1. **Ship dormant.** Land migration 00018 (RPC), SQLite v3, `OutboxRepository`, `outboxService`, and
   the flagged store/hook changes with `FEATURE_OFFLINE_OUTBOX = false`. Flag off = today's
   `temp-`/RAM-only/remove-on-error path, byte-identical. The `outbox` table exists but is never
   written.
2. **Internal dogfood.** Flip locally. Validate the §15.5 checklist on a real device with airplane
   mode + force-quit.
3. **Staged enable.** Client-constant flag enabled via build/OTA to a small cohort; watch
   `get_logs` for RPC errors and client `console.error("[outboxService] …")`; watch for any
   duplicate-message reports (should be zero by construction).
4. **Full enable.** Flip default to `true`.
5. **Kill switch.** Regression → `FEATURE_OFFLINE_OUTBOX = false` (one line) → instant revert to the
   proven path. Any messages already persisted as pending are drained by the still-present RPC on the
   next launch even with the flag off *if* `resume()` is left wired (recommended) — or simply retried
   once the flag returns. No data migration needed (cache is droppable).
6. **Cache-version safety.** A post-release outbox/schema issue → bump `LATEST_SCHEMA_VERSION` → next
   launch rebuilds SQLite cold (server remains source of truth). Unsent pending messages would be
   lost by a cold wipe, so prefer the flag kill-switch over a wipe unless the table is corrupt.
7. **Server compatibility.** `send_message_idempotent` coexists with the existing direct
   `INSERT` send (`messageService.sendMessage`) — the RPC is additive; the plain insert stays for the
   flag-off path. Nothing is deleted.

---

## 15. Test strategy

> The repo has **no test runner** and Phase-4 §15.6 forbids adding a dependency, so automated suites
> below are specified as the intended coverage; enforcement is the **manual E2E checklist (§15.5)**
> plus `tsc` + the layering grep — consistent with the Phase 4B decision.

### 15.1 Unit — idempotency & lifecycle (pure)

- Enqueue mints a UUID (not `temp-`); the same id is reused across simulated retries.
- State machine: pending→sent deletes outbox; pending→failed parks; failed→retry resets attempts.
- `markMessageSent` keyed by id is a no-op when the row was already promoted (echo race).

### 15.2 Unit — ordering & backoff

- FIFO: two enqueues in a room → delivered in `created_at` order; N+1 blocked while N is retrying.
- Monotonic `created_at` guard survives a simulated backward clock jump (intra-room order stable).
- Backoff sequence 2s/4s/8s/16s(cap 30s), then FAILED after `OUTBOX_MAX_ATTEMPTS`.
- Permanent error (403/422) → FAILED immediately, no backoff.

### 15.3 Unit — duplicate prevention

- Realtime echo before ACK → single row.
- Concurrent worker wakes (network + timer) → single-flight set prevents double RPC for one id.

### 15.4 Integration (SQLite, native/dev-client)

- Enqueue → kill process → reopen: pending row hydrates and renders; `resume()` re-drives.
- ACK transaction: status=sent AND outbox row deleted atomically.
- Idempotent RPC path: re-drive after a simulated missed ACK returns the existing row; no dup.
- Migration v2→v3 on an existing Phase-4 DB (no data loss; `outbox` created; `status` mapped).

### 15.5 End-to-end (manual)

- [ ] Airplane mode → send 3 texts → all show "đang gửi", persisted. Force-quit. Relaunch (still
      offline) → 3 still "đang gửi". Enable network → exactly 3 delivered once (verify on a 2nd
      device), no duplicates, correct order.
- [ ] Toggle network on/off rapidly during a send → single delivery (missed-ACK idempotency).
- [ ] Send to a room you were removed from → "Gửi lỗi" → tap Xóa removes it; tap Thử lại re-attempts.
- [ ] Edit then let a pending message send → server receives the edited content.
- [ ] **Flag OFF** → send/failure behavior byte-identical to today (temp-, remove-on-error).
- [ ] Web (no SQLite): sends work in-session, no crash, no durability (documented).

### 15.6 Non-functional

- No new dependency in `package.json` (CI check). `expo-crypto` already present for UUIDs.
- `npx tsc --noEmit` clean; `src/db/*` still imported only by `databaseService`/`cacheService`
  (layering grep guard).
- Zero duplicate messages across all E2E runs (the headline correctness metric).

---

## 16. Architectural invariants — compliance

| # | Invariant | How Phase 5A satisfies it |
|---|-----------|---------------------------|
| 1 | **Memory Store remains the rendering source** | Pending/failed messages render from `chatStore.messages` like any row (annotated `outbox_status`); the outbox table is read only by `outboxService` to orchestrate, never by the UI. |
| 2 | **SQLite is persistence only** | `messages.status` + `outbox` are durable state; they feed hydration (→ store → UI) and the worker, never the UI directly. |
| 3 | **Repository owns synchronization** | `OutboxRepository` owns the durable queue: FIFO read order, atomic state transitions, monotonic ordering guard, dedup-by-id storage. `outboxService` only orchestrates timing/network/retry (mirrors syncService/mergeMessageWindow split). |
| 4 | **Outbox survives app restart** | Content, id, created_at, and pending/failed state persist in SQLite; `outboxService.resume()` rebuilds timers from `next_attempt_at` on boot. |
| 5 | **Merge remains idempotent** | Reuses Phase-4 `mergeMessageWindow` keyed by id; client-UUID means echo/delta/outbox all collapse to one row. Un-ACked rows never advance the server cursor (§9.2). |
| 6 | **ACK never creates duplicate messages** | Client id = server PK; `send_message_idempotent` does `ON CONFLICT DO NOTHING` + returns the existing row; store/echo dedup by id. |
| 7 | **Retry never creates duplicate messages** | Same idempotency key across every retry; server returns the existing row; worker single-flight + FIFO prevent concurrent/duplicate drives. |

---

## 17. Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| **Keep `temp-` id + separate `client_tag` idempotency column** | Two ids to reconcile, needs a temp→real swap and echo-matching by tag, extra column + unique index. Client-UUID-as-PK removes the swap entirely and makes dedup structural. |
| **Standalone full-payload outbox table (message not in `messages`)** | Pending messages would need a second render source → violates single-render-source; duplicates the row shape. |
| **Add attempts/next_attempt_at as columns on `messages`** | Pollutes the server-mirror table with client-only queue fields; a sidecar `outbox` keeps `messages` a clean cache of server rows. |
| **Client-side send without an RPC (plain insert + on-conflict select)** | Two round trips and a race on the missed-ACK path; the RPC makes insert-or-return atomic and server-authoritative for `sender_id`. |
| **Global FIFO across all rooms (one serial queue)** | Head-of-line blocking: one stuck room freezes every other room's sends. Per-room FIFO + parallel rooms is the right granularity. |
| **Retry forever on permanent errors** | Wastes battery/network and hides real failures; permanent (4xx/RLS) → FAILED with manual retry is honest. |
| **Queue edits/reactions/recalls as outbox ops now** | Larger blast radius; most value is in message *send*. Pending-message edit/recall handled locally; sent-message ops stay online-only (documented follow-up). |
| **Durable media/album offline send in 5A** | Local file URIs aren't guaranteed to persist; re-upload + storage lifecycle is a separate problem → Phase 5B. |

---

## 18. Implementation checklist (Phase 5A build order)

1. `constants.ts`: `FEATURE_OFFLINE_OUTBOX = false`, `OUTBOX_RETRY_BASE_MS`, `OUTBOX_RETRY_MAX_MS`,
   `OUTBOX_MAX_ATTEMPTS`.
2. Supabase migration 00018: `send_message_idempotent` RPC; apply; regenerate `database.ts`
   (localized cast in `messageService` until then).
3. SQLite migration v3: `outbox` table; wire `status` into message row-mapping (§9.1).
4. `OutboxRepository` interface + SQLite impl + add to `createRepositories`.
5. `cacheService`: outbox never-throw wrappers (§1.3).
6. `messageService.sendMessageIdempotent`.
7. `chatStore`: `outbox_status` annotation, `enqueueOptimistic`, `markMessageSent`,
   `markMessageFailed` (additive; flag-gated).
8. `outboxService.ts`: drain, single-flight, per-room FIFO, backoff, wakeups (network/foreground/
   enqueue), `resume()`, flag delegation.
9. `useMessages`: `sendMessage` → enqueue+persist (flag on); add `retryMessage` / `discardMessage`;
   flag off delegates to today's exact path.
10. App bootstrap: call `outboxService.resume()` after DB init + auth; logout drain-before-wipe (§8.3).
11. UI: pending/failed bubble affordance ("đang gửi" / "Gửi lỗi · Thử lại / Xóa") — Vietnamese.
12. Tests (§15); dogfood with the flag on.

> Every step is additive or flag-gated; between steps the app is never worse than Phase 4, and
> step 12 flips nothing until `FEATURE_OFFLINE_OUTBOX` is set.
