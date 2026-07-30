import type { MessageWithMeta, UploadTask } from "@/src/types";

/**
 * Synthetic fixtures for the dev-only diagnostics harnesses (Phase 6B — §4–§6).
 *
 * These build in-memory `MessageWithMeta` rows to exercise the *pure* building
 * blocks (the repository-owned merge, the registry) under load. They never
 * touch SQLite, Supabase, or the store — a harness measuring throughput must
 * not perturb real state (Invariants #1–#3). The cast is deliberate: a harness
 * fixture only needs the fields the pure functions read (id, created_at), so we
 * synthesize those and cast rather than enumerate every DB column.
 */

// Build `count` newest-first rows for room `roomId`, oldest at `baseMs`.
export function makeMessages(
  roomId: string,
  count: number,
  baseMs: number = Date.UTC(2025, 0, 1)
): MessageWithMeta[] {
  const rows: MessageWithMeta[] = [];
  for (let i = 0; i < count; i++) {
    // Newest-first: index 0 is the most recent (largest created_at).
    const createdMs = baseMs + (count - 1 - i) * 1000;
    rows.push({
      id: `${roomId}-msg-${i}`,
      room_id: roomId,
      created_at: new Date(createdMs).toISOString(),
      content: `bench ${i}`,
      type: "text",
    } as unknown as MessageWithMeta);
  }
  return rows;
}

// A delta batch of `count` NEW rows that continue after `afterMs` (no overlap).
export function makeDelta(
  roomId: string,
  count: number,
  afterMs: number = Date.UTC(2025, 0, 2)
): MessageWithMeta[] {
  const rows: MessageWithMeta[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `${roomId}-delta-${i}`,
      room_id: roomId,
      created_at: new Date(afterMs + i * 1000).toISOString(),
      content: `delta ${i}`,
      type: "text",
    } as unknown as MessageWithMeta);
  }
  return rows;
}

// High-resolution clock; falls back to Date.now when performance is absent.
export function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

// Build `count` synthetic upload tasks for one message (Phase 7B media
// benchmarks). Pure in-memory rows shaped like `upload_queue` output: enough
// to exercise the drain due-filter / FIFO selection and the gate attachment
// map without SQLite, FS, or network (Invariants #1–#3). `state`/`nextAt` let
// callers model queued/uploading mixes and backoff windows.
export function makeUploadTasks(
  count: number,
  opts: {
    messageId?: string;
    roomId?: string;
    baseMs?: number;
    state?: UploadTask["state"];
  } = {}
): UploadTask[] {
  const {
    messageId = "bench-msg",
    roomId = "bench-room",
    baseMs = Date.UTC(2025, 0, 1),
    state = "queued",
  } = opts;
  const rows: UploadTask[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `${messageId}-task-${i}`,
      message_id: messageId,
      room_id: roomId,
      position: i,
      kind: "image",
      local_uri: `file:///media/outbox/${messageId}/${i}.jpg`,
      mime: "image/jpeg",
      bytes: 120_000,
      width: 1080,
      height: 1440,
      duration_ms: null,
      thumb: "data:image/jpeg;base64,AAAA",
      remote_path: null,
      remote_url: null,
      state,
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      created_at: new Date(baseMs + i * 1000).toISOString(),
      updated_at: null,
    });
  }
  return rows;
}

// Build `count` synthetic chat messages spanning every search lane (Phase 8B
// search benchmarks). Pure in-memory rows shaped like `MessageWithMeta`: enough
// to exercise `buildSearchDoc` / `buildMediaText` across all four media_text
// branches (plain text, image + file attachments, and link-body hosts) without
// SQLite, FTS, or network (Invariants #1–#3). Deterministic: the same `count`
// and `baseMs` always yield byte-identical corpora so bench runs compare.
export function makeSearchCorpus(
  count: number,
  baseMs: number = Date.UTC(2025, 0, 1)
): MessageWithMeta[] {
  const vn = [
    "báo cáo",
    "hàng tháng",
    "cảm ơn",
    "hẹn gặp",
    "dự án",
    "tài liệu",
    "cuộc họp",
    "kế hoạch",
  ];
  const en = [
    "report",
    "monthly",
    "thanks",
    "meeting",
    "project",
    "document",
    "invoice",
    "design",
  ];
  const hosts = ["figma.com", "github.com", "docs.google.com", "notion.so"];
  const rows: MessageWithMeta[] = [];
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(baseMs + i * 1000).toISOString();
    const base = {
      id: `search-${i}`,
      room_id: `room-${i % 20}`,
      sender_id: `user-${i % 50}`,
      created_at: createdAt,
      updated_at: null,
      deleted_at: null,
    };
    const lane = i % 5;
    let extra: Record<string, unknown>;
    if (lane === 3) {
      // media lane: alternate image / file with a searchable filename.
      const isImage = i % 2 === 0;
      extra = {
        type: isImage ? "image" : "file",
        content: null,
        has_link: false,
        attachments: [
          {
            url: `https://cdn.example.com/${base.room_id}/${
              isImage ? `photo-${i}.jpg` : `report-${i}.pdf`
            }`,
            kind: isImage ? "image" : "file",
            name: isImage ? `photo-${i}.jpg` : `${en[i % en.length]}-${i}.pdf`,
          },
        ],
      };
    } else if (lane === 4) {
      // link lane: URL in the body, has_link set (host → media_text).
      const host = hosts[i % hosts.length];
      extra = {
        type: "text",
        content: `${vn[i % vn.length]} https://${host}/f/${i}`,
        has_link: true,
        attachments: null,
      };
    } else {
      // text lane: mixed VN/EN body, no media.
      extra = {
        type: "text",
        content: `${vn[i % vn.length]} ${en[i % en.length]} #${i}`,
        has_link: false,
        attachments: null,
      };
    }
    rows.push({ ...base, ...extra } as unknown as MessageWithMeta);
  }
  return rows;
}
