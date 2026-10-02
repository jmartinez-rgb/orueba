/** Only amounts/months from validated settings; no recipient or credential data. */
export function fxRateChanges(before: Record<string, number>, after: Record<string, number>): string {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(month => before[month] !== after[month])
    .map(month => `${month}: ${before[month] ?? "sin tasa"} → ${after[month] ?? "sin tasa"} MXN por USD`)
    .join("; ");
}
