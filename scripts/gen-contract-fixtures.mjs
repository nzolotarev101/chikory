// Authoring tool for fixtures/contracts/*.json (CONTRACTS.md §10).
// Emits canonical JSON (recursively sorted keys, 2-space indent, trailing
// newline) — the same form `canonicalJson()` in sdk-ts produces, so the
// round-trip tests can require byte-identical output.
// Run via: devbox run -- node scripts/gen-contract-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "contracts");

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

const canonical = (value) => `${JSON.stringify(sortValue(value), null, 2)}\n`;

// ── shared building blocks ──────────────────────────────────────────────────

const tokens = { input: 1200, output: 350 };

const diffRef = {
  id: "sha256:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  kind: "diff",
  bytes: 4096,
  summary: "3 files changed: artifact store put/get/excerpt + tests",
};

const transcriptRef = {
  id: "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
  kind: "transcript",
  bytes: 181233,
  summary: "claude-code session transcript, 12 tool calls",
};

const testOutputRef = {
  id: "sha256:fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
  kind: "test_results",
  bytes: 9211,
  summary: "vitest run: 14 passed, 0 failed",
};

const contextSnapshotRef = {
  id: "sha256:7d793037a0760186574b0282f2f435e7e80fbd6c0a224ed95e3dcd3d3d3d3d3d",
  kind: "context_snapshot",
  bytes: 23001,
  summary: "compacted context after step 4",
};

const criterion = {
  id: "AC-1",
  description: "ArtifactStore interface implemented with content-addressed FS backend",
  check: "devbox run -- pnpm --filter @chikory/sdk test artifacts",
};

const modelChoice = { provider: "anthropic", model: "claude-fable-5" };

const routingPolicy = {
  stages: {
    plan: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    code: { provider: "anthropic", model: "claude-fable-5" },
    review: { provider: "anthropic", model: "claude-fable-5" },
    judge: { provider: "gemini", model: "gemini-2.5-pro" },
  },
  failover: {
    judge: [{ provider: "openai", model: "gpt-5.2" }],
  },
};

const judgePolicy = {
  family: "gemini",
  model: "gemini-2.5-pro",
  cadence: 3,
  scoringMethod: "pointwise",
  maxCostShare: 0.25,
};

const taskSpec = {
  name: "memory-pointer-store",
  goal: "Implement the ArtifactStore (Memory Pointer pattern): content-addressed local FS backend, put/get/excerpt, applied to tool outputs over 8KB.",
  repos: [{ url: ".", ref: "main", writable: true }],
  acceptanceCriteria: [
    criterion,
    {
      id: "AC-2",
      description: "excerpt() returns targeted slices by range and query",
    },
  ],
  budgetUsd: 20,
  maxSteps: 60,
  executor: { adapter: "claude-code", family: "anthropic" },
  judge: judgePolicy,
  routing: routingPolicy,
};

const contextBundle = {
  goal: taskSpec.goal,
  acceptanceCriteria: [criterion],
  planItem: "Implement put() with sha256 content addressing",
  notes: { decisions: "local FS backend under .chikory/artifacts, sharded by hash prefix" },
  recentSteps: ["step 1: scaffolded ArtifactStore module and test file"],
  injections: [],
  memoryRefs: [],
};

const stepLimits = { maxSeconds: 900, maxTurns: 30, maxCostUsd: 2.5 };

const stepRecord = {
  status: "SUCCESS",
  diffRef,
  summary: "Implemented put() with sha256 addressing; added round-trip test",
  toolCalls: 12,
  tokens,
  costUsd: 0.42,
  costEstimated: true,
  durationMs: 35000,
  transcriptRef,
};

const testResultArtifact = {
  ref: testOutputRef,
  command: "devbox run test",
  exitCode: 0,
  passed: 14,
  failed: 0,
  durationMs: 8200,
};

const judgeForm = {
  criterionResults: [
    { id: "AC-1", pass: true, justification: "Store implemented; judge-run tests pass." },
  ],
  rubricResults: [
    { id: "RB-no-unrelated-deletions", pass: true, justification: "Diff touches only artifact store files." },
  ],
  concerns: [],
};

const judgeVerdict = {
  kind: "PROCEED",
  form: judgeForm,
  rationale: "All criteria pass on judge-executed tests; no rubric violations.",
  costUsd: 0.05,
  tokens: { input: 5400, output: 220 },
  judgeModel: { provider: "gemini", model: "gemini-2.5-pro" },
};

const checkpoint = {
  id: "run-7f3a@4",
  journalIdx: 4,
  gitCommits: { ".": "9b1dca6c41f8160dbb6d2e6db52f1571f48ed3a1" },
  contextSnapshotRef,
  budgetSpentUsd: 1.23,
  lastGood: true,
};

// ── plans & chains (WP-219, ADR-005) ────────────────────────────────────────

const planNode = {
  id: "N-1",
  goal: "Add the ArtifactStore interface and a local FS backend with put/get.",
  acceptanceCriteria: [criterion],
  dependsOn: [],
  budgetUsd: 5,
};

const plan = {
  id: "plan-7f3a",
  goal: "Implement the Memory Pointer store end to end.",
  nodes: [
    planNode,
    {
      id: "N-2",
      goal: "Wire excerpt() and apply it to tool outputs over 8KB.",
      acceptanceCriteria: [criterion],
      dependsOn: ["N-1"],
      budgetUsd: 5,
    },
  ],
  createdAt: "2026-06-10T12:00:00.000Z",
};

const planVerdict = {
  kind: "PROCEED",
  rationale: "Both criteria are covered; node boundaries are independently checkable.",
  uncoveredCriteria: [],
};

const chainLink = { planId: "plan-7f3a", nodeId: "N-2", parentRunId: "run-7f3a-n1" };

const chainRecord = {
  planId: "plan-7f3a",
  plan,
  planVerdict,
  nodeRuns: { "N-1": "run-7f3a-n1" },
  status: "RUNNING",
};

// ── fixtures ────────────────────────────────────────────────────────────────

const valid = {
  TokenUsage: tokens,
  ModelChoice: modelChoice,
  RoutingPolicy: routingPolicy,
  Message: { role: "user", content: "Implement the artifact store per the component doc." },
  CompletionRequest: {
    stage: "judge",
    messages: [
      { role: "system", content: "You are the judge. Fill the form." },
      { role: "user", content: "Evidence follows." },
    ],
    maxTokens: 2048,
    temperature: 0,
    responseSchema: { type: "object" },
  },
  LLMCallResult: {
    status: "SUCCESS",
    content: '{"criterionResults":[]}',
    provider: "gemini",
    model: "gemini-2.5-pro",
    tokens,
    costUsd: 0.0123,
  },
  RouterError: {
    status: "FAILED",
    reason: "429 rate limited after exhausting retries",
    retriable: true,
    attempts: 4,
    provider: "openai",
  },
  TaskSpec: taskSpec,
  RepoSpec: { url: ".", ref: "main", writable: true },
  AcceptanceCriterion: criterion,
  JudgePolicy: judgePolicy,
  PacingPolicy: { mode: "fixed" },
  NotificationPolicy: { on: ["escalate", "terminal"], slackWebhookEnv: "CHIKORY_SLACK_URL" },
  StepLimits: stepLimits,
  ContextBundle: contextBundle,
  StepInput: {
    workspaceDir: "/tmp/chikory-ws/run-7f3a",
    instruction: "Implement put() with sha256 content addressing and a round-trip test.",
    context: contextBundle,
    limits: stepLimits,
  },
  StepRecord: stepRecord,
  ArtifactRef: diffRef,
  TestResultArtifact: testResultArtifact,
  JudgeEvidence: {
    diffRefs: [diffRef],
    testResults: testResultArtifact,
    criteria: [criterion],
    criteriaHistory: { "AC-1": [false, true] },
    stepSummaries: [stepRecord.summary],
    artifacts: [],
  },
  JudgeForm: judgeForm,
  JudgeVerdict: judgeVerdict,
  JournalEntry: {
    idx: 3,
    ts: "2026-06-10T12:00:00.000Z",
    kind: "step",
    payload: { stepIndex: 3, adapter: "claude-code" },
    costDeltaUsd: 0.42,
    tokens,
    artifactRefs: [diffRef, transcriptRef],
  },
  Checkpoint: checkpoint,
  RunStatusReport: {
    status: "RUNNING",
    currentStep: 5,
    spentUsd: 1.65,
    budgetUsd: 20,
    lastVerdict: { kind: "PROCEED", atStep: 3 },
    checkpoints: [checkpoint],
  },
  PlanNode: planNode,
  Plan: plan,
  PlanVerdict: planVerdict,
  ChainLink: chainLink,
  ChainRecord: chainRecord,
};

const invalid = {
  "TaskSpec.invalid-empty-criteria": { ...taskSpec, acceptanceCriteria: [] },
  "TaskSpec.invalid-zero-budget": { ...taskSpec, budgetUsd: 0 },
  "TaskSpec.invalid-no-repos": { ...taskSpec, repos: [] },
  "TaskSpec.invalid-unknown-key": { ...taskSpec, ownerEmail: "a@b.c" },
  "PlanVerdict.invalid-unknown-kind": { ...planVerdict, kind: "HALT" },
  "PlanNode.invalid-zero-budget": { ...planNode, budgetUsd: 0 },
  "RoutingPolicy.invalid-missing-stage": {
    stages: {
      plan: routingPolicy.stages.plan,
      code: routingPolicy.stages.code,
      review: routingPolicy.stages.review,
    },
  },
  "JudgePolicy.invalid-zero-cadence": { ...judgePolicy, cadence: 0 },
  "RouterError.invalid-wrong-status": {
    status: "SUCCESS",
    reason: "not actually a failure",
    retriable: false,
    attempts: 1,
  },
  "LLMCallResult.invalid-missing-tokens": {
    status: "SUCCESS",
    content: "hi",
    provider: "anthropic",
    model: "claude-fable-5",
    costUsd: 0.01,
  },
  "ArtifactRef.invalid-long-summary": { ...diffRef, summary: "x".repeat(201) },
  "StepRecord.invalid-bad-status": { ...stepRecord, status: "DONE" },
  "JudgeVerdict.invalid-rollback-without-target": { ...judgeVerdict, kind: "ROLLBACK" },
  "JudgeVerdict.invalid-unknown-kind": { ...judgeVerdict, kind: "APPROVE" },
  "JournalEntry.invalid-bad-kind": {
    idx: 0,
    ts: "2026-06-10T12:00:00.000Z",
    kind: "note",
    payload: {},
    costDeltaUsd: 0,
    artifactRefs: [],
  },
  "Checkpoint.invalid-missing-snapshot": (() => {
    const { contextSnapshotRef: _omitted, ...rest } = checkpoint;
    return rest;
  })(),
};

mkdirSync(outDir, { recursive: true });
for (const [name, value] of Object.entries(valid)) {
  writeFileSync(join(outDir, `${name}.valid.json`), canonical(value));
}
for (const [name, value] of Object.entries(invalid)) {
  writeFileSync(join(outDir, `${name}.json`), canonical(value));
}
console.log(
  `wrote ${Object.keys(valid).length} valid + ${Object.keys(invalid).length} invalid fixtures to ${outDir}`,
);
