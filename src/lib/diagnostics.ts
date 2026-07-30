import {
  FEATURE_RELIABILITY_DIAGNOSTICS,
  DIAG_RING_CAPACITY,
  DIAG_MAX_SERIES,
} from "@/src/lib/constants";

/**
 * Passive diagnostics registry (Phase 6B — design §1–§3).
 *
 * An out-of-band observability layer for the Phase 3–5A pipeline. It is a pure,
 * dependency-free registry: it imports NO store/service/db module, so it can be
 * called from any seam without a cycle, and it owns no domain logic.
 *
 * Three contracts make it safe to sprinkle across hot paths:
 *  - Passive: every write only mutates this registry; it never returns a value
 *    a caller branches on, never awaits, never reorders work.
 *  - Exception-isolated: every public method swallows its own errors — a
 *    telemetry bug can never propagate into sync/outbox/render.
 *  - Zero-cost when disabled: each method's first statement is the flag check,
 *    so with FEATURE_RELIABILITY_DIAGNOSTICS off a tap is one boolean read.
 *
 * Bounded by construction: counters/gauges are scalars, histograms have fixed
 * buckets, the event ring has fixed capacity, and total series are capped
 * (DIAG_MAX_SERIES) — the observer can never become the leak (§10).
 */

// ---------------------------------------------------------------------------
// Enable state — defaults to the compile-time flag; harnesses/tests may flip
// it at runtime. In production nothing flips it, so cost stays zero (§11).
// ---------------------------------------------------------------------------
let enabled = FEATURE_RELIABILITY_DIAGNOSTICS;

export type MetricLabels = Readonly<Record<string, string>>;

// Fixed duration/size buckets (ms or item counts). Upper bound is +Inf.
const DEFAULT_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096];

interface Histogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  // Cumulative-less per-bucket counts, aligned to DEFAULT_BUCKETS + overflow.
  buckets: number[];
}

export interface HistogramSnapshot {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

export interface DiagEvent {
  t: number;
  name: string;
  data?: Readonly<Record<string, string | number | boolean>>;
}

export interface DiagSnapshot {
  enabled: boolean;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: HistogramSnapshot[];
  events: DiagEvent[];
  series: number;
}

// name + serialized labels → one series key. Sorted keys keep it stable.
function seriesKey(name: string, labels?: MetricLabels): string {
  if (!labels) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`);
  return parts.length ? `${name}|${parts.join(",")}` : name;
}

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, Histogram>();
const ring: DiagEvent[] = [];
let ringHead = 0; // next write slot (circular)

// Cardinality guard: once every category is at the cap, refuse NEW series but
// keep updating existing ones. Bounds memory regardless of tap correctness.
function atCapacity(map: Map<string, unknown>, key: string): boolean {
  return !map.has(key) && map.size >= DIAG_MAX_SERIES;
}

function newHistogram(): Histogram {
  return {
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    buckets: new Array(DEFAULT_BUCKETS.length + 1).fill(0),
  };
}

function bucketIndex(value: number): number {
  for (let i = 0; i < DEFAULT_BUCKETS.length; i++) {
    if (value <= DEFAULT_BUCKETS[i]) return i;
  }
  return DEFAULT_BUCKETS.length; // overflow bucket
}

// Approximate a quantile from bucket counts (upper bucket bound; conservative).
function quantile(h: Histogram, q: number): number {
  if (h.count === 0) return 0;
  const target = q * h.count;
  let cumulative = 0;
  for (let i = 0; i < h.buckets.length; i++) {
    cumulative += h.buckets[i];
    if (cumulative >= target) {
      return i < DEFAULT_BUCKETS.length ? DEFAULT_BUCKETS[i] : h.max;
    }
  }
  return h.max;
}

export const diag = {
  /** True when taps are live. Callers never need this; it's for harnesses. */
  enabled(): boolean {
    return enabled;
  },

  /** Runtime enable (dev harnesses / tests only). Production leaves it at the flag. */
  setEnabled(next: boolean): void {
    enabled = next;
  },

  /** Increment a monotonic counter series. No-op when disabled; never throws. */
  count(name: string, n: number = 1, labels?: MetricLabels): void {
    if (!enabled) return;
    try {
      const key = seriesKey(name, labels);
      if (atCapacity(counters, key)) return;
      counters.set(key, (counters.get(key) ?? 0) + n);
    } catch {
      /* telemetry must never break the host path */
    }
  },

  /** Set a point-in-time gauge series. No-op when disabled; never throws. */
  gauge(name: string, value: number, labels?: MetricLabels): void {
    if (!enabled) return;
    try {
      const key = seriesKey(name, labels);
      if (atCapacity(gauges, key)) return;
      gauges.set(key, value);
    } catch {
      /* swallow */
    }
  },

  /** Record a sample into a fixed-bucket histogram. No-op when disabled. */
  observe(name: string, value: number, labels?: MetricLabels): void {
    if (!enabled) return;
    try {
      const key = seriesKey(name, labels);
      if (atCapacity(histograms, key)) return;
      let h = histograms.get(key);
      if (!h) {
        h = newHistogram();
        histograms.set(key, h);
      }
      h.count += 1;
      h.sum += value;
      if (value < h.min) h.min = value;
      if (value > h.max) h.max = value;
      h.buckets[bucketIndex(value)] += 1;
    } catch {
      /* swallow */
    }
  },

  /** Append a structured event to the bounded ring (oldest overwritten). */
  event(
    name: string,
    data?: Readonly<Record<string, string | number | boolean>>
  ): void {
    if (!enabled) return;
    try {
      const entry: DiagEvent = { t: Date.now(), name, data };
      if (ring.length < DIAG_RING_CAPACITY) {
        ring.push(entry);
      } else {
        ring[ringHead] = entry;
      }
      ringHead = (ringHead + 1) % DIAG_RING_CAPACITY;
    } catch {
      /* swallow */
    }
  },

  /**
   * Immutable point-in-time view for the auditor, harnesses and tests. Cheap
   * enough to call on demand; returns oldest-first events. Never throws.
   */
  snapshot(): DiagSnapshot {
    try {
      const countersOut: Record<string, number> = {};
      for (const [k, v] of counters) countersOut[k] = v;

      const gaugesOut: Record<string, number> = {};
      for (const [k, v] of gauges) gaugesOut[k] = v;

      const histogramsOut: HistogramSnapshot[] = [];
      for (const [name, h] of histograms) {
        histogramsOut.push({
          name,
          count: h.count,
          sum: h.sum,
          min: h.count ? h.min : 0,
          max: h.count ? h.max : 0,
          mean: h.count ? h.sum / h.count : 0,
          p50: quantile(h, 0.5),
          p95: quantile(h, 0.95),
        });
      }

      // Reconstruct chronological order from the circular buffer.
      const events =
        ring.length < DIAG_RING_CAPACITY
          ? [...ring]
          : [...ring.slice(ringHead), ...ring.slice(0, ringHead)];

      return {
        enabled,
        counters: countersOut,
        gauges: gaugesOut,
        histograms: histogramsOut,
        events,
        series: counters.size + gauges.size + histograms.size,
      };
    } catch {
      return {
        enabled,
        counters: {},
        gauges: {},
        histograms: [],
        events: [],
        series: 0,
      };
    }
  },

  /** Read one counter series (defaults to 0). For test assertions. */
  getCounter(name: string, labels?: MetricLabels): number {
    return counters.get(seriesKey(name, labels)) ?? 0;
  },

  /** Read one gauge series (undefined when unset). For test assertions. */
  getGauge(name: string, labels?: MetricLabels): number | undefined {
    return gauges.get(seriesKey(name, labels));
  },

  /** Clear every series + the ring (test isolation / logout). Never throws. */
  reset(): void {
    try {
      counters.clear();
      gauges.clear();
      histograms.clear();
      ring.length = 0;
      ringHead = 0;
    } catch {
      /* swallow */
    }
  },
};
