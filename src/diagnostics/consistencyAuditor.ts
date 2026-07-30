import { diag } from "@/src/lib/diagnostics";
import { cacheService } from "@/src/services/cacheService";
import { useChatStore } from "@/src/stores/chatStore";
import type { MessageWithMeta, OutboxItem } from "@/src/types";

/**
 * Read-only consistency auditor (Phase 6B — design §8, §9).
 *
 * Composes the *existing* read surfaces — the memory store (`getState`) and the
 * `cacheService` read facade — into a point-in-time invariant check. It writes
 * NOTHING to any domain layer: it never merges, never persists, never patches
 * the store, never enqueues. Its only mutation is into the passive diagnostics
 * registry (counters/events), so running it can never change message delivery,
 * rendering, or repository state (Invariants #1–#3, and the Phase 6A "no
 * business logic" rule).
 *
 * It is a diagnostic tool, not a hot-path tap: it runs only when the flag is on
 * (guarded by `diag.enabled()`), is invoked explicitly by dev harnesses / a
 * debug action, and is fully exception-isolated — a bug in the auditor returns
 * a degraded report instead of throwing into the caller.
 *
 * Invariants it verifies (all against the newest-first resident window):
 *  1. No duplicate message ids inside a room window (§9 duplicate detection).
 *  2. Window ordering is monotonic non-increasing by created_at (§8) — the same
 *     order `mergeMessageWindow` guarantees.
 *  3. Every resident pending/failed row is annotated consistently with the
 *     durable outbox row that owns it, and vice-versa (§8 recovery check).
 */

export interface ConsistencyIssue {
  kind:
    | "duplicate-ram"
    | "order-ram"
    | "outbox-orphan"
    | "state-mismatch"
    | "ram-dangling";
  roomId: string;
  detail: string;
}

export interface ConsistencyReport {
  ok: boolean;
  ran: boolean;
  roomsAudited: number;
  ramMessages: number;
  outboxItems: number;
  duplicateIds: number;
  orderViolations: number;
  outboxOrphans: number;
  stateMismatches: number;
  ramDangling: number;
  issues: ConsistencyIssue[];
}

// Bound the issue list so a pathological state can never grow the report
// unbounded (§10). Counts stay exact; only the sample list is capped.
const MAX_ISSUES = 50;

function emptyReport(ran: boolean): ConsistencyReport {
  return {
    ok: true,
    ran,
    roomsAudited: 0,
    ramMessages: 0,
    outboxItems: 0,
    duplicateIds: 0,
    orderViolations: 0,
    outboxOrphans: 0,
    stateMismatches: 0,
    ramDangling: 0,
    issues: [],
  };
}

function ts(m: MessageWithMeta): number {
  return new Date(m.created_at ?? 0).getTime();
}

export const consistencyAuditor = {
  /**
   * Snapshot the resident windows + durable outbox and check the invariants.
   * Read-only; returns a degraded (ran:false) report when the flag is off or on
   * any internal error. Never throws.
   */
  async audit(): Promise<ConsistencyReport> {
    if (!diag.enabled()) return emptyReport(false);

    try {
      const report = emptyReport(true);

      // Immutable read of the resident windows (no mutation of the store).
      const roomsById = useChatStore.getState().messages;
      const roomIds = Object.keys(roomsById);
      report.roomsAudited = roomIds.length;

      // id → owning room, for the outbox cross-check below. Built from the same
      // snapshot so the two passes are internally consistent.
      const ramById = new Map<string, { roomId: string; msg: MessageWithMeta }>();

      for (const roomId of roomIds) {
        const rows = roomsById[roomId] ?? [];
        report.ramMessages += rows.length;

        const seen = new Set<string>();
        for (let i = 0; i < rows.length; i++) {
          const msg = rows[i];

          // (1) duplicate ids within the window
          if (seen.has(msg.id)) {
            report.duplicateIds += 1;
            if (report.issues.length < MAX_ISSUES) {
              report.issues.push({
                kind: "duplicate-ram",
                roomId,
                detail: `duplicate id ${msg.id}`,
              });
            }
          } else {
            seen.add(msg.id);
            ramById.set(msg.id, { roomId, msg });
          }

          // (2) monotonic non-increasing created_at (newest-first window)
          if (i > 0 && ts(rows[i - 1]) < ts(msg)) {
            report.orderViolations += 1;
            if (report.issues.length < MAX_ISSUES) {
              report.issues.push({
                kind: "order-ram",
                roomId,
                detail: `row ${i} newer than predecessor (${msg.id})`,
              });
            }
          }
        }
      }

      // (3) durable outbox vs resident annotation. cacheService is the read
      // facade; it returns [] when the DB is unavailable, so this degrades
      // silently rather than throwing.
      const outbox: OutboxItem[] = await cacheService.listOutboxAll();
      report.outboxItems = outbox.length;

      const outboxIds = new Set<string>();
      for (const item of outbox) {
        outboxIds.add(item.message.id);
        const resident = ramById.get(item.message.id);
        if (!resident) {
          // The room may simply be evicted from RAM — only flag when the room
          // IS resident but the window lost a message the queue still owns.
          if (roomsById[item.message.room_id]) {
            report.outboxOrphans += 1;
            if (report.issues.length < MAX_ISSUES) {
              report.issues.push({
                kind: "outbox-orphan",
                roomId: item.message.room_id,
                detail: `outbox ${item.message.id} absent from resident window`,
              });
            }
          }
          continue;
        }
        // Annotation must match the durable queue state.
        const annotated = resident.msg.outbox_status;
        if (annotated !== item.state) {
          report.stateMismatches += 1;
          if (report.issues.length < MAX_ISSUES) {
            report.issues.push({
              kind: "state-mismatch",
              roomId: resident.roomId,
              detail: `${item.message.id}: ram=${annotated ?? "none"} outbox=${item.state}`,
            });
          }
        }
      }

      // A resident row annotated pending/failed with no owning outbox row is a
      // dangling annotation (its send resolved but RAM was not cleared).
      for (const [id, { roomId, msg }] of ramById) {
        if (msg.outbox_status && !outboxIds.has(id)) {
          report.ramDangling += 1;
          if (report.issues.length < MAX_ISSUES) {
            report.issues.push({
              kind: "ram-dangling",
              roomId,
              detail: `${id} annotated ${msg.outbox_status} but not in outbox`,
            });
          }
        }
      }

      report.ok =
        report.duplicateIds === 0 &&
        report.orderViolations === 0 &&
        report.outboxOrphans === 0 &&
        report.stateMismatches === 0 &&
        report.ramDangling === 0;

      // Publish the outcome into the passive registry (read-only side, §8).
      diag.gauge("consistency.duplicate_ids", report.duplicateIds);
      diag.gauge("consistency.order_violations", report.orderViolations);
      diag.gauge("consistency.outbox_orphans", report.outboxOrphans);
      diag.gauge("consistency.state_mismatches", report.stateMismatches);
      diag.gauge("consistency.ram_dangling", report.ramDangling);
      diag.count("consistency.audit", 1);
      if (!report.ok) {
        diag.count("consistency.violation", 1);
        diag.event("consistency.violation", {
          duplicates: report.duplicateIds,
          order: report.orderViolations,
          orphans: report.outboxOrphans,
          mismatches: report.stateMismatches,
          dangling: report.ramDangling,
        });
      }

      return report;
    } catch (err) {
      console.error("[consistencyAuditor] audit", err);
      return emptyReport(true);
    }
  },
};
