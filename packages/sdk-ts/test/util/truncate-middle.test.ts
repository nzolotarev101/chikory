import { describe, expect, it } from "vitest";

import { truncateMiddle } from "../../src/util/truncate-middle.js";

describe("truncateMiddle", () => {
  it("returns strings at or below the inclusive boundary unchanged", () => {
    expect(truncateMiddle("abcdefgh", 8)).toBe("abcdefgh");
    expect(truncateMiddle("hi", 2)).toBe("hi");
    expect(truncateMiddle("", 3)).toBe("");
  });

  it("counts the ellipsis and favours the head on odd splits", () => {
    expect(truncateMiddle("abcdefghij", 8)).toBe("abcd…hij");
    expect(truncateMiddle("abcdefghij", 7)).toBe("abc…hij");
    expect(truncateMiddle("hello", 4)).toBe("he…o");
    expect(truncateMiddle("hello", 3)).toBe("h…o");
  });

  it("returns only the ellipsis when maxLength is one", () => {
    expect(truncateMiddle("hello", 1)).toBe("…");
  });

  it("throws a RangeError when maxLength is less than one", () => {
    expect(() => truncateMiddle("hi", 0)).toThrow(RangeError);
    expect(() => truncateMiddle("hi", -2)).toThrow(RangeError);
  });

  it("returns exactly maxLength characters when truncating", () => {
    expect(truncateMiddle("abcdefghij", 8)).toHaveLength(8);
  });
});
