/** Format a USD amount for human-readable chain output. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
