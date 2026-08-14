import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical-json.js";

describe("canonicalJson", () => {
  it("serializes basic primitive values correctly with newline", () => {
    expect(canonicalJson("hello")).toBe(`"hello"\n`);
    expect(canonicalJson(42)).toBe("42\n");
    expect(canonicalJson(true)).toBe("true\n");
    expect(canonicalJson(null)).toBe("null\n");
  });

  it("sorts simple object keys alphabetically and uses 2-space indentation", () => {
    const input = { z: 1, a: 2, m: 3 };
    const expected = [
      "{",
      '  "a": 2,',
      '  "m": 3,',
      '  "z": 1',
      "}",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("recursively sorts keys of nested objects", () => {
    const input = {
      b: { y: 2, x: 1 },
      a: 10
    };
    const expected = [
      "{",
      '  "a": 10,',
      '  "b": {',
      '    "x": 1,',
      '    "y": 2',
      "  }",
      "}",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("maintains original order of array elements", () => {
    const input = [3, 1, 2];
    const expected = [
      "[",
      "  3,",
      "  1,",
      "  2",
      "]",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("recursively sorts objects within arrays while keeping array order", () => {
    const input = [
      { y: 2, x: 1 },
      { b: 4, a: 3 }
    ];
    const expected = [
      "[",
      "  {",
      '    "x": 1,',
      '    "y": 2',
      "  },",
      "  {",
      '    "a": 3,',
      '    "b": 4',
      "  }",
      "]",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("filters out undefined values from objects", () => {
    const input = {
      keep: "me",
      remove: undefined,
      nested: {
        keepToo: true,
        removeToo: undefined
      }
    };
    const expected = [
      "{",
      '  "keep": "me",',
      '  "nested": {',
      '    "keepToo": true',
      "  }",
      "}",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });

  it("handles complex, nested compositions", () => {
    const input = {
      list: [
        { z: "foo", a: { y: 100, x: [1, { b: 2, a: 1 }] } }
      ],
      emptyObj: {},
      emptyArr: []
    };
    const expected = [
      "{",
      '  "emptyArr": [],',
      '  "emptyObj": {},',
      '  "list": [',
      "    {",
      '      "a": {',
      '        "x": [',
      "          1,",
      "          {",
      '            "a": 1,',
      '            "b": 2',
      "          }",
      "        ],",
      '        "y": 100',
      "      },",
      '      "z": "foo"',
      "    }",
      "  ]",
      "}",
      ""
    ].join("\n");
    expect(canonicalJson(input)).toBe(expected);
  });
});
