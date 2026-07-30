import { diag } from "@/src/lib/diagnostics";
import { mergeMessageWindow } from "@/src/db/repositories/merge";
import { MESSAGE_WINDOW_SIZE } from "@/src/lib/constants";
import { makeMessages, makeDelta, nowMs } from "@/src/diagnostics/fixtures";

/**
 * Benchmark harness (Phase 6B — design §4).
 *
 * Dev-only. Measures two things the reliability layer must keep cheap:
 *  1. Tap overhead — the cost of a diagnostics write with the flag OFF vs ON.
 *     This is the empirical proof of the "zero overhead when disabled" budget
 *     (§11): a disabled tap should be within noise of an empty loop.
 *  2. Merge throughput — the repository-owned `mergeMessageWindow` (the one
 *     function on the sync hot path) across 100 / 500 / 1000-row windows.
 *
 * It only calls pure functions and the passive registry, so it perturbs no
 * store, no SQLite, no network (Invariants #1–#3). Restores the registry's
 * enabled state and clears its own series on exit so it leaves no residue.
 */

export interface OpTiming {
  label: string;
  iterations: number;
  totalMs: number;
  nsPerOp: number;
}

export interface MergeTiming {
  window: number;
  deltaRows: number;
  iterations: number;
  msPerMerge: number;
}

export interface BenchmarkReport {
  tapOverhead: OpTiming[];
  merge: MergeTiming[];
}

function timeLoop(label: string, iterations: number, fn: () => void): OpTiming {
  // Warm the JIT before measuring.
  for (let i = 0; i < Math.min(iterations, 1000); i++) fn();
  const start = nowMs();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = nowMs() - start;
  return {
    label,
    iterations,
    totalMs,
    nsPerOp: (totalMs * 1e6) / iterations,
  };
}

export const benchmarkHarness = {
  /**
   * Run the full benchmark suite. `iterations` controls the tap-overhead loop;
   * the merge sizes are fixed at the design's 100/500/1000 targets. Safe to run
   * regardless of the flag — it saves and restores the enabled state itself.
   */
  run(iterations: number = 200000): BenchmarkReport {
    const wasEnabled = diag.enabled();
    const report: BenchmarkReport = { tapOverhead: [], merge: [] };

    try {
      // --- 1. Tap overhead (disabled = the production cost) --------------
      diag.setEnabled(false);
      report.tapOverhead.push(
        timeLoop("count (disabled)", iterations, () =>
          diag.count("bench.noop", 1)
        )
      );
      report.tapOverhead.push(
        timeLoop("observe (disabled)", iterations, () =>
          diag.observe("bench.noop", 3)
        )
      );

      // --- Tap overhead (enabled = the debug-session cost) ---------------
      diag.setEnabled(true);
      report.tapOverhead.push(
        timeLoop("count (enabled)", iterations, () =>
          diag.count("bench.count", 1)
        )
      );
      report.tapOverhead.push(
        timeLoop("observe (enabled)", iterations, () =>
          diag.observe("bench.observe", 3)
        )
      );
      report.tapOverhead.push(
        timeLoop("event (enabled)", iterations, () =>
          diag.event("bench.event", { i: 1 })
        )
      );

      // --- 2. Merge throughput at 100 / 500 / 1000 ----------------------
      for (const window of [100, 500, 1000]) {
        const existing = makeMessages("bench-room", window);
        const delta = makeDelta("bench-room", 50);
        const mergeIters = 2000;
        // Warm.
        for (let i = 0; i < 200; i++)
          mergeMessageWindow(existing, delta, MESSAGE_WINDOW_SIZE);
        const start = nowMs();
        for (let i = 0; i < mergeIters; i++)
          mergeMessageWindow(existing, delta, MESSAGE_WINDOW_SIZE);
        const totalMs = nowMs() - start;
        report.merge.push({
          window,
          deltaRows: delta.length,
          iterations: mergeIters,
          msPerMerge: totalMs / mergeIters,
        });
      }

      return report;
    } catch (err) {
      console.error("[benchmarkHarness] run", err);
      return report;
    } finally {
      // Leave no residue: drop the bench series and restore the flag.
      diag.reset();
      diag.setEnabled(wasEnabled);
    }
  },
};
