import { diag } from "@/src/lib/diagnostics";
import { benchmarkHarness } from "@/src/diagnostics/benchmarkHarness";
import type { BenchmarkReport } from "@/src/diagnostics/benchmarkHarness";
import { stressHarness } from "@/src/diagnostics/stressHarness";
import type { StressReport } from "@/src/diagnostics/stressHarness";
import { chaosHarness } from "@/src/diagnostics/chaosHarness";
import type { ChaosProfile, ChaosReport } from "@/src/diagnostics/chaosHarness";
import { consistencyAuditor } from "@/src/diagnostics/consistencyAuditor";
import type { ConsistencyReport } from "@/src/diagnostics/consistencyAuditor";
import { memoryLeakDetector } from "@/src/diagnostics/memoryLeakDetector";

/**
 * Reliability & consistency diagnostics — public barrel (Phase 6B).
 *
 * Everything here is dev/flag-gated and passive. Import the pieces directly for
 * targeted use, or call `runReliabilitySuite()` from a dev console / debug
 * action to produce the benchmark + stress + chaos + audit report in one shot.
 */

export { diag } from "@/src/lib/diagnostics";
export { benchmarkHarness } from "@/src/diagnostics/benchmarkHarness";
export { stressHarness } from "@/src/diagnostics/stressHarness";
export { chaosHarness } from "@/src/diagnostics/chaosHarness";
export { consistencyAuditor } from "@/src/diagnostics/consistencyAuditor";
export { memoryLeakDetector } from "@/src/diagnostics/memoryLeakDetector";
export type { BenchmarkReport } from "@/src/diagnostics/benchmarkHarness";
export type { StressReport } from "@/src/diagnostics/stressHarness";
export type { ChaosProfile, ChaosReport } from "@/src/diagnostics/chaosHarness";
export type { ConsistencyReport } from "@/src/diagnostics/consistencyAuditor";

export interface ReliabilitySuiteReport {
  benchmark: BenchmarkReport;
  stress: StressReport;
  chaos: ChaosReport[];
  audit: ConsistencyReport;
}

/**
 * One-shot dev runner. Safe to call from anywhere: it flips diagnostics on for
 * the duration, runs every harness, then restores the previous enabled state.
 * Never throws — each harness is already exception-isolated.
 */
export async function runReliabilitySuite(): Promise<ReliabilitySuiteReport> {
  const wasEnabled = diag.enabled();
  diag.setEnabled(true);
  try {
    const benchmark = benchmarkHarness.run();
    const stress = stressHarness.run();
    const profiles: ChaosProfile[] = ["transient", "permanent", "flaky"];
    const chaos: ChaosReport[] = [];
    for (const p of profiles) chaos.push(await chaosHarness.run(p));
    const audit = await consistencyAuditor.audit();
    return { benchmark, stress, chaos, audit };
  } finally {
    diag.setEnabled(wasEnabled);
  }
}

// Keep the tree-shaker from dropping the detector export when unused elsewhere.
export const _detector = memoryLeakDetector;
