import { resumeFixtureA } from "./resume-fixture-a.js";

export function formatResumeReport(): string {
  return `${resumeFixtureA()} + resume-b`;
}
