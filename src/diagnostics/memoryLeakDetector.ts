import { diag } from "@/src/lib/diagnostics";
import { cacheService } from "@/src/services/cacheService";
import { useChatStore } from "@/src/stores/chatStore";

/**
 * Memory-leak detector (Phase 6B — design §10).
 *
 * A bounded, read-only sampler that periodically snapshots the size of the
 * process's own retained structures — resident room windows, total RAM message
 * rows, the durable outbox depth, and the diagnostics registry's series count —
 * and flags *monotonic growth* across a fixed history window as a leak signal.
 *
 * It touches no domain state: it reads the memory store via `getState()` and
 * the durable queue via the `cacheService` read facade, and writes only into
 * the passive diagnostics registry. Its own history is a fixed-length ring per
 * metric, so the detector can never itself become the leak (§10). Fully
 * exception-isolated; a sampler error is swallowed, never propagated into the
 * host, and never stops the interval.
 *
 * Lifecycle: dev/flag-gated. `start()` no-ops when the flag is off, so in
 * production nothing samples and cost stays zero (§11). `stop()` clears the
 * timer and is safe to call repeatedly.
 */

// Fixed-length per-metric history. Growth across the whole window (every sample
// >= the previous, and last strictly greater than first) is the leak signal.
const WINDOW = 8;

type MetricName =
  | "rooms_cached"
  | "ram_messages"
  | "outbox_depth"
  | "diag_series";

const history: Record<MetricName, number[]> = {
  rooms_cached: [],
  ram_messages: [],
  outbox_depth: [],
  diag_series: [],
};

let timer: ReturnType<typeof setInterval> | null = null;

// Push a sample into the bounded ring and return true when the full window is
// monotonic non-decreasing with net growth (leak-shaped).
function pushAndCheck(name: MetricName, value: number): boolean {
  const h = history[name];
  h.push(value);
  if (h.length > WINDOW) h.shift();
  if (h.length < WINDOW) return false;
  for (let i = 1; i < h.length; i++) {
    if (h[i] < h[i - 1]) return false;
  }
  return h[h.length - 1] > h[0];
}

function sampleOnce(ramMessages: number, roomsCached: number, outboxDepth: number): void {
  const diagSeries = diag.snapshot().series;

  const samples: Record<MetricName, number> = {
    rooms_cached: roomsCached,
    ram_messages: ramMessages,
    outbox_depth: outboxDepth,
    diag_series: diagSeries,
  };

  for (const key of Object.keys(samples) as MetricName[]) {
    const value = samples[key];
    diag.gauge(`memory.${key}`, value);
    if (pushAndCheck(key, value)) {
      diag.count("memory.leak_suspected", 1, { metric: key });
      diag.event("memory.leak_suspected", {
        metric: key,
        first: history[key][0],
        last: value,
      });
    }
  }
}

async function tick(): Promise<void> {
  try {
    const roomsById = useChatStore.getState().messages;
    let ramMessages = 0;
    let roomsCached = 0;
    for (const roomId of Object.keys(roomsById)) {
      roomsCached += 1;
      ramMessages += (roomsById[roomId] ?? []).length;
    }
    const outboxDepth = (await cacheService.listOutboxAll()).length;
    sampleOnce(ramMessages, roomsCached, outboxDepth);
  } catch (err) {
    console.error("[memoryLeakDetector] tick", err);
  }
}

export const memoryLeakDetector = {
  /**
   * Begin periodic sampling. No-op when diagnostics are disabled (production).
   * Idempotent: an already-running detector is left as-is.
   */
  start(intervalMs: number = 10000): void {
    if (!diag.enabled()) return;
    if (timer) return;
    try {
      timer = setInterval(() => void tick(), intervalMs);
      // Sample immediately so a short-lived harness gets at least one point.
      void tick();
    } catch (err) {
      console.error("[memoryLeakDetector] start", err);
    }
  },

  /** Stop sampling and clear the history rings. Safe to call repeatedly. */
  stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    for (const key of Object.keys(history) as MetricName[]) {
      history[key].length = 0;
    }
  },

  /** One-shot sample (for tests/harnesses that drive time manually). */
  sampleNow(): Promise<void> {
    if (!diag.enabled()) return Promise.resolve();
    return tick();
  },
};
