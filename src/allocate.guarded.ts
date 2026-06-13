// allocate.guarded.ts — drop-in for allocate.ts with the preconditions enforced.
// Same signatures as the verified core; on a violated `//@ requires` it throws
// PreconditionError(fn, clause, clauseId, args, detail). `can.*` runs the same
// checks as booleans for render-time gating. Hand-written prototype of the shape
// `lsc guard` will emit; internal core-to-core calls stay raw (the proof covers them).

import {
  sumTo,
  itemShare as _itemShare,
  bill as _bill,
  balances as _balances,
  settleRounded as _settleRounded,
} from "./allocate";

export class PreconditionError extends Error {
  constructor(
    readonly fn: string,
    readonly clause: string,
    readonly clauseId: string,
    readonly args: unknown[],
    readonly detail: unknown,
  ) {
    super(`precondition failed in ${fn}: ${clause}`);
    this.name = "PreconditionError";
  }
}

// One entry per `//@ requires`: stable id, source text, evaluated truth, and a
// thunk for the debugging detail (operand values, or a forall's falsifying witness).
// The thunk runs only on a throw, so it may assume the clause is false.
type Check = { id: string; clause: string; ok: boolean; detail: () => unknown };
const C = (id: string, clause: string, ok: boolean, detail: () => unknown): Check => ({ id, clause, ok, detail });

// First falsifying index of a bounded forall (-1 if it holds).
function witness<T>(arr: T[], pred: (x: T, i: number) => boolean): number {
  for (let i = 0; i < arr.length; i++) if (!pred(arr[i], i)) return i;
  return -1;
}

function enforce<R>(fn: string, args: unknown[], checks: Check[], call: () => R): R {
  for (const c of checks) if (!c.ok) throw new PreconditionError(fn, c.clause, c.id, args, c.detail());
  return call();
}
const holds = (checks: Check[]): boolean => checks.every((c) => c.ok);

// ── per-function clause tables ───────────────────────────────────────
function checks_itemShare(price: number, claimers: number[], claimerWeights: number[], n: number, G: number): Check[] {
  const wc = witness(claimers, (c) => 0 <= c && c < n);
  const ww = witness(claimerWeights, (w) => w >= 0);
  const sw = sumTo(claimerWeights, claimerWeights.length);
  return [
    C("itemShare#0", "price >= 0", price >= 0, () => ({ price })),
    C("itemShare#1", "n >= 1", n >= 1, () => ({ n })),
    C("itemShare#2", "claimers.length >= 1", claimers.length >= 1, () => ({ "claimers.length": claimers.length })),
    C("itemShare#3", "claimers.length === claimerWeights.length", claimers.length === claimerWeights.length,
      () => ({ "claimers.length": claimers.length, "claimerWeights.length": claimerWeights.length })),
    C("itemShare#4", "0 <= claimers[j] && claimers[j] < n", wc === -1, () => ({ j: wc, "claimers[j]": claimers[wc], n })),
    C("itemShare#5", "claimerWeights[j] >= 0", ww === -1, () => ({ j: ww, "claimerWeights[j]": claimerWeights[ww] })),
    C("itemShare#6", "sumTo(claimerWeights) >= 1", sw >= 1, () => ({ "sumTo(claimerWeights)": sw })),
    C("itemShare#7", "G >= 1", G >= 1, () => ({ G })),
  ];
}

function checks_bill(itemVectors: number[][], prices: number[], tax: number, tip: number, n: number, G: number): Check[] {
  const wlen = witness(itemVectors, (v) => v.length === n);
  const wsum = witness(itemVectors, (v, i) => sumTo(v, n) === prices[i]);
  let ni = -1, nk = -1; // first (i,k) with itemVectors[i][k] < 0
  for (let i = 0; i < itemVectors.length && ni < 0; i++)
    for (let k = 0; k < n; k++) if (!(itemVectors[i][k] >= 0)) { ni = i; nk = k; break; }
  const sp = sumTo(prices, prices.length);
  return [
    C("bill#0", "n >= 1", n >= 1, () => ({ n })),
    C("bill#1", "itemVectors.length === prices.length", itemVectors.length === prices.length,
      () => ({ "itemVectors.length": itemVectors.length, "prices.length": prices.length })),
    C("bill#2", "itemVectors[i].length === n", wlen === -1, () => ({ i: wlen, "itemVectors[i].length": itemVectors[wlen].length, n })),
    C("bill#3", "sumTo(itemVectors[i], n) === prices[i]", wsum === -1,
      () => ({ i: wsum, "sumTo(itemVectors[i])": sumTo(itemVectors[wsum], n), "prices[i]": prices[wsum] })),
    C("bill#4", "itemVectors[i][k] >= 0", ni === -1, () => ({ i: ni, k: nk, value: itemVectors[ni][nk] })),
    C("bill#5", "sumTo(prices) >= 1", sp >= 1, () => ({ "sumTo(prices)": sp })),
    C("bill#6", "tax >= 0", tax >= 0, () => ({ tax })),
    C("bill#7", "tip >= 0", tip >= 0, () => ({ tip })),
    C("bill#8", "G >= 1", G >= 1, () => ({ G })),
  ];
}

function checks_balances(paid: number[], owed: number[]): Check[] {
  const sp = sumTo(paid, paid.length), so = sumTo(owed, owed.length);
  return [
    C("balances#0", "paid.length === owed.length", paid.length === owed.length,
      () => ({ "paid.length": paid.length, "owed.length": owed.length })),
    C("balances#1", "sumTo(paid) === sumTo(owed)", sp === so, () => ({ "sumTo(paid)": sp, "sumTo(owed)": so })),
  ];
}

function checks_settleRounded(bal: number[], hub: number, G: number): Check[] {
  return [
    C("settleRounded#0", "balances.length >= 1", bal.length >= 1, () => ({ "balances.length": bal.length })),
    C("settleRounded#1", "0 <= hub && hub < balances.length", 0 <= hub && hub < bal.length,
      () => ({ hub, "balances.length": bal.length })),
    C("settleRounded#2", "G >= 1", G >= 1, () => ({ G })),
  ];
}

// ── guarded drop-in (same names/signatures as allocate.ts) ───────────
export function itemShare(price: number, claimers: number[], claimerWeights: number[], n: number, G: number): number[] {
  return enforce("itemShare", [price, claimers, claimerWeights, n, G],
    checks_itemShare(price, claimers, claimerWeights, n, G),
    () => _itemShare(price, claimers, claimerWeights, n, G));
}
export function bill(itemVectors: number[][], prices: number[], tax: number, tip: number, n: number, G: number): number[] {
  return enforce("bill", [itemVectors, prices, tax, tip, n, G],
    checks_bill(itemVectors, prices, tax, tip, n, G),
    () => _bill(itemVectors, prices, tax, tip, n, G));
}
export function balances(paid: number[], owed: number[]): number[] {
  return enforce("balances", [paid, owed], checks_balances(paid, owed), () => _balances(paid, owed));
}
export function settleRounded(bal: number[], hub: number, G: number): number[] {
  return enforce("settleRounded", [bal, hub, G], checks_settleRounded(bal, hub, G), () => _settleRounded(bal, hub, G));
}

// ── companion predicates (same checks, as booleans) ──────────────────
export const can = {
  itemShare: (price: number, claimers: number[], claimerWeights: number[], n: number, G: number): boolean =>
    holds(checks_itemShare(price, claimers, claimerWeights, n, G)),
  bill: (itemVectors: number[][], prices: number[], tax: number, tip: number, n: number, G: number): boolean =>
    holds(checks_bill(itemVectors, prices, tax, tip, n, G)),
  balances: (paid: number[], owed: number[]): boolean => holds(checks_balances(paid, owed)),
  settleRounded: (bal: number[], hub: number, G: number): boolean => holds(checks_settleRounded(bal, hub, G)),
};
