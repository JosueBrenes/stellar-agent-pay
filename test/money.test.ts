import assert from "node:assert/strict";
import { test } from "node:test";
import { rescale, toAtomic, toDecimal, toPolicyUnits } from "../src/core/money.js";

test("toAtomic converts decimals at Stellar's 7-decimal precision", () => {
  assert.equal(toAtomic("0.001"), 10_000n);
  assert.equal(toAtomic("0.05"), 500_000n);
  assert.equal(toAtomic("1"), 10_000_000n);
  assert.equal(toAtomic("$0.50"), 5_000_000n);
});

test("toAtomic rejects malformed and over-precise amounts", () => {
  assert.throws(() => toAtomic("abc"), /invalid amount/);
  assert.throws(() => toAtomic("-1"), /invalid amount/);
  assert.throws(() => toAtomic("0.12345678"), /more than 7 decimal places/);
});

test("toDecimal round-trips and keeps at least two decimals", () => {
  assert.equal(toDecimal(10_000n), "0.001");
  assert.equal(toDecimal(500_000n), "0.05");
  assert.equal(toDecimal(0n), "0.00");
  assert.equal(toDecimal(toAtomic("2.5")), "2.50");
});

test("rescale rounds up when narrowing precision so limits stay conservative", () => {
  assert.equal(rescale(1_000_000n, 6, 7), 10_000_000n);
  assert.equal(rescale(10_000_001n, 7, 6), 1_000_001n);
  assert.equal(rescale(10_000_000n, 7, 6), 1_000_000n);
});

test("toPolicyUnits normalizes a 6-decimal asset to policy units", () => {
  // 1.5 units of a 6-decimal token becomes 1.5 policy units.
  assert.equal(toPolicyUnits(1_500_000n, 6), 15_000_000n);
});
