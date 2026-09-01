// §5.8 Monetary representation: DB NUMERIC ↔ integer paise at the boundary,
// all arithmetic in integer paise, formatted only at the render edge.

const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** Convert a NUMERIC string (as returned by pg) to integer paise — the ONLY entry point. */
export function rupeesToPaise(rupees: string | number): number {
  return Math.round(parseFloat(String(rupees)) * 100);
}

/** Convert paise back to a fixed-2-decimal string for NUMERIC(12,2) storage. */
export function paiseToDbString(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Format paise as ₹ with en-IN grouping — render edge only. */
export function formatINR(paise: number): string {
  return inrFormatter.format(paise / 100);
}

const inrWholeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Format paise as ₹ with en-IN grouping, no decimals — sticky CTA label only. */
export function formatINRWhole(paise: number): string {
  return inrWholeFormatter.format(paise / 100);
}
