//@ backend dafny

// ════════════════════════════════════════════════════════════════
// EvenTab — v0, the version you write first  (EXPECTED TO FAIL)
//
// This file is a teaching counterexample. It is NOT in the verified
// manifest (LemmaScript-files.txt) on purpose: it is meant to be
// REJECTED. Run it to watch the proof fail:
//
//   npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny \
//       src/allocateNaive.ts
//
// The instinct (and the code an AI hands you): compute each party's
// fair share and floor it to whole cents. Ship it. It looks right; a
// few hand-examples even pass. But the cents shaved off by each floor
// just vanish — Σ result comes up SHORT of `total`. No unit test you
// were likely to write catches it. The verifier does, instantly:
//
//   allocate(10, [1, 1, 1])  ->  [3, 3, 3]   // sum 9, not 10  ← a cent gone
//
// The fix is one more loop — hand the leftover cents back out — which
// is exactly `allocate` in allocate.ts (largest-remainder). The proof
// obligation is what DROVE that fix. (Rounding each share instead of
// flooring has the same disease: the parts don't sum to the whole.)
// ════════════════════════════════════════════════════════════════

// Same prefix-sum helper as the verified core (kept local so the
// rejection is about conservation, not a cross-file opaque symbol).
export function sumTo(arr: number[], n: number): number {
  //@ requires 0 <= n && n <= arr.length
  //@ decreases n
  if (n === 0) return 0;
  return sumTo(arr, n - 1) + arr[n - 1];
}

export function allocateNaive(total: number, weights: number[]): number[] {
  //@ requires total >= 0
  //@ requires weights.length >= 1
  //@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
  //@ requires sumTo(weights, weights.length) >= 1
  //@ ensures \result.length === weights.length
  // The next line is UNPROVABLE — the floors lose cents, so Σ < total:
  //@ ensures sumTo(\result, \result.length) === total
  //@ type i nat

  const n = weights.length;
  const W = sumTo(weights, n);

  // Floor each fair share and ship it. No redistribution — that's the bug.
  let result: number[] = [];
  let i = 0;
  while (i < n) {
    //@ invariant 0 <= i && i <= n
    //@ invariant result.length === i
    //@ decreases n - i
    result = [...result, Math.floor((total * weights[i]) / W)];
    i = i + 1;
  }
  return result;
}
