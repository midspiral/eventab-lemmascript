# EvenTab — Design

> **Split the tab, even — provably to the cent.**

EvenTab is an ephemeral, no-login group bill-splitter whose money math is a
*theorem*. A Dafny-verified core (integer cents, no floats) splits a bill across
a table — items, tax, tip, who-paid, who-owes-whom — and proves the part you
can't check by hand: every cent of the bill lands on exactly one person, nobody
is overcharged beyond the rounding they chose, and the suggested payments settle
everyone to zero. A single-file React shell wraps the core and ships to the
browser.

This document describes the system as built: the verified core (`src/`), the
properties it proves, and the untrusted shell (`ui/`) that may only *call* the
proven operations.

---

## 1. The product

No accounts, ever. You open a tab in the browser, fill it in, and share a link.

1. **Enter the tab.** Add people. Add items with a price, and tap who's in on
   each. Enter tax and tip (with 15/18/20 % helpers).
2. **Say who paid.** Mark what each person fronted (or "paid all" for one payer).
3. **See the split.** Every person's total appears, computed to the exact cent,
   alongside the settlement — who pays whom to square up.
4. **Round the payments, not the shares.** Optionally round each settlement
   transfer to the nearest $1 or $5; the payer absorbs the difference so the
   books still balance. Item shares themselves always stay exact, so an even
   split stays even.
5. **It's ephemeral and local.** The tab lives in `localStorage` and in a
   shareable URL hash — no signup, no server.

## 2. The promise — what is verified, and why

The thing a bill-splitter must get right is the **money**: the output is
hand-uncheckable (nobody verifies a five-way split of a $237.46 bill with 18 %
tip), the failure mode is a vanished cent or a silent overcharge, and no
framework hands you the arithmetic for free. So the arithmetic is exactly what
EvenTab verifies. The core (`src/floorShare.ts` + `src/allocate.ts`) guarantees,
for **every** input and **every** roundness `G ≥ 1`:

1. **Conservation.** The sum of what everyone owes equals the bill — exactly, to
   the cent — no matter the items, the tax, the tip, the rounding, or who
   claimed what. Conservation is never traded for roundness.
2. **Fairness (bounded deviation).** Each person's share is within one roundness
   unit `G` of their exact fair share. Rounding can round; it can't quietly
   overcharge.
3. **Non-claimers pay zero.** A person who didn't order an item is charged
   *exactly* 0 for it — not "approximately 0," not "0 up to a rounding cent."
4. **Composition.** The per-person grand total (item shares + proportional tax +
   proportional tip) sums to the whole bill, end to end — conservation at the
   leaves implies conservation at the root.
5. **Settlement nets to zero.** Net balances sum to zero (a redistribution, not
   a faucet); the suggested transfers drive everyone square and invent no money,
   even when each transfer is rounded and one payer absorbs the remainder.
6. **Every reachable tab conserves.** Modeling concurrent edits as an
   append-only log of balanced ledger entries, replaying *any* log in *any*
   order leaves the books summing to zero.

**The trust boundary, stated plainly.** Verified: all integer-cent allocation,
the bill composition, balances, settlement, and the op-log semantics. *Not*
verified — trusted by design:

- **Floats in the UI.** The core is integer cents; printing `$2.51` and parsing
  a typed `"24.00"` into cents is display/input, unproven.
- **Sync ordering / convergence.** The op-log proof is about the *money* over any
  replay, not that concurrent edits commute; serialization (whoever orders the
  log) is trusted to provide an order, and the money is proven sound over it.
- **Tax/tip *rates*.** The rate is an input; we prove the *allocation* of the
  resulting tax/tip cents, not that the rate is what you intended.
- **No auth.** Tabs are link-shared via the URL hash and live in the browser;
  anyone with the link can edit — by design, like a paper tab on the table.
- **Minimal settlement.** Routing through one hub is *valid and conserving*
  (proven); it is not the *fewest-transfers* settlement (that is NP-hard). No
  silent cap — the hub routing is the stated method.

No "verified end-to-end" claim. The trustworthy artifact is the money.

## 3. The key design insight

> **The whole bill reduces to one verified primitive: split an integer amount
> across weighted parties, losing nothing.**

That primitive is `allocate(total, weights, G)`, by **largest-remainder**
(Hamilton apportionment): floor each party's fair share to a multiple of `G`,
then hand the leftover whole-`G` chunks back out and drop the final sub-`G`
remainder on one designated party so the sum stays exact. Conservation is
*unconditional*; a larger `G` buys rounder numbers at the cost of ≤ `G` fairness
deviation, and conservation is never sacrificed for it.

Everything else **composes** through `allocate`'s contract without re-deriving
it: an item split is `allocate` over its claimers; per-person subtotals are a
linear roll-up; tax and tip are `allocate`d proportional to subtotals; the grand
total falls out. Prove the leaf once, and the tree is sound.

Two consequences shaped the build:

- **Money is integer cents — no floats, ever.** The first money bug is
  `0.1 + 0.2 !== 0.3`. The core works entirely in integer cents; floats appear
  only at the UI edge.
- **Round the settlement, not the shares.** Item shares are always computed at
  `G = 1` (exact cents), so an even $16 / $16 split stays even. Rounding is
  applied only at the final settlement (`settleRounded`), where the payer
  absorbs the difference — keeping each non-payer's transfer a round number
  while the books still balance exactly.

## 4. Data model

The verified core has no records or foreign keys — it works in **integer cents**
and **vectors indexed by abstract party index** `[0, n)`. The shell maps indices
to names and cents to dollar strings.

```ts
//@ backend dafny

// Money is integer cents throughout the core. A "vector" is number[] indexed by
// party. There are no IDs in the core — person i is just index i.

// The spec vocabulary: a prefix sum. Every conservation property is stated as an
// equation over sumTo, and every loop carries a sumTo invariant.
function sumTo(arr: number[], n: number): number   // Σ arr[0..n)

// The one division in the system, quarantined into its own module: party k's
// exact fair share, floored down to a whole multiple of the roundness unit G.
//   floorShareG(total, weight, W, G) = G · ⌊ total·weight / (W·G) ⌋     (W = Σ weights)
function floorShareG(total, weight, W, G): number

// Round x to the nearest whole multiple of G (ties up).
//   roundToG(x, G) = G · ⌊ (x + ⌊G/2⌋) / G ⌋
function roundToG(x, G): number
```

**The invariants (the "Inv" of EvenTab).** EvenTab's well-formedness condition
is not a shape predicate over a record; it is the **conservation laws** the
operations preserve, stated directly as equations over `sumTo`:

- **I1 — Allocation conservation.** `sumTo(allocate(total, w, G)) === total`.
- **I2 — Grand-total conservation.** `sumTo(bill(...)) === Σ prices + tax + tip`.
- **I3 — Zero-sum balances.** `sumTo(balances) === 0`, preserved by every
  settlement and every op-log replay.

**Why integer cents and abstract indices.** Cents make conservation a statement
about integers (no float epsilon, no representable-value caveats), so `=== ` is
exact equality. Abstract indices keep the core free of identity/auth concerns —
the shell owns names and the cents↔dollars conversion, and the core stays a pure
arithmetic kernel that composes.

## 5. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  React + Vite single-file SPA  (UNVERIFIED shell — ui/src/App.tsx)     │
│   • people / items / claims / tax / tip / who-paid / rounding inputs   │
│   • imports the verified core directly; runs it in the browser         │
│   • compute() GATES every core call on its precondition (see below)    │
│   • localStorage + URL-hash share link  (no account, no server)        │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ direct function calls (same module
                                 │ that the proofs are about)
 ╔═══════════════════════════════▼══════════════════════════════════════╗
 ║  VERIFIED money core  —  src/floorShare.ts + src/allocate.ts         ║
 ║  (Dafny: 4 + 39 verified, 0 errors. Integer cents. No floats, no I/O)║
 ║   floorShareG  ........ G-floor + bracketing bounds (the only div)   ║
 ║   allocate  ........... largest-remainder: conservation + fairness   ║
 ║   itemShare / vectorAdd / itemSubtotals / billTotals / bill          ║
 ║                          the bill, leaves → grand total              ║
 ║   balances / settle / settleRounded / roundToG                       ║
 ║                          zero-sum balances + star settlement         ║
 ║   applyOp / replay  ... op-log: Σ === 0 over any replay              ║
 ╚══════════════════════════════════════════════════════════════════════╝
```

**Where the core runs.** The same `src/allocate.ts` the proofs are about is
imported and executed directly by the browser shell — there is no second
implementation and no adapter layer, so the figures on screen are computed by the
proven code.

**The shell is untrusted and gates every call.** `ui/src/App.tsx`'s `compute()`
only ever invokes a core function on inputs that satisfy its precondition, and
*gates* rather than calling out of contract:

- `bill` runs only once there is at least one priced, claimed item
  (`Σ prices ≥ 1`) — its `requires`; until then the UI shows a prompt.
- `balances` / `settleRounded` run only once the tab is fully paid
  (`Σ paid === grand`), so the `Σ net === 0` guarantee is always in-contract;
  until then the UI shows what is still owed instead of a settlement.
- Item shares are always computed at `G = 1`; the chosen roundness `G` is passed
  only to `settleRounded`.

The shell can't violate conservation because it can't do the arithmetic — it can
only call `allocate` / `bill` / `settleRounded`. Live "✓ verified" badges echo
the proven facts (`Σ shares === tab`, `Σ net === 0`) back to the user.

`src/demo.ts` is a committed runtime check: it runs the verified core on a
concrete tab and asserts every money invariant at runtime (`npx tsx src/demo.ts`).

## 6. Properties — the verified catalog

Properties are grouped into families. Spec sketches below are the **real**
`//@ ensures` clauses from `src/allocate.ts` / `src/floorShare.ts`, in LemmaScript
syntax (`forall(k, P)`, `\result`, `sumTo` the prefix sum). All families A–D are
implemented and verified (`4 + 39` verification conditions, 0 errors).

### Family A — Allocation kernel (conservation + fairness) ✅ verified

The G-floor, with its division reasoning proved once and lifted onto callers as
an opaque axiom:

```ts
//@ requires W >= 1 && G >= 1 && total >= 0 && weight >= 0
//@ ensures \result >= 0
//@ ensures \result * W <= total * weight                       // never exceeds the exact share
//@ ensures total * weight <= \result * W + (W * G - 1)         // falls short by < W·G
function floorShareG(total, weight, W, G): number
```

The kernel — split `total` across weighted parties, exact and fair:

```ts
//@ requires total >= 0 && weights.length >= 1 && G >= 1
//@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
//@ requires sumTo(weights, weights.length) >= 1
//@ ensures \result.length === weights.length
//@ ensures sumTo(\result, \result.length) === total                                   // CONSERVATION
//@ ensures forall(k, ... ==> floorShareG(total, weights[k], W, G) <= \result[k])      // FAIRNESS (lower)
//@ ensures forall(k, ... ==> \result[k] <= floorShareG(total, weights[k], W, G) + G)  // FAIRNESS (upper: within G)
function allocate(total: number, weights: number[], G: number): number[]
```

`allocate` is **exact** (`Σ === total`) for any `G`; the fairness pair brackets
every party between its floored fair share and that share plus one roundness
unit — no one is overcharged by more than `G`.

### Family B — Bill composition (conservation composes, leaves → root) ✅ verified

```ts
// Split one item's price across the people who CLAIMED it; scatter home so a
// non-claimer is charged exactly 0 (not "0 ± a rounding cent").
//@ ensures \result.length === n
//@ ensures sumTo(\result, n) === price
//@ ensures forall(q, 0 <= q && q < n && !claimers.includes(q) ==> \result[q] === 0)
function itemShare(price, claimers, claimerWeights, n, G): number[]

// Element-wise vector sum — the linearity that lets subtotals accumulate.
//@ ensures \result.length === a.length
//@ ensures forall(k, ... ==> \result[k] === a[k] + b[k])
//@ ensures sumTo(\result, \result.length) === sumTo(a, a.length) + sumTo(b, b.length)
function vectorAdd(a, b): number[]

// Roll per-item share vectors up into per-person subtotals; nothing leaks.
//@ ensures \result.length === n
//@ ensures sumTo(\result, n) === sumTo(prices, prices.length)        // Σ subtotals === Σ item prices
//@ ensures forall(k, ... ==> \result[k] >= 0)
function itemSubtotals(itemVectors, prices, n): number[]

// Split tax + tip across the table proportional to subtotals.
//@ ensures \result.length === subtotals.length
//@ ensures sumTo(\result, \result.length) === sumTo(subtotals, subtotals.length) + tax + tip
function billTotals(subtotals, tax, tip, G): number[]

// The whole bill, leaves to root — the property you can't check by hand.
//@ ensures \result.length === n
//@ ensures sumTo(\result, n) === sumTo(prices, prices.length) + tax + tip   // THE GRAND TOTAL
function bill(itemVectors, prices, tax, tip, n, G): number[]
```

Each step composes the one below it through its `ensures` — no step re-derives
conservation, it inherits it. `bill`'s grand-total guarantee is the composed
theorem (I2).

### Family C — Balances & settlement (zero-sum, everyone squares) ✅ verified

```ts
// Net balance per person = paid − owed; the netting step invents no money.
//@ requires sumTo(paid, paid.length) === sumTo(owed, owed.length)
//@ ensures \result.length === paid.length
//@ ensures forall(k, ... ==> \result[k] === paid[k] - owed[k])
//@ ensures sumTo(\result, \result.length) === 0                     // Σ balances === 0
function balances(paid, owed): number[]

// Exact star settlement through a hub (the last person): everyone ends square,
// and because Σ balances === 0 the hub's residual is exactly its own balance.
//@ requires sumTo(balances, balances.length) === 0
//@ ensures \result.length === balances.length
//@ ensures forall(k, ... ==> \result[k] === balances[k])            // every person ends square
//@ ensures sumTo(\result, \result.length) === 0                     // conserving
function settle(balances): number[]

// What the app calls: the same star settlement, but each non-hub transfer is
// ROUNDED to a multiple of G and the hub (payer) absorbs the remainder.
//@ requires balances.length >= 1 && 0 <= hub && hub < balances.length && G >= 1
//@ ensures \result.length === balances.length
//@ ensures forall(p, 0 <= p && p < \result.length && p !== hub ==> \result[p] === roundToG(balances[p], G))
//@ ensures sumTo(\result, \result.length) === 0                     // still nets to zero
function settleRounded(balances, hub, G): number[]
```

`settleRounded`'s contract pins **both** halves: each non-hub `p` pays/receives
the *named* rounded amount `roundToG(balances[p], G)`, and the total still nets to
zero — which together force the hub to absorb exactly the sum of the roundings.
(Pinning the per-person amount, not only `Σ === 0`, is what makes the spec
non-vacuous — an all-zeros vector also conserves.) At `G = 1`, `roundToG` is the
identity, so `settleRounded` coincides with `settle`.

### Family D — Ephemeral op-log conservation (the live-sync safety) ✅ verified

Concurrent edits to a shared tab are modeled as an append-only log of *balanced
ledger entries* — `amount` moved from one account to another. The one property
the sync rests on is that the money survives any replay:

```ts
// One edit: move `amount` from account `from` to account `to`. Balanced, so it
// preserves the running total exactly — the invariant-preservation step.
//@ requires 0 <= from && from < bal.length && 0 <= to && to < bal.length
//@ ensures \result.length === bal.length
//@ ensures sumTo(\result, \result.length) === sumTo(bal, bal.length)
function applyOp(bal, from, to, amount): number[]

// Replay any op log over an empty tab: the books still balance.
//@ ensures \result.length === n
//@ ensures sumTo(\result, n) === 0                          // Σ === 0 for any log, any order
function replay(froms, tos, amounts, n): number[]
```

`applyOp` preserves the running total (balanced entry); `replay` folds a whole
log and proves `Σ === 0` regardless of how many edits or in what order. This is
the load-bearing fact for multi-device editing — *convergence* (that edits
commute) is deliberately left to the serializer and not claimed here.

### The counterexample (the teaching artifact) — EXPECTED FAIL

`src/allocateNaive.ts` is the version written first — floor each share and ship
it — carrying the *same* `Σ === total` claim. LemmaScript **rejects** it: the
floors lose cents, so the parts sum short of the whole
(`allocate(10, [1,1,1])` → `[3,3,3]`, sum 9). It is intentionally **not** in the
verified manifest (`LemmaScript-files.txt`); it exists to be run and watched to
fail. The redistribution loop that fixes it *is* `allocate`.

## 7. Verification approach

- **`//@ backend dafny`, discharged on the real TypeScript.** `lsc` generates
  Dafny from `src/floorShare.ts` and `src/allocate.ts` (manifest:
  `LemmaScript-files.txt`); the same TypeScript runs in the browser. CI
  (`.github/workflows/lemmascript.yml`) regenerates and runs `dafny verify`.
- **Imperative loops with invariants.** The operations are loop-bodied (`method`
  in Dafny), each carrying a `sumTo` invariant and a `decreases` metric; the
  proof support is hand-written lemmas the loops cite.
- **The division is quarantined.** The one division-heavy fact — that the G-floor
  brackets the exact share — lives in `floorShare.ts` and is proved there once.
  `allocate` *imports* `floorShareG`, so LemmaScript emits it as an **opaque
  axiom with that bound lifted onto callers**; `allocate` never unfolds a
  division, which is what keeps it fast.
- **Nonlinear arithmetic via small named lemmas + the standard library.** The
  hand-written `.dfy` support is a handful of one-fact lemmas — seq-induction on
  `sumTo` (`SumToSamePrefix`, `SumToExtend`, `SumToUpdate`), the deficit bound
  (`DeficitBoundG`), and the cancellations (`MulCancelLe`, `StepBoundG`,
  `DeficitCancelG`, `DeficitSplitBounds`, routed through `Std.Arithmetic`). Each
  loop VC just cites them, so it carries no raw nonlinear product.
- **No `//@ assume`, no `//@ havoc`.** Every obligation is discharged; nothing is
  papered over.
- **Honest scope.** Each `ensures` is stated precisely and the trusted edges
  (float display, sync ordering, rates, auth, minimality) are named in §2.

> Two proof-engineering lessons baked into the structure: **(1)** a first attempt
> crammed the nonlinear reasoning *inline* and timed out past 150 s; quarantining
> each fact into its own lemma dropped it to ~5 s with no logic change. **(2)**
> Tracking each party as `result[k] === floorShareG(k)` — an *equality* against
> the opaque axiom — verifies instantly, where the equivalent cross-multiplied
> *inequality* under a quantifier times out. The structure, not the math, is the
> cost.

> A spec-correctness lesson, kept visible in the code: a green proof means "matches
> the spec you wrote," not "matches the spec you wanted." Rounding each *share*
> (passing `G` into `allocate`) is correctly proven — `Σ` conserves, each share is
> fair to within `G` — yet it is the wrong place to round for a bill (an even
> $16/$16 split becomes $17/$15, and a leftover cent can land on someone who
> didn't order). The build rounds only the *settlement* (`settleRounded`, payer
> absorbs) and keeps shares exact. `settle` and `settleRounded` are kept side by
> side so the difference shows up in the *specs*, not just the code.

## 8. Verification status

| Family | Lands | Operations | Status |
|--------|-------|------------|--------|
| **A — allocation kernel** | integer cents; `allocate` (largest-remainder) proving conservation + fairness; the G-floor bracket; the naive counterexample | `floorShareG`, `allocate` | ✅ verified |
| **B — bill model** | items (price + claimers), proportional tax/tip, per-person totals; conservation composes to the grand total; non-claimers pay 0 | `itemShare`, `vectorAdd`, `itemSubtotals`, `billTotals`, `bill` | ✅ verified |
| **C — balances & settlement** | zero-sum net balances; exact + rounded star settlement (payer absorbs), each still netting to zero | `balances`, `settle`, `settleRounded`, `roundToG` | ✅ verified |
| **D — ephemeral op-log** | claims/payments as a balanced ledger log; every reachable tab conserves over any replay | `applyOp`, `replay` | ✅ verified |
| **E — receipt export** | a verified printable summary that re-totals to the bill (projection soundness) | — | not built |

```
check.sh dafny  →  floorShare.ts: 4 verified · allocate.ts: 39 verified · 0 errors
```

Reproduce:

```sh
# verify the core (green)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocate.ts
# watch the naive version get rejected (red)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocateNaive.ts
# run the verified core on a concrete tab, asserting invariants at runtime
npx tsx src/demo.ts
# build the single-file app  →  ui/dist/index.html
cd ui && npm ci && npm run build
```

## 9. Open questions / deferred

- **Receipt export (Family E).** A verified printable receipt that re-totals to
  the bill — projection soundness — is a natural extension of the conservation
  machinery; not yet built.
- **Minimal settlement.** Hub routing is valid and conserving; a fewest-transfers
  matcher (NP-hard in general) could be swapped in behind the same proven
  contract without changing what must hold.
- **Settlement minimality vs. roundness interaction.** The current rounding model
  has one payer (the hub) absorb all rounding; spreading the rounding across
  several payers while keeping `Σ === 0` is a possible refinement.
- **Per-item roundness.** Shares are exact by design (rounding lives at
  settlement); a verified opt-in to round specific items would need its own
  fairness/conservation restatement.
