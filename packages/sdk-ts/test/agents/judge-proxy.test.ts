import { describe, expect, it } from "vitest";

import {
  dispatchFor,
  mapAgyModel,
  retryAfterSeconds,
  splitCodexModel,
} from "../../../../scripts/cli-judge-proxy.mjs";
import { DEFAULT_AGENT_CLASSES, classMembers, inferBackendFromModel } from "../../src/agents/classes.js";
import { AGY_QUOTA_WALL } from "./fixtures/cli-failures.js";

/** Verbatim `agy models` output, 2026-08-02. */
const AGY_MODELS = [
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
];

describe("mapAgyModel (WP-570)", () => {
  it("passes through every id agy actually offers", () => {
    for (const model of AGY_MODELS) {
      expect(mapAgyModel(model), model).toBe(model);
    }
  });

  it("resolves to a REAL agy id, never a display string", () => {
    // The previous table returned "Gemini 3.5 Flash (High)" / "Claude Opus 4.6
    // (Thinking)", which `agy --model` cannot select.
    for (const requested of [
      "gemini-3.6-flash",
      "gemini-3.1-flash",
      "gemini-1.5-pro",
      "gemini-3.1-pro",
      "sonnet",
      "opus",
    ]) {
      expect(AGY_MODELS, `${requested} -> ${mapAgyModel(requested)}`).toContain(
        mapAgyModel(requested),
      );
    }
  });

  it("keeps a requested effort tier when agy offers it", () => {
    expect(mapAgyModel("gemini-3.6-flash-low")).toBe("gemini-3.6-flash-low");
    // 3.1-pro has no `medium` tier — fall back rather than emit an invalid id.
    expect(AGY_MODELS).toContain(mapAgyModel("gemini-3.1-pro-medium"));
  });

  it("leaves `default` alone so the CLI picks its own", () => {
    expect(mapAgyModel("default")).toBe("default");
  });
});

describe("dispatchFor (WP-570)", () => {
  it("routes Claude 5 to the claude CLI, because agy does not carry it", () => {
    // agy tops out at claude-sonnet-4-6 / claude-opus-4-6-thinking.
    expect(dispatchFor("claude-opus-5", "codex")).toBe("claude");
    expect(dispatchFor("claude-sonnet-5", "codex")).toBe("claude");
    expect(AGY_MODELS).not.toContain("claude-opus-5");
  });

  it("routes 4.6-era Claude and Gemini to agy, and GPT to codex", () => {
    expect(dispatchFor("claude-opus-4-6-thinking", "codex")).toBe("agy");
    expect(dispatchFor("gemini-3.6-flash-high", "codex")).toBe("agy");
    expect(dispatchFor("gpt-5.6-sol xhigh", "agy")).toBe("codex");
  });

  it("falls back to the configured backend for an unrecognised model", () => {
    expect(dispatchFor("default", "codex")).toBe("codex");
  });

  it("AGREES with the SDK's inferBackendFromModel for every declared member", () => {
    // These two must never drift: the SDK enforces invariant #2 using
    // `inferBackendFromModel`, while the proxy decides which vendor's CLI
    // actually serves the request. If they disagree, a pair that passes the
    // diversity check runs on one vendor anyway.
    const vendorOfCli: Record<string, string> = {
      codex: "openai",
      agy: "gemini",
      claude: "anthropic",
    };
    for (const agentClass of Object.values(DEFAULT_AGENT_CLASSES.classes)) {
      for (const member of classMembers(agentClass)) {
        const cli = dispatchFor(member.model, "codex");
        const sdk = inferBackendFromModel(member.model);
        // `agy` serves both Gemini and 4.6-era Claude, so it is the one CLI
        // whose identity does not pin the vendor; check the rest exactly.
        if (cli !== "agy") {
          expect(vendorOfCli[cli], `${member.id} (${member.model})`).toBe(sdk);
        }
        expect(sdk, `${member.id} declares backend ${member.backend}`).toBe(member.backend);
      }
    }
  });
});

describe("splitCodexModel (WP-570/WP-575)", () => {
  it("splits the effort suffix codex cannot take inline", () => {
    // Measured: `codex -m "gpt-5.6-sol xhigh"` returns HTTP 400 —
    // "The 'gpt-5.6-sol xhigh' model is not supported when using Codex with a
    // ChatGPT account." The suffix is Chikory's spelling, not codex's.
    expect(splitCodexModel("gpt-5.6-sol xhigh")).toEqual({
      model: "gpt-5.6-sol",
      effort: "xhigh",
    });
    expect(splitCodexModel("gpt-5.2 low")).toEqual({ model: "gpt-5.2", effort: "low" });
  });

  it("leaves a bare model id untouched", () => {
    expect(splitCodexModel("gpt-5.6-terra")).toEqual({ model: "gpt-5.6-terra", effort: undefined });
    expect(splitCodexModel("default")).toEqual({ model: "default", effort: undefined });
  });

  it("does not treat a trailing word that is not an effort tier as one", () => {
    expect(splitCodexModel("gpt-5.6 turbo")).toEqual({ model: "gpt-5.6 turbo", effort: undefined });
  });
});

describe("retryAfterSeconds (WP-570)", () => {
  it("parses the REAL agy wall harvested from a run journal", () => {
    expect(AGY_QUOTA_WALL.provenance).toBe("harvested");
    // "Resets in 4h6m22s" — the compact form F-234 fixed on the SDK side.
    expect(retryAfterSeconds(AGY_QUOTA_WALL.stderr)).toBe((4 * 60 + 6) * 60 + 22);
  });

  it("handles spaced and partial durations", () => {
    expect(retryAfterSeconds("Try again in 2h 30m.")).toBe(9000);
    expect(retryAfterSeconds("resets in 45m")).toBe(2700);
  });

  it("returns undefined when the wall names no reset", () => {
    expect(retryAfterSeconds("Individual quota reached.")).toBeUndefined();
  });
});
