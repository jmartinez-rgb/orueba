/** Process-local cost guard, not a distributed rate limit or a replacement for access checks. */
export class NexusRateLimit {
  private readonly windows = new Map<string, { at: number; count: number }>();
  constructor(private readonly maximum = 12, private readonly windowMs = 60_000, private readonly capacity = 2_000) {}

  take(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    for (const [id, window] of this.windows) if (now - window.at >= this.windowMs) this.windows.delete(id);
    let window = this.windows.get(key);
    if (!window) {
      // Do not evict active users: on saturation a new caller waits, preserving existing limits.
      if (this.windows.size >= this.capacity) return { allowed: false, retryAfter: Math.ceil(this.windowMs / 1_000) };
      window = { at: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.maximum) return { allowed: false, retryAfter: Math.max(1, Math.ceil((this.windowMs - (now - window.at)) / 1_000)) };
    window.count++;
    return { allowed: true, retryAfter: 0 };
  }
}
