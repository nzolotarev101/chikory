import { roundTo } from "./round-to.js";

export function roundToCents(value: number): number {
  return roundTo(value, 2);
}
