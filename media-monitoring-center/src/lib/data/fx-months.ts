/** Calendar months around the report date, plus previously captured months. */
export function fxMonths(date: string, ...rates: Record<string, number>[]): string[] {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const months = Array.from({ length: 7 }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 1 + i - 5, 1));
    return at.toISOString().slice(0, 7);
  });
  return [...new Set([...months, ...rates.flatMap(r => Object.keys(r))])].filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
}
