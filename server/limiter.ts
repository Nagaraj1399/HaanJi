import { SARVAM_RPM_HARD_CAP } from "./config.ts";
import { flags } from "./flags.ts";
import { metrics } from "./metrics.ts";

export class SarvamQuotaError extends Error {
  status: number;
  constructor(message: string, status = 429) {
    super(message);
    this.name = "SarvamQuotaError";
    this.status = status;
  }
}

export class SarvamClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SarvamClientError";
    this.status = status;
  }
}

export class SlidingWindowLimiter {
  private windowTimestamps: number[] = [];
  private getBudgetFn: () => number;
  private hardCap: number;

  constructor(
    getBudgetFn: () => number = () => flags.rpmBudget(),
    hardCap: number = SARVAM_RPM_HARD_CAP
  ) {
    this.getBudgetFn = getBudgetFn;
    this.hardCap = hardCap;
  }

  tryAcquire(nowMs = Date.now()): boolean {
    const cutoff = nowMs - 60_000;
    this.windowTimestamps = this.windowTimestamps.filter((ts) => ts > cutoff);
    const limit = Math.min(this.getBudgetFn(), this.hardCap);
    if (this.windowTimestamps.length < limit) {
      this.windowTimestamps.push(nowMs);
      return true;
    }
    return false;
  }

  currentUsage(nowMs = Date.now()): number {
    const cutoff = nowMs - 60_000;
    this.windowTimestamps = this.windowTimestamps.filter((ts) => ts > cutoff);
    return this.windowTimestamps.length;
  }

  reset(): void {
    this.windowTimestamps = [];
  }

  async acquireSlot(
    _api: "stt" | "chat" | "tts" | "translate",
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      nowFn?: () => number;
      sleepFn?: (ms: number) => Promise<void>;
    }
  ): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? 20_000;
    const pollIntervalMs = opts?.pollIntervalMs ?? 250;
    const nowFn = opts?.nowFn ?? (() => Date.now());
    const sleepFn =
      opts?.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    const start = nowFn();
    while (true) {
      if (this.tryAcquire(nowFn())) {
        return;
      }
      if (nowFn() - start >= timeoutMs) {
        throw new SarvamQuotaError(
          `Timed out after ${timeoutMs}ms waiting for rate-limit slot (limit=${Math.min(this.getBudgetFn(), this.hardCap)} rpm)`
        );
      }
      await sleepFn(pollIntervalMs);
    }
  }
}

export const sharedLimiter = new SlidingWindowLimiter();

export async function callWithRetry<T>(
  api: "stt" | "chat" | "tts" | "translate",
  fn: () => Promise<T>,
  opts?: {
    sleepFn?: (ms: number) => Promise<void>;
    metricsObserver?: (api: "stt" | "chat" | "tts" | "translate", status: string, seconds: number) => void;
  }
): Promise<T> {
  const sleepFn =
    opts?.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const observe =
    opts?.metricsObserver ??
    ((a, s, sec) => metrics.observeSarvam(a, s, sec));

  const backoffs = [500, 1500]; // 0.5s then 1.5s, max 2 retries (3 total attempts)
  let attempt = 0;

  while (true) {
    const t0 = Date.now();
    try {
      const res = await fn();
      observe(api, "200", (Date.now() - t0) / 1000);
      return res;
    } catch (err: unknown) {
      const elapsedSec = (Date.now() - t0) / 1000;
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      observe(api, String(status), elapsedSec);

      // Never retry 402 (out of credit) or other 4xx except 429
      if (status === 402 || (status >= 400 && status < 500 && status !== 429)) {
        throw new SarvamClientError(
          err instanceof Error ? err.message : `Upstream error ${status}`,
          status
        );
      }

      const errMsg = err instanceof Error ? err.message : "";
      const isDailyQuota =
        status === 429 &&
        (errMsg.includes("PerDay") || errMsg.includes("per day limit"));

      // Retry transient 429 and 5xx at most 2 times (skip daily quota limits)
      if (!isDailyQuota && (status === 429 || status >= 500) && attempt < backoffs.length) {
        const base = backoffs[attempt];
        const jitter = Math.floor(Math.random() * 120);
        attempt += 1;
        await sleepFn(base + jitter);
        continue;
      }

      if (status === 429) {
        throw new SarvamQuotaError(
          err instanceof Error ? err.message : "Upstream 429 rate limit exceeded",
          429
        );
      }
      throw err;
    }
  }
}
