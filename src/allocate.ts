//@ backend dafny

// ════════════════════════════════════════════════════════════════
// EvenTab — verified allocation kernel  (Stage 0 spike)
//
// allocate(total, weights): split an integer `total` (in CENTS) across
// parties in proportion to `weights` — losing nothing, shorting no one.
// Two theorems, both for ANY weights and ANY total:
//
//   CONSERVATION   Σ result === total                  (not a cent lost)
//   FAIRNESS       floorShare(k) ≤ result[k] ≤ floorShare(k) + 1
//                  — everyone gets their exact fair share rounded down,
//                    plus at most one extra cent: within a cent of fair.
//
// Method: largest-remainder (Hamilton apportionment). Floor each party's
// exact fair share; the floors under-shoot `total` by a whole number of
// cents (fewer than n of them); hand those leftover cents back out, one
// per party. A party gets at most one redistributed cent, so it lands in
// [floorShare, floorShare + 1] — that interval IS the fairness bound.
//
// Money is INTEGER CENTS — no floats. (In LemmaScript bare `/` is real
// division, matching JS; integer floor is `Math.floor(...)`, lowering to
// the JS-faithful `JSFloorDiv`.)
// ════════════════════════════════════════════════════════════════

// Prefix sum  Σ arr[0..n).  A spec helper that is also a runtime function.
export function sumTo(arr: number[], n: number): number {
  //@ requires 0 <= n && n <= arr.length
  //@ decreases n
  if (n === 0) return 0;
  return sumTo(arr, n - 1) + arr[n - 1];
}

// Party k's exact fair share ROUNDED DOWN to whole cents:
// floor(total · weights[k] / W), where W = Σ weights. Largest-remainder
// starts everyone here, then hands the shaved-off cents back.
export function floorShareOf(total: number, weights: number[], k: number): number {
  //@ requires 0 <= k && k < weights.length
  //@ requires sumTo(weights, weights.length) >= 1
  return Math.floor((total * weights[k]) / sumTo(weights, weights.length));
}

export function allocate(total: number, weights: number[]): number[] {
  //@ requires total >= 0
  //@ requires weights.length >= 1
  //@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
  //@ requires sumTo(weights, weights.length) >= 1
  //@ ensures \result.length === weights.length
  //@ ensures sumTo(\result, \result.length) === total
  //@ ensures forall(k, 0 <= k && k < \result.length ==> floorShareOf(total, weights, k) <= \result[k])
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] <= floorShareOf(total, weights, k) + 1)
  //@ type i nat
  //@ type j nat

  const n = weights.length;
  const W = sumTo(weights, n); // total weight, >= 1 by precondition

  // ── Pass 1: start everyone at their floored fair share ───────
  // The two product invariants bracket Σ floors against the exact ideal:
  // the floors never exceed `total` (lower) and fall short by < n (upper).
  let result: number[] = [];
  let placed = 0;
  let i = 0;
  while (i < n) {
    //@ invariant 0 <= i && i <= n
    //@ invariant result.length === i
    //@ invariant placed === sumTo(result, i)
    //@ invariant forall(k, 0 <= k && k < i ==> result[k] === floorShareOf(total, weights, k))
    //@ invariant placed * W <= total * sumTo(weights, i)
    //@ decreases n - i
    const share = floorShareOf(total, weights, i);
    result = [...result, share];
    placed = placed + share;
    i = i + 1;
  }
  // 0 <= leftover < n: the floors lose at least 0 and fewer than n cents.
  //@ assert placed <= total
  //@ assert total <= placed + (n - 1)

  // ── Pass 2: hand the leftover cents back, one per party ──────
  // `leftover` cents remain (0 ≤ leftover < n). Give a +1 to the first
  // `leftover` parties — each gets at most one, so each result[k] stays
  // in [floorShare(k), floorShare(k) + 1]: exactly the fairness bound.
  const leftover = total - placed;
  let j = 0;
  while (j < leftover) {
    //@ invariant 0 <= j && j <= leftover
    //@ invariant leftover <= n
    //@ invariant result.length === n
    //@ invariant sumTo(result, n) === placed + j
    //@ invariant forall(k, 0 <= k && k < j ==> result[k] === floorShareOf(total, weights, k) + 1)
    //@ invariant forall(k, j <= k && k < n ==> result[k] === floorShareOf(total, weights, k))
    //@ decreases leftover - j
    result[j] = result[j] + 1;
    j = j + 1;
  }
  return result;
}
