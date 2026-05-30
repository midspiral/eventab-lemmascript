//@ backend dafny

// Party-share rounding for EvenTab's allocation kernel.
//
// floorShareG is split into its own module on purpose: when `allocate`
// imports it, LemmaScript emits it as an OPAQUE axiom and lifts the
// bounds below onto every caller (SPEC §2.5.2). So `allocate` reasons
// against the cross-multiplied bracket WITHOUT ever unfolding the
// division — which is exactly what keeps its verification fast. The
// div reasoning is proved once, here.

// Party k's exact fair share, ROUNDED DOWN to a whole multiple of the
// roundness unit G:  G · ⌊ total·weight / (W·G) ⌋, where W = Σ weights.
// (G = 1 cent, 100 = $1, 500 = nearest $5.)
//
// The two `ensures` bracket it, cross-multiplied by W: the rounded
// share never exceeds the exact share, and falls short by less than W·G.
export function floorShareG(total: number, weight: number, W: number, G: number): number {
  //@ requires W >= 1
  //@ requires G >= 1
  //@ requires total >= 0
  //@ requires weight >= 0
  //@ ensures \result >= 0
  //@ ensures \result * W <= total * weight
  //@ ensures total * weight <= \result * W + (W * G - 1)
  return G * Math.floor((total * weight) / (W * G));
}
