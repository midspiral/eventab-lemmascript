//@ backend dafny

import { floorShareG } from "./floorShare";

// ════════════════════════════════════════════════════════════════
// EvenTab — verified allocation kernel  (Stage 0 spike)
//
// allocate(total, weights, G): split an integer `total` (in CENTS)
// across parties in proportion to `weights`, at ROUNDNESS G — every
// amount is a whole multiple of G (G = 1 cent, 100 = $1, 500 = $5),
// except a single sub-G remainder that one party absorbs so the books
// still balance exactly. Two theorems, for ANY weights, ANY total,
// ANY roundness G >= 1:
//
//   CONSERVATION   Σ result === total       (exact — never traded for
//                                             roundness)
//   FAIRNESS       within one roundness unit G of the exact fair share
//                  (layered next)
//
// Method: largest-remainder at granularity G. G-floor each party's
// fair share (`floorShareG`, imported so the verifier treats it
// opaquely — see floorShare.ts); the floors under-shoot by fewer than
// n·G cents; hand whole-G chunks back to the parties rounded down, then
// drop the final sub-G remainder on the last party — that cent has
// nowhere to hide.
//
// Money is INTEGER CENTS — no floats. (Bare `/` is real division;
// integer floor is `Math.floor(...)` → JS-faithful `JSFloorDiv`.)
// ════════════════════════════════════════════════════════════════

export function sumTo(arr: number[], n: number): number {
  //@ requires 0 <= n && n <= arr.length
  //@ decreases n
  if (n === 0) return 0;
  return sumTo(arr, n - 1) + arr[n - 1];
}

export function allocate(total: number, weights: number[], G: number): number[] {
  //@ requires total >= 0
  //@ requires weights.length >= 1
  //@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
  //@ requires sumTo(weights, weights.length) >= 1
  //@ requires G >= 1
  //@ ensures \result.length === weights.length
  //@ ensures sumTo(\result, \result.length) === total
  //@ ensures forall(k, 0 <= k && k < \result.length ==> floorShareG(total, weights[k], sumTo(weights, weights.length), G) <= \result[k])
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] <= floorShareG(total, weights[k], sumTo(weights, weights.length), G) + G)
  //@ type i nat
  //@ type j nat

  const n = weights.length;
  const W = sumTo(weights, n);

  // ── Pass 1: G-floor each share ───────────────────────────────
  // `floorShareG` is opaque to the verifier; its two lifted `ensures`
  // give us the cross-multiplied bracket we carry as the invariant.
  let result: number[] = [];
  let placed = 0;
  let i = 0;
  while (i < n) {
    //@ invariant 0 <= i && i <= n
    //@ invariant result.length === i
    //@ invariant placed === sumTo(result, i)
    //@ invariant placed * W <= total * sumTo(weights, i)
    //@ invariant forall(k, 0 <= k && k < i ==> result[k] === floorShareG(total, weights[k], W, G))
    //@ decreases n - i
    const share = floorShareG(total, weights[i], W, G);
    result = [...result, share];
    placed = placed + share;
    i = i + 1;
  }
  // 0 <= D < n·G. Split D into L whole-G chunks plus a sub-G remainder.
  //@ assert placed <= total
  //@ assert total <= placed + (n * G - 1)
  const D = total - placed;
  const L = Math.floor(D / G);
  const rem = D - L * G;

  // ── Pass 2: a whole +G to the first L parties ────────────────
  let j = 0;
  while (j < L) {
    //@ invariant 0 <= j && j <= L
    //@ invariant L < n
    //@ invariant result.length === n
    //@ invariant sumTo(result, n) === placed + j * G
    //@ invariant forall(k, 0 <= k && k < j ==> result[k] === floorShareG(total, weights[k], W, G) + G)
    //@ invariant forall(k, j <= k && k < n ==> result[k] === floorShareG(total, weights[k], W, G))
    //@ decreases L - j
    result[j] = result[j] + G;
    j = j + 1;
  }
  // ── Pass 3: the sub-G remainder lands on the last party ──────
  result[n - 1] = result[n - 1] + rem;
  return result;
}
