import { truncateDecimals } from "./truncate-decimals.js";

export function truncateToCents(value: number): number {
  return truncateDecimals(value, 2);
}
