import { leftFanInFixture } from "./fan-in-left.js";
import { rightFanInFixture } from "./fan-in-right.js";

export function formatFanInReport(): string {
  return `${leftFanInFixture()} + ${rightFanInFixture()}`;
}
