import type { Account, DailyRow, HourlyRow } from "@/lib/types";
import { emptyMetrics } from "@/lib/metrics";

/** An absent mapped account is unknown, even when another account reported a real zero. */
export function coverAccounts<T extends DailyRow | HourlyRow>(rows: T[], accounts: Pick<Account, "id" | "platform">[]): T[] {
  const buckets = new Map<string, { sample: T; present: Set<string> }>();
  for (const row of rows) {
    const key = `${row.date}/${"hour" in row ? row.hour : "daily"}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { sample: row, present: new Set() }; buckets.set(key, bucket); }
    if (row.accountId) bucket.present.add(`${row.platform}/${row.accountId}`);
  }
  const complete = [...rows];
  for (const { sample, present } of buckets.values()) {
    for (const account of accounts) {
      if (!present.has(`${account.platform}/${account.id}`)) {
        complete.push({ ...sample, platform: account.platform, accountId: account.id, campaignId: null, metrics: emptyMetrics() });
      }
    }
  }
  return complete;
}
