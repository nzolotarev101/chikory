import { describe, expect, test } from "vitest";
import {
  estimateNextStepCost,
  budgetBreached,
  estimateNextStepTokens,
  tokenBudgetBreached,
} from "../../src/runner/budget.js";

describe("estimateNextStepCost", () => {
  test("empty history estimates 0", () => {
    expect(estimateNextStepCost([])).toBe(0);
  });

  test("single input cost estimation is mean * 1.5", () => {
    expect(estimateNextStepCost([10])).toBeCloseTo(15, 6);
    expect(estimateNextStepCost([0.1])).toBeCloseTo(0.15, 6);
  });

  test("fewer than 5 inputs cost estimation uses all available inputs", () => {
    // Mean of [10, 20] is 15. 15 * 1.5 = 22.5
    expect(estimateNextStepCost([10, 20])).toBeCloseTo(22.5, 6);

    // Mean of [4, 8, 12] is 8. 8 * 1.5 = 12
    expect(estimateNextStepCost([4, 8, 12])).toBeCloseTo(12, 6);

    // Mean of [1, 2, 3, 4] is 2.5. 2.5 * 1.5 = 3.75
    expect(estimateNextStepCost([1, 2, 3, 4])).toBeCloseTo(3.75, 6);
  });

  test("exactly 5 inputs cost estimation uses all 5 inputs", () => {
    // Mean of [1, 2, 3, 4, 5] is 3. 3 * 1.5 = 4.5
    expect(estimateNextStepCost([1, 2, 3, 4, 5])).toBeCloseTo(4.5, 6);
  });

  test("more than 5 inputs cost estimation uses only the last 5 elements", () => {
    // For [1000, 1, 2, 3, 4, 5], only [1, 2, 3, 4, 5] should be used.
    // Mean of [1, 2, 3, 4, 5] is 3. 3 * 1.5 = 4.5
    expect(estimateNextStepCost([1000, 1, 2, 3, 4, 5])).toBeCloseTo(4.5, 6);

    // For [500, 400, 10, 20, 30, 40, 50], only [10, 20, 30, 40, 50] should be used.
    // Mean is 30. 30 * 1.5 = 45
    expect(estimateNextStepCost([500, 400, 10, 20, 30, 40, 50])).toBeCloseTo(45, 6);
  });

  test("inputs with floating point numbers are handled correctly", () => {
    expect(estimateNextStepCost([0.1, 0.2, 0.3])).toBeCloseTo(0.3, 6);
  });
});

describe("budgetBreached", () => {
  test("breached when remaining is exactly 0", () => {
    // spent === budget, remaining is 0, estimate is 0
    expect(budgetBreached(10, 10, 0)).toBe(true);
    // spent === budget, remaining is 0, estimate is positive
    expect(budgetBreached(10, 10, 5)).toBe(true);
  });

  test("breached when remaining is less than 0", () => {
    // spent > budget, remaining < 0, estimate is 0
    expect(budgetBreached(12, 10, 0)).toBe(true);
    // spent > budget, remaining < 0, estimate is positive
    expect(budgetBreached(12, 10, 5)).toBe(true);
  });

  test("breached when remaining is greater than 0 but less than estimate", () => {
    // spent = 8, budget = 10, remaining = 2, estimate = 3 -> remaining < estimate
    expect(budgetBreached(8, 10, 3)).toBe(true);
  });

  test("not breached when remaining is greater than or equal to estimate and greater than 0", () => {
    // spent = 5, budget = 10, remaining = 5, estimate = 3 -> remaining >= estimate
    expect(budgetBreached(5, 10, 3)).toBe(false);
    expect(budgetBreached(5, 10, 5)).toBe(false);
  });

  test("handles negative estimate safely if it occurs", () => {
    // spent = 5, budget = 10, remaining = 5, estimate = -2. remaining > 0, and remaining > estimate.
    expect(budgetBreached(5, 10, -2)).toBe(false);
  });
});

describe("estimateNextStepTokens", () => {
  test("empty history estimates 0 tokens", () => {
    expect(estimateNextStepTokens([])).toBe(0);
  });

  test("single input token estimation is mean * 1.5", () => {
    expect(estimateNextStepTokens([1000])).toBeCloseTo(1500, 6);
  });

  test("fewer than 5 inputs token estimation uses all available inputs", () => {
    // Mean of [1000, 2000] is 1500. 1500 * 1.5 = 2250
    expect(estimateNextStepTokens([1000, 2000])).toBeCloseTo(2250, 6);
  });

  test("exactly 5 inputs token estimation uses all 5 inputs", () => {
    // Mean of [100, 200, 300, 400, 500] is 300. 300 * 1.5 = 450
    expect(estimateNextStepTokens([100, 200, 300, 400, 500])).toBeCloseTo(450, 6);
  });

  test("more than 5 inputs token estimation uses only the last 5 elements", () => {
    // For [100000, 100, 200, 300, 400, 500], only [100, 200, 300, 400, 500] should be used.
    // Mean of [100, 200, 300, 400, 500] is 300. 300 * 1.5 = 450
    expect(estimateNextStepTokens([100000, 100, 200, 300, 400, 500])).toBeCloseTo(450, 6);
  });
});

describe("tokenBudgetBreached", () => {
  test("breached when remaining tokens is exactly 0", () => {
    expect(tokenBudgetBreached(1000, 1000, 0)).toBe(true);
    expect(tokenBudgetBreached(1000, 1000, 50)).toBe(true);
  });

  test("breached when remaining tokens is less than 0", () => {
    expect(tokenBudgetBreached(1100, 1000, 0)).toBe(true);
    expect(tokenBudgetBreached(1100, 1000, 50)).toBe(true);
  });

  test("breached when remaining tokens is greater than 0 but less than estimate", () => {
    // spent = 800, budget = 1000, remaining = 200, estimate = 300 -> remaining < estimate
    expect(tokenBudgetBreached(800, 1000, 300)).toBe(true);
  });

  test("not breached when remaining tokens is greater than or equal to estimate and greater than 0", () => {
    // spent = 500, budget = 1000, remaining = 500, estimate = 300 -> remaining >= estimate
    expect(tokenBudgetBreached(500, 1000, 300)).toBe(false);
    expect(tokenBudgetBreached(500, 1000, 500)).toBe(false);
  });
});
