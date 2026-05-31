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

// ════════════════════════════════════════════════════════════════
// Bill model (Stage 1) — conservation COMPOSES on top of `allocate`.
//
// Given each person's item subtotal, split tax and tip across the table
// in proportion to those subtotals (allocate weighted by subtotal), and
// hand each person  subtotal + taxShare + tipShare. The composed
// theorem — the one a 5-way split with 18% tip can't be checked by hand:
//
//   Σ person totals === Σ subtotals + tax + tip   (the grand total)
//
// exactly, for any subtotals and any roundness G. It falls straight out
// of `allocate`'s conservation: tax shares sum to tax, tip shares to tip,
// and the per-person sum is linear.
// ════════════════════════════════════════════════════════════════
export function billTotals(subtotals: number[], tax: number, tip: number, G: number): number[] {
  //@ requires subtotals.length >= 1
  //@ requires forall(k, 0 <= k && k < subtotals.length ==> subtotals[k] >= 0)
  //@ requires sumTo(subtotals, subtotals.length) >= 1
  //@ requires tax >= 0
  //@ requires tip >= 0
  //@ requires G >= 1
  //@ ensures \result.length === subtotals.length
  //@ ensures sumTo(\result, \result.length) === sumTo(subtotals, subtotals.length) + tax + tip
  //@ type p nat

  const n = subtotals.length;
  // allocate's postconditions give: |taxShares| === n && Σ taxShares === tax
  // (and likewise for tip) — proportional to subtotals, conserving.
  const taxShares = allocate(tax, subtotals, G);
  const tipShares = allocate(tip, subtotals, G);

  let totals: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant totals.length === p
    //@ invariant sumTo(totals, p) === sumTo(subtotals, p) + sumTo(taxShares, p) + sumTo(tipShares, p)
    //@ decreases n - p
    totals = [...totals, subtotals[p] + taxShares[p] + tipShares[p]];
    p = p + 1;
  }
  return totals;
}

// Split one item's `price` across the people who CLAIMED it, scattered into an
// n-person vector. `claimers[j]` is the person index that claim j belongs to and
// `claimerWeights[j]` their weight (all 1 = an even split). We allocate over the
// claimers only — so the leftover-cent redistribution can never touch someone
// who didn't order the item (see FALSE_START.md §1) — then scatter the shares
// home. CONSERVATION: every cent of `price` lands on a claimer.
export function itemShare(price: number, claimers: number[], claimerWeights: number[], n: number, G: number): number[] {
  //@ requires price >= 0
  //@ requires n >= 1
  //@ requires claimers.length >= 1
  //@ requires claimers.length === claimerWeights.length
  //@ requires forall(j, 0 <= j && j < claimers.length ==> 0 <= claimers[j] && claimers[j] < n)
  //@ requires forall(j, 0 <= j && j < claimerWeights.length ==> claimerWeights[j] >= 0)
  //@ requires sumTo(claimerWeights, claimerWeights.length) >= 1
  //@ requires G >= 1
  //@ ensures \result.length === n
  //@ ensures sumTo(\result, n) === price
  //@ ensures forall(q, 0 <= q && q < n && !claimers.includes(q) ==> \result[q] === 0)
  //@ type p nat
  //@ type j nat

  const c = claimers.length;
  // allocate gives: |shares| === c && Σ shares === price (over the claimers only)
  const shares = allocate(price, claimerWeights, G);

  // Everyone starts at 0 — non-claimers stay here.
  let result: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant result.length === p
    //@ invariant sumTo(result, p) === 0
    //@ invariant forall(q, 0 <= q && q < p ==> result[q] === 0)
    //@ decreases n - p
    result = [...result, 0];
    p = p + 1;
  }

  // Scatter: hand claim j's share home to person claimers[j]. A person not yet
  // touched stays 0, so anyone never in `claimers` ends at 0.
  let j = 0;
  while (j < c) {
    //@ invariant 0 <= j && j <= c
    //@ invariant result.length === n
    //@ invariant sumTo(result, n) === sumTo(shares, j)
    //@ invariant forall(q, 0 <= q && q < n && forall(jp, 0 <= jp && jp < j ==> claimers[jp] !== q) ==> result[q] === 0)
    //@ decreases c - j
    result[claimers[j]] = result[claimers[j]] + shares[j];
    j = j + 1;
  }
  return result;
}

// Element-wise sum of two equal-length vectors. The sum of the result is the
// sum of the parts — the linearity that lets per-person subtotals accumulate
// across items without losing a cent.
export function vectorAdd(a: number[], b: number[]): number[] {
  //@ requires a.length === b.length
  //@ ensures \result.length === a.length
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === a[k] + b[k])
  //@ ensures sumTo(\result, \result.length) === sumTo(a, a.length) + sumTo(b, b.length)
  //@ type p nat

  const n = a.length;
  let result: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant result.length === p
    //@ invariant forall(k, 0 <= k && k < p ==> result[k] === a[k] + b[k])
    //@ invariant sumTo(result, p) === sumTo(a, p) + sumTo(b, p)
    //@ decreases n - p
    result = [...result, a[p] + b[p]];
    p = p + 1;
  }
  return result;
}

// Roll up per-person subtotals from each item's scattered share-vector (one
// vector per item, each conserving to its own price — the shell builds them with
// `itemShare`). The composed theorem — the sum-swap — is that nothing leaks in
// the roll-up: Σ subtotals === Σ item prices, for any claim pattern. Proven by
// accumulation: the running Σ subtotals equals the running Σ prices, item by item.
export function itemSubtotals(itemVectors: number[][], prices: number[], n: number): number[] {
  //@ requires n >= 1
  //@ requires itemVectors.length === prices.length
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> itemVectors[i].length === n)
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> sumTo(itemVectors[i], n) === prices[i])
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> forall(k, 0 <= k && k < n ==> itemVectors[i][k] >= 0))
  //@ ensures \result.length === n
  //@ ensures sumTo(\result, n) === sumTo(prices, prices.length)
  //@ ensures forall(k, 0 <= k && k < n ==> \result[k] >= 0)
  //@ type p nat
  //@ type i nat

  const m = itemVectors.length;

  // Everyone starts at 0.
  let subtotals: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant subtotals.length === p
    //@ invariant sumTo(subtotals, p) === 0
    //@ invariant forall(k, 0 <= k && k < p ==> subtotals[k] >= 0)
    //@ decreases n - p
    subtotals = [...subtotals, 0];
    p = p + 1;
  }

  // Add in each item's vector; the running sum stays equal to the prices so far.
  let i = 0;
  while (i < m) {
    //@ invariant 0 <= i && i <= m
    //@ invariant subtotals.length === n
    //@ invariant sumTo(subtotals, n) === sumTo(prices, i)
    //@ invariant forall(k, 0 <= k && k < n ==> subtotals[k] >= 0)
    //@ decreases m - i
    subtotals = vectorAdd(subtotals, itemVectors[i]);
    i = i + 1;
  }
  return subtotals;
}

// The whole bill, leaves to root. Roll items up into per-person subtotals, then
// split tax and tip across the table — and the cents still add up exactly:
//
//   Σ person totals === Σ item prices + tax + tip   (the GRAND TOTAL)
//
// for any items, any claim pattern, any roundness G. The thing you can't check
// by hand on a $237.46 five-way split with 18% tip — proven, end to end, by
// composing `itemSubtotals` (Σ subtotals === Σ prices) with `billTotals`
// (Σ totals === Σ subtotals + tax + tip).
export function bill(itemVectors: number[][], prices: number[], tax: number, tip: number, n: number, G: number): number[] {
  //@ requires n >= 1
  //@ requires itemVectors.length === prices.length
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> itemVectors[i].length === n)
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> sumTo(itemVectors[i], n) === prices[i])
  //@ requires forall(i, 0 <= i && i < itemVectors.length ==> forall(k, 0 <= k && k < n ==> itemVectors[i][k] >= 0))
  //@ requires sumTo(prices, prices.length) >= 1
  //@ requires tax >= 0
  //@ requires tip >= 0
  //@ requires G >= 1
  //@ ensures \result.length === n
  //@ ensures sumTo(\result, n) === sumTo(prices, prices.length) + tax + tip

  const subtotals = itemSubtotals(itemVectors, prices, n);
  return billTotals(subtotals, tax, tip, G);
}

// ════════════════════════════════════════════════════════════════
// Balances & settlement (Stage 2).
//
// Some people fronted money (paid the waiter); everyone owes their total.
// A person's NET BALANCE is what they paid minus what they owe — positive
// = owed money back, negative = still owes. The load-bearing fact:
//
//   Σ balances === 0   always   (it's a redistribution, not a faucet)
//
// — which holds exactly when the money paid in equals the money owed out
// (the grand total). No money appears or disappears at the netting step.
// ════════════════════════════════════════════════════════════════
export function balances(paid: number[], owed: number[]): number[] {
  //@ requires paid.length === owed.length
  //@ requires sumTo(paid, paid.length) === sumTo(owed, owed.length)
  //@ ensures \result.length === paid.length
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === paid[k] - owed[k])
  //@ ensures sumTo(\result, \result.length) === 0
  //@ type p nat

  const n = paid.length;
  let result: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant result.length === p
    //@ invariant forall(k, 0 <= k && k < p ==> result[k] === paid[k] - owed[k])
    //@ invariant sumTo(result, p) === sumTo(paid, p) - sumTo(owed, p)
    //@ decreases n - p
    result = [...result, paid[p] - owed[p]];
    p = p + 1;
  }
  return result;
}

// settle(balances): the payments that square everyone up, routed through a HUB
// (the last person). For each other person p there is one transfer with the
// hub of `balances[p]` — positive = the hub pays p (p was a creditor), negative
// = p pays the hub (p was a debtor). The hub takes whatever is left over; and
// because `Σ balances === 0`, that residual is *exactly* the hub's own balance,
// so the hub squares too with no separate transfer. Two proven facts:
//
//   net[p] === balances[p]  for every p   (everyone ends square)
//   Σ net === 0                            (settlement invents no money)
//
// `net[p]` is person p's net cash with the hub; a shell renders it as
// "p pays hub $X" / "hub pays p $X". Routing through one hub is valid and
// conserving but not minimal — minimality is NP-hard (DESIGN §5).
export function settle(balances: number[]): number[] {
  //@ requires balances.length >= 1
  //@ requires sumTo(balances, balances.length) === 0
  //@ ensures \result.length === balances.length
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === balances[k])
  //@ ensures sumTo(\result, \result.length) === 0
  //@ type p nat

  const n = balances.length;
  let net: number[] = [];
  let hubNet = 0;
  let p = 0;
  while (p < n - 1) {
    //@ invariant 0 <= p && p <= n - 1
    //@ invariant net.length === p
    //@ invariant forall(k, 0 <= k && k < p ==> net[k] === balances[k])
    //@ invariant sumTo(net, p) === sumTo(balances, p)
    //@ invariant hubNet === 0 - sumTo(balances, p)
    //@ decreases (n - 1) - p
    net = [...net, balances[p]];
    hubNet = hubNet - balances[p];
    p = p + 1;
  }
  // The hub (person n-1) takes the residual `hubNet`, which Σ === 0 pins to be
  // exactly `balances[n-1]` — so `net === balances` and the books still sum to 0.
  net = [...net, hubNet];
  return net;
}

// settleRounded(balances, hub, G): the SAME star settlement, but each non-hub
// transfer is ROUNDED to a whole multiple of G and the HUB (the person who
// fronted the bill) absorbs the leftover — so every other person pays/receives a
// round number while the books still balance exactly. Shares stay computed to the
// cent (G is applied here, to the settlement, NOT to the per-item split — so an
// even split stays even). The load-bearing fact, the one that makes "the payer
// eats the rounding" safe:
//
//   Σ net === 0     (rounding the transfers invents and loses no money)
//
// net[p] for p ≠ hub is balances[p] rounded to the nearest G; net[hub] is set to
// whatever makes the sum zero. At G === 1 there is no rounding and net === balances.
export function settleRounded(balances: number[], hub: number, G: number): number[] {
  //@ requires balances.length >= 1
  //@ requires 0 <= hub && hub < balances.length
  //@ requires G >= 1
  //@ ensures \result.length === balances.length
  //@ ensures sumTo(\result, \result.length) === 0
  //@ type p nat

  const n = balances.length;
  const half = Math.floor(G / 2);

  let net: number[] = [];
  let s = 0;
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant net.length === p
    //@ invariant sumTo(net, p) === s
    //@ invariant hub < p ==> net[hub] === 0
    //@ decreases n - p
    const v = p === hub ? 0 : G * Math.floor((balances[p] + half) / G);
    net = [...net, v];
    s = s + v;
    p = p + 1;
  }
  // The hub absorbs the remainder so the books still sum to zero. (net[hub] is 0
  // here, so this sets it to -s = -(Σ of the rounded non-hub transfers).)
  net[hub] = net[hub] - s;
  return net;
}

// ════════════════════════════════════════════════════════════════
// Ephemeral op-log (Stage 3) — every reachable tab conserves.
//
// Multiple devices edit one shared tab; the Durable Object serializes the edits
// into an append-only log of claims/payments and replays it. We model each edit
// as a balanced LEDGER ENTRY — `amount` moved from one account to another (a
// claim moves a share onto a person, a payment moves it off) — and prove the
// one thing that must hold over EVERY replay:
//
//   Σ balances === 0   for any op log, in any order   (no money invented)
//
// That invariant is what the live sync rests on. We deliberately do NOT verify
// convergence (that edits commute) — the DO's serialization hands us that for
// free; the load-bearing fact is the money, not the ordering.
// ════════════════════════════════════════════════════════════════

// One edit: move `amount` from account `from` to account `to`. Balanced, so it
// preserves the running total exactly — the invariant-preservation step.
export function applyOp(bal: number[], from: number, to: number, amount: number): number[] {
  //@ requires 0 <= from && from < bal.length
  //@ requires 0 <= to && to < bal.length
  //@ ensures \result.length === bal.length
  //@ ensures sumTo(\result, \result.length) === sumTo(bal, bal.length)

  let result = bal;
  result[from] = result[from] - amount;
  result[to] = result[to] + amount;
  return result;
}

// Replay an append-only log over an empty tab. However many edits, in whatever
// order the devices produced them, the books still balance: Σ === 0.
export function replay(froms: number[], tos: number[], amounts: number[], n: number): number[] {
  //@ requires n >= 1
  //@ requires froms.length === tos.length
  //@ requires tos.length === amounts.length
  //@ requires forall(k, 0 <= k && k < froms.length ==> 0 <= froms[k] && froms[k] < n)
  //@ requires forall(k, 0 <= k && k < tos.length ==> 0 <= tos[k] && tos[k] < n)
  //@ ensures \result.length === n
  //@ ensures sumTo(\result, n) === 0
  //@ type p nat
  //@ type k nat

  // Empty tab: everyone at 0.
  let bal: number[] = [];
  let p = 0;
  while (p < n) {
    //@ invariant 0 <= p && p <= n
    //@ invariant bal.length === p
    //@ invariant sumTo(bal, p) === 0
    //@ decreases n - p
    bal = [...bal, 0];
    p = p + 1;
  }

  // Apply each edit; each preserves Σ, so Σ stays 0 — for any log, any order.
  let k = 0;
  while (k < froms.length) {
    //@ invariant 0 <= k && k <= froms.length
    //@ invariant bal.length === n
    //@ invariant sumTo(bal, n) === 0
    //@ decreases froms.length - k
    bal = applyOp(bal, froms[k], tos[k], amounts[k]);
    k = k + 1;
  }
  return bal;
}
