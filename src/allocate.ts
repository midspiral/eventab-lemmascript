//@ backend dafny

// ════════════════════════════════════════════════════════════════
// EvenTab — verified allocation kernel  (Stage 0 spike)
//
// allocate(total, weights): split an integer `total` (in CENTS) across
// parties in proportion to `weights`, losing nothing. The headline
// theorem is CONSERVATION —  Σ result === total — and it holds
// unconditionally, for any weights and any total.
//
// Method: largest-remainder (Hamilton apportionment). Floor each
// party's exact fair share; those floors under-shoot `total` by a whole
// number of cents (between 0 and n-1 of them); hand the leftover cents
// out one at a time. No cent is created or destroyed.
//
// Money is INTEGER CENTS — no floats. (In LemmaScript bare `/` is real
// division, matching JS; integer floor is written `Math.floor(...)`,
// which lowers to the JS-faithful `JSFloorDiv`.)
// ════════════════════════════════════════════════════════════════

// Prefix sum  Σ arr[0..n).  A spec helper (used inside //@ annotations)
// that is also an ordinary runtime function — so we can compute the
// total weight with it and let the verifier reason about the same term.
export function sumTo(arr: number[], n: number): number {
  //@ requires 0 <= n && n <= arr.length
  //@ decreases n
  if (n === 0) return 0;
  return sumTo(arr, n - 1) + arr[n - 1];
}

export function allocate(total: number, weights: number[]): number[] {
  //@ requires total >= 0
  //@ requires weights.length >= 1
  //@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
  //@ requires sumTo(weights, weights.length) >= 1
  //@ ensures \result.length === weights.length
  //@ ensures sumTo(\result, \result.length) === total
  //@ type i nat
  //@ type j nat

  const n = weights.length;
  const W = sumTo(weights, n); // total weight, >= 1 by precondition

  // ── Pass 1: floor each party's exact fair share ──────────────
  // result[i] = floor(total * weights[i] / W).  The accumulator
  // `placed` tracks Σ result so far; the product invariant pins it
  // below the exact ideal, which gives placed <= total at the end.
  let result: number[] = [];
  let placed = 0;
  let i = 0;
  while (i < n) {
    //@ invariant 0 <= i && i <= n
    //@ invariant result.length === i
    //@ invariant placed === sumTo(result, i)
    //@ invariant placed * W <= total * sumTo(weights, i)
    //@ decreases n - i
    const share = Math.floor((total * weights[i]) / W);
    //@ assert share * W <= total * weights[i]
    result = [...result, share];
    placed = placed + share;
    i = i + 1;
  }
  //@ assert placed <= total

  // ── Pass 2: hand out the leftover cents, one per party ───────
  // Exactly `total - placed` cents remain (a non-negative number,
  // fewer than n). Round-robin a +1 onto parties until none are left.
  let leftover = total - placed;
  let j = 0;
  while (leftover > 0) {
    //@ invariant 0 <= leftover
    //@ invariant result.length === n
    //@ invariant 0 <= j && j < n
    //@ invariant sumTo(result, n) === total - leftover
    //@ decreases leftover
    result[j] = result[j] + 1;
    leftover = leftover - 1;
    j = j + 1;
    if (j >= n) j = 0;
  }
  return result;
}
