import { diag } from "@/src/lib/diagnostics";
import { messageService } from "@/src/services/messageService";
import { outboxService } from "@/src/services/outboxService";
import { consistencyAuditor } from "@/src/diagnostics/consistencyAuditor";
import type { ConsistencyReport } from "@/src/diagnostics/consistencyAuditor";
import type { Message } from "@/src/types";

/**
 * Chaos harness (Phase 6B — design §6).
 *
 * Dev-only fault injection. It does NOT alter the outbox algorithm: it swaps
 * the *network leaf* — `messageService.sendMessageIdempotent` — for a fault
 * generator, drives the real worker (`outboxService`), then restores the leaf
 * in `finally`. The worker's retry/backoff/park logic and the repository's
 * ownership are exercised exactly as in production; only the transport lies.
 * Because the swap is reverted unconditionally, production code is unchanged
 * and no residue survives the run (the swap only lives inside this call).
 *
 * It needs `FEATURE_OFFLINE_OUTBOX` on AND a live local DB to drive real work;
 * in a repo-less/flag-off environment `outboxService` no-ops, so the harness
 * simply reports an empty run — it never fabricates results. It is fully
 * exception-isolated and always restores the transport and the flag.
 */

export type ChaosProfile = "permanent" | "transient" | "flaky";

export interface ChaosReport {
  profile: ChaosProfile;
  drove: boolean;
  injectedCalls: number;
  attempts: number;
  retriesScheduled: number;
  parked: number;
  sent: number;
  auditOk: boolean;
  audit: ConsistencyReport | null;
}

// A Postgres-integrity-shaped error (SQLSTATE 23xxx) → classified permanent.
function permanentError(): never {
  throw { code: "23505", message: "chaos: unique_violation" };
}
// A 5xx-shaped error → classified transient (backoff & retry).
function transientError(): never {
  throw { status: 503, message: "chaos: service unavailable" };
}

function fakeRow(payload: { id: string; room_id: string; content: string }): Message {
  return {
    id: payload.id,
    room_id: payload.room_id,
    content: payload.content,
    created_at: new Date().toISOString(),
  } as unknown as Message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const chaosHarness = {
  /**
   * Run one chaos scenario. `settleMs` bounds how long we let the worker churn
   * before snapshotting (the harness never blocks on full backoff cycles).
   */
  async run(
    profile: ChaosProfile = "transient",
    settleMs: number = 500
  ): Promise<ChaosReport> {
    const wasEnabled = diag.enabled();
    const original = messageService.sendMessageIdempotent;
    let injectedCalls = 0;

    const report: ChaosReport = {
      profile,
      drove: false,
      injectedCalls: 0,
      attempts: 0,
      retriesScheduled: 0,
      parked: 0,
      sent: 0,
      auditOk: true,
      audit: null,
    };

    try {
      diag.setEnabled(true);

      // Baselines so the report reflects THIS run's deltas, not lifetime totals.
      const attempts0 = diag.getCounter("outbox.attempt");
      const retries0 = diag.getCounter("outbox.retry_scheduled");
      const parkedPerm0 = diag.getCounter("outbox.parked", { reason: "permanent" });
      const parkedMax0 = diag.getCounter("outbox.parked", { reason: "max-attempts" });
      const sent0 = diag.getCounter("outbox.sent");

      // Swap the transport leaf (restored in finally).
      let flakyCountdown = 3; // flaky: fail transiently, then succeed.
      messageService.sendMessageIdempotent = async (payload) => {
        injectedCalls += 1;
        if (profile === "permanent") permanentError();
        if (profile === "transient") transientError();
        // flaky
        if (flakyCountdown-- > 0) transientError();
        return fakeRow(payload);
      };

      // Drive the real worker. resume() rebuilds the schedule and attempts due
      // heads; both no-op cleanly when the outbox flag is off / no DB.
      await outboxService.resume();
      outboxService.poke();
      report.drove = true;

      await sleep(settleMs);

      report.injectedCalls = injectedCalls;
      report.attempts = diag.getCounter("outbox.attempt") - attempts0;
      report.retriesScheduled = diag.getCounter("outbox.retry_scheduled") - retries0;
      report.parked =
        diag.getCounter("outbox.parked", { reason: "permanent" }) -
        parkedPerm0 +
        (diag.getCounter("outbox.parked", { reason: "max-attempts" }) - parkedMax0);
      report.sent = diag.getCounter("outbox.sent") - sent0;

      // Chaos must never corrupt state: the auditor should still pass.
      report.audit = await consistencyAuditor.audit();
      report.auditOk = report.audit.ok;

      return report;
    } catch (err) {
      console.error("[chaosHarness] run", err);
      return report;
    } finally {
      // Restore the real transport unconditionally, then the flag.
      messageService.sendMessageIdempotent = original;
      diag.setEnabled(wasEnabled);
    }
  },
};
