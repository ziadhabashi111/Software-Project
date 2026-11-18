const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export const DURATION_PATTERN = /^\d+[smhd]$/;

/** Converts "30s", "15m", "1h" or "7d" to milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${value}" (use 30s, 15m, 1h or 7d)`);
  }
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
