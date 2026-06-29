import { describe, expect, it } from "vitest";

import { scanDiffForNewDependencies } from "../../src/judge/scan-dependencies.js";

describe("scanDiffForNewDependencies (WP-215)", () => {
  it("reports an external default import", () => {
    const diff = ['+import express from "express";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["express"]);
  });

  it("ignores a relative import", () => {
    const diff = ['+import { x } from "./local";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual([]);
  });

  it("ignores a node builtin", () => {
    const diff = ['+import { readFile } from "node:fs";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual([]);
  });

  it("ignores an absolute import", () => {
    const diff = ['+import { config } from "/opt/app/config";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual([]);
  });

  it("normalizes a scoped package subpath to its first two segments", () => {
    const diff = ['+import { z } from "@scope/pkg/sub";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["@scope/pkg"]);
  });

  it("normalizes an unscoped subpath to its first segment", () => {
    const diff = ['+import merge from "lodash/merge";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["lodash"]);
  });

  it("reports a CommonJS require", () => {
    const diff = ['+const a = require("axios");'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["axios"]);
  });

  it("reports a side-effect import", () => {
    const diff = ['+import "zod";'].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["zod"]);
  });

  it("counts only added lines", () => {
    const diff = [
      "+++ b/node_modules/header-pkg/file.ts",
      '-import old from "removed-pkg";',
      '+import good from "good-pkg";',
    ].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["good-pkg"]);
  });

  it("returns sorted de-duplicated package names", () => {
    const diff = [
      '+import a from "zebra";',
      '+import b from "alpha";',
      '+import c from "alpha/x";',
    ].join("\n");

    expect(scanDiffForNewDependencies(diff)).toEqual(["alpha", "zebra"]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(scanDiffForNewDependencies("")).toEqual([]);
  });
});
