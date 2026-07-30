import { diag } from "@/src/lib/diagnostics";
import { mergeMessageWindow } from "@/src/db/repositories/merge";
import {
  DIAG_MAX_SERIES,
  DIAG_RING_CAPACITY,
  MESSAGE_WINDOW_SIZE,
} from "@/src/lib/constants";
import { makeMessages, makeDelta, nowMs } from "@/src/diagnostics/fixtures";

/**
 * Stress harness (Phase 6B — design §5).
 *
 * Dev-only. Floods the passive registry and the merge hot path far beyond any
 * realistic production rate and asserts the *bounds hold* — the whole point of
 * "bounded by construction" (§10). It proves:
 *  - Series cardinality never exceeds DIAG_MAX_SERIES even under a flood of
 *    distinct label values (a mislabeled tap can't leak the registry).
 *  - The event ring never exceeds DIAG_RING_CAPACITY (oldest overwritten).
 *  - Repeated large merges stay capped at the in-memory window size and produce
 *    a correctly ordered, duplicate-free window every time (idempotence).
 *
 * Pure/registry only — no store, SQLite, or network. Restores the flag and
 * clears its series on exit.
 */

export interface StressReport {
  ok: boolean;
  seriesPushed: number;
  seriesHeld: number;
  seriesCap: number;
  eventsPushed: number;
  eventsHeld: number;
  eventCap: number;
  mergeRounds: number;
  maxWindowSeen: number;
  windowCap: number;
  mergeOrderingOk: boolean;
  mergeDedupOk: boolean;
  totalMs: number;
}

function isNewestFirstUnique(rows: { id: string; created_at?: string | null }[]): {
  ordered: boolean;
  unique: boolean;
} {
  const seen = new Set<string>();
  let ordered = true;
  let unique = true;
  let prev = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (seen.has(r.id)) unique = false;
    seen.add(r.id);
    const t = new Date(r.created_at ?? 0).getTime();
    if (t > prev) ordered = false;
    prev = t;
  }
  return { ordered, unique };
}

export const stressHarness = {
  /**
   * Hammer the registry and merge. `seriesPushed`/`eventsPushed` default well
   * past the caps so the guards are actually exercised. Never throws.
   */
  run(
    seriesPushed: number = DIAG_MAX_SERIES * 4,
    eventsPushed: number = DIAG_RING_CAPACITY * 4,
    mergeRounds: number = 500
  ): StressReport {
    const wasEnabled = diag.enabled();
    const start = nowMs();
    const report: StressReport = {
      ok: false,
      seriesPushed,
      seriesHeld: 0,
      seriesCap: DIAG_MAX_SERIES,
      eventsPushed,
      eventsHeld: 0,
      eventCap: DIAG_RING_CAPACITY,
      mergeRounds,
      maxWindowSeen: 0,
      windowCap: MESSAGE_WINDOW_SIZE,
      mergeOrderingOk: true,
      mergeDedupOk: true,
      totalMs: 0,
    };

    try {
      diag.setEnabled(true);
      diag.reset();

      // --- Cardinality flood: each distinct label = a would-be new series ---
      for (let i = 0; i < seriesPushed; i++) {
        diag.count("stress.card", 1, { k: String(i) });
      }

      // --- Event ring flood -------------------------------------------------
      for (let i = 0; i < eventsPushed; i++) {
        diag.event("stress.evt", { i });
      }

      const snap = diag.snapshot();
      report.seriesHeld = snap.series;
      report.eventsHeld = snap.events.length;

      // --- Merge flood: repeatedly merge fresh deltas into a full window ----
      let existing = makeMessages("stress-room", MESSAGE_WINDOW_SIZE);
      for (let round = 0; round < mergeRounds; round++) {
        const delta = makeDelta(
          "stress-room",
          200,
          Date.UTC(2025, 1, 1) + round * 200_000
        );
        existing = mergeMessageWindow(existing, delta, MESSAGE_WINDOW_SIZE);
        if (existing.length > report.maxWindowSeen)
          report.maxWindowSeen = existing.length;
        const { ordered, unique } = isNewestFirstUnique(existing);
        if (!ordered) report.mergeOrderingOk = false;
        if (!unique) report.mergeDedupOk = false;
      }

      report.ok =
        report.seriesHeld <= DIAG_MAX_SERIES &&
        report.eventsHeld <= DIAG_RING_CAPACITY &&
        report.maxWindowSeen <= MESSAGE_WINDOW_SIZE &&
        report.mergeOrderingOk &&
        report.mergeDedupOk;

      report.totalMs = nowMs() - start;
      return report;
    } catch (err) {
      console.error("[stressHarness] run", err);
      report.totalMs = nowMs() - start;
      return report;
    } finally {
      diag.reset();
      diag.setEnabled(wasEnabled);
    }
  },
};
