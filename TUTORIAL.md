# EvenTab — a tutorial on the verified core

This walks through `src/allocate.ts` — the **verified money core** — and how the
React app in `ui/` uses it. It is written to be read top to bottom with no prior
context. The goal is that, by the end, you can look at any function in the core
and answer two questions: *what does each number mean?* and *what is proven about
it?*

The README pitches the project; this is the slow, careful version.

---

## 0. The one mental model you need

**Everything in the core is a vector (array) of integer cents, and an index into
that vector is just a position — `0, 1, 2, …`. The core does not know what a
position *means*. The caller decides.**

That single sentence dissolves almost all the confusion. The verified core never
mentions "people," "Ana," or "the person who ordered the beer." It only ever sees
arrays of integers and the positions inside them. *Meaning* — "position 0 is Ana"
— is assigned entirely by the untrusted shell (`compute()` in `ui/src/App.tsx`)
when it decides which array to pass in.

Two consequences, both important:

- **Money is integer cents.** `$24.00` is `2400`. There are no floats anywhere in
  the core — floats can't be reasoned about exactly, and "the cents add up" is the
  whole point. The UI converts dollars↔cents at its edges (`cents()` / `fmt()`),
  never in the core.
- **The same function gets reused over *different* index spaces.** `allocate` is
  called once where position = *person* and once where position = *claim slot*.
  Same proof, different meaning. This is the source of the "what is an index into
  `weights`?" question — answered in full in §3.

Keep a scratch idea in your head of the four kinds of vector that show up:

| vector shape         | length | position `k` means…            | examples                          |
|----------------------|--------|--------------------------------|-----------------------------------|
| **person-indexed**   | `n`    | person `k` at the table        | `subtotals`, `paid`, `totals`, `balances`, `net` |
| **claim-indexed**    | `c`    | the `k`-th *claim* on an item  | `claimers`, `claimerWeights`, `shares` (inside `itemShare`) |
| **item-indexed**     | `m`    | the `k`-th line item           | `prices`, `itemVectors`           |
| **abstract / slot**  | any    | "party `k`" — no other meaning | `weights`, `result` inside `allocate` |

`allocate` lives entirely in that last row: it is *agnostic*. Whoever calls it
gets to say what a slot is.

---

## 1. What "verified" means here

Each function in `src/allocate.ts` is annotated with `//@` comments —
preconditions (`requires`), postconditions (`ensures`), and loop invariants
(`invariant`). LemmaScript translates the TypeScript + annotations into Dafny and
asks the prover to show that **every** input satisfying the `requires` produces a
result satisfying the `ensures` — for all inputs, not just the ones a test
happens to try.

So when you read:

```ts
//@ ensures sumTo(\result, \result.length) === total
```

that is a *theorem*: "the returned shares sum to exactly `total`, always." Not a
test that passed once — a proof that it cannot fail.

`sumTo(arr, n)` (top of the file) is the helper the specs use to say "the sum of
the first `n` entries." It's defined recursively so the prover can reason about it
inductively; you'll see it in nearly every `ensures`.

The shell that calls all this (`ui/`) is **untrusted**: it is plain TypeScript,
not verified. Its only job is to call the proven functions *with inputs that
satisfy their `requires`*. That boundary is the whole design — see §7.

---

## 2. The leaf proof: `floorShareG` (and why it's a separate file)

`src/floorShare.ts` holds exactly one function:

```ts
// Party k's exact fair share, rounded DOWN to a whole multiple of roundness G:
//   G · ⌊ total·weight / (W·G) ⌋        where W = Σ weights
export function floorShareG(total, weight, W, G): number {
  //@ requires W >= 1 && G >= 1 && total >= 0 && weight >= 0
  //@ ensures \result >= 0
  //@ ensures \result * W <= total * weight                  // never over the exact share
  //@ ensures total * weight <= \result * W + (W * G - 1)    // falls short by < W·G
  return G * Math.floor((total * weight) / (W * G));
}
```

This is the *only* place a division is reasoned about. Division proofs are slow
and finicky, so we quarantine the one hard fact here and prove it once: the
rounded-down share `floorShareG` brackets the exact fair share `total·weight/W`,
expressed cross-multiplied (so it's all integers, no division in the bound).

Because `allocate` **imports** `floorShareG` from another module, LemmaScript
treats it as an **opaque axiom** and lifts those two `ensures` onto every caller.
Meaning: `allocate` gets to *use* "the floor brackets the exact share" as a given,
without ever re-deriving the division. That is what keeps `allocate`'s proof fast
(~5s instead of a 150s+ timeout — see the README's proof-engineering note).

> **You don't need to understand the division proof to understand the rest.**
> Just hold onto its conclusion: `floorShareG(total, weight, W, G)` is each party's
> fair share, rounded down to a multiple of `G`, and it's never more than `G` short
> of the exact share.

---

## 3. The heart: `allocate(total, weights, G)`

This is the function the README is named after, and the one that prompted the
"what is the weights array?" question. Here is the precise answer.

```ts
export function allocate(total: number, weights: number[], G: number): number[]
```

- **`total`** — a pot of money in cents to hand out (e.g. a $9.00 beer = `900`).
- **`weights`** — *a parameter you pass in.* It is **not** a fixed constant. It's a
  vector of non-negative integers, one per "slot," giving each slot's share of the
  pot. `[1, 1, 1]` = split evenly three ways; `[2, 1, 1]` = the first slot gets
  twice as much.
- **`G`** — the roundness unit in cents (`1` = exact cents, `100` = whole dollars,
  `500` = nearest $5).
- **returns** — a vector the **same length as `weights`**, where `result[k]` is the
  cents handed to slot `k`.

### What is an index into `weights`?

An index `k` is just **a slot position**. `weights[k]` is slot `k`'s weight, and
`result[k]` is the cents that slot `k` receives. They line up *positionally*:

```
weights:  [   1   ,   1   ,   1   ]      slot 0, slot 1, slot 2
result:   [  300  ,  300  ,  300  ]      ← allocate(900, [1,1,1], 1)
              ↑        ↑        ↑
           slot 0   slot 1   slot 2     ($3.00 each — 900 split evenly)
```

`allocate` has **no idea** whether a slot is a person, a claim, or a department.
It only guarantees things about positions. The caller attaches the meaning. (In
§5 you'll see the same `allocate` called once where slot = person and once where
slot = claim — that's the whole trick.)

### The two theorems

For **any** `total ≥ 0`, **any** non-negative `weights` summing to ≥ 1, and **any**
`G ≥ 1`:

```ts
//@ ensures \result.length === weights.length
//@ ensures sumTo(\result, \result.length) === total          // CONSERVATION
//@ ensures floorShareG(...) <= \result[k]                     // FAIRNESS (lower)
//@ ensures \result[k] <= floorShareG(...) + G                 // FAIRNESS (upper)
```

- **Conservation** — the shares sum to *exactly* `total`. Not "about" `total`.
  Exactly. No cent is created or lost, ever.
- **Fairness** — each slot's share is its fair share rounded down to a multiple of
  `G`, plus *at most one* roundness unit `G`. Nobody is silently overcharged.

### How it works (three loops, matching the proof)

```ts
const W = sumTo(weights, n);          // total weight

// Pass 1: floor each slot's share to a multiple of G.
for (i in 0..n) result[i] = floorShareG(total, weights[i], W, G);
// The floors under-shoot the pot by some deficit D, where 0 ≤ D < n·G.

const D = total - placed;             // leftover cents
const L = Math.floor(D / G);          // how many whole-G chunks are left
const rem = D - L * G;                // the final sub-G remainder

// Pass 2: hand a whole +G back to the first L slots.
for (j in 0..L) result[j] += G;

// Pass 3: the last sub-G remainder lands on the last slot.
result[n - 1] += rem;
```

This is **largest-remainder (Hamilton) apportionment**: floor everyone, then give
the leftover units back one at a time. The naive version that *skips* passes 2–3
is `src/allocateNaive.ts` — it loses the leftover cents, and LemmaScript **rejects
it** for failing conservation. That reject→fix is the teaching moment: the proof
obligation is what *forces* the two extra loops.

> Worked example: `allocate(900, [1, 1], 1)`. `W = 2`. Pass 1 floors each to
> `⌊900/2⌋ = 450`, placed `= 900`, so `D = 0` — already exact, no leftover.
> Result `[450, 450]`. Now `allocate(10, [1, 1, 1], 1)`: floors `⌊10/3⌋ = 3` each,
> placed `= 9`, `D = 1`. Pass 2 hands `+1` to slot 0. Result `[4, 3, 3]`, sum `10`.
> The naive `[3, 3, 3]` would have sum `9` — a vanished cent the prover catches.

---

## 4. The composition tree (Stage 1: the whole bill)

Now the payoff: the bill is built *out of* `allocate`, and each layer **inherits**
conservation from the layer below through its `ensures`. No layer re-proves "the
cents add up" — it composes.

```
          bill                         Σ totals === Σ prices + tax + tip   (grand total)
         /    \
itemSubtotals  billTotals              split tax & tip ∝ subtotals
     |              |
  vectorAdd      allocate              ← the leaf
     |
  itemShare                            split one item ∝ claims, scatter home
     |
  allocate                             ← the leaf again
```

### `itemShare(price, claimers, claimerWeights, n, G)` — the scatter (this is where the index re-mapping happens)

This splits one item's `price` across the people who **claimed** it, and returns
an **`n`-person vector** (length `n`, the whole table). It is the one place two
different index spaces meet, so read carefully:

- **`claimers`** is *claim-indexed* (length `c`). `claimers[j]` is the **person
  index** that claim `j` belongs to. E.g. for a beer ordered by Ana(0) and Ben(1),
  `claimers = [0, 1]`.
- **`claimerWeights`** is also claim-indexed (same length `c`). `claimerWeights[j]`
  is claim `j`'s weight. `[1, 1]` = even split.
- It calls `allocate(price, claimerWeights, G)` → `shares`, a **claim-indexed**
  vector: `shares[j]` is the cents for claim `j`.
- Then it **scatters**: `result[claimers[j]] += shares[j]`. Claim `j`'s money is
  carried home to person `claimers[j]`.

So inside `itemShare`, an index into the array passed to `allocate` is a **claim
slot**, *not* a person. The scatter step is what maps claim slot `j` → person
`claimers[j]`.

**Why bother?** The "obvious" alternative — call `allocate` over the whole table
with weight `0` for non-claimers — *conserves but overcharges*. `allocate`'s
leftover-cent passes (§3, passes 2–3) can drop a stray cent on slot `0`, and if
slot 0 is a non-claimer, they get charged for an item they never ordered.
Allocating over the **claimers only** makes that impossible. The proof states it
outright:

```ts
//@ ensures sumTo(\result, n) === price                              // conserves
//@ ensures forall(q, ... && !claimers.includes(q) ==> \result[q] === 0)  // non-claimers pay 0
```

(See `FALSE_START.md §1` — this trap was hit for real before the scatter fix.)

> Worked example, the demo beer: `itemShare(900, [0,1], [1,1], 3, 1)`.
> `allocate(900, [1,1], 1) = [450, 450]` (claim-indexed). Scatter: person
> `claimers[0]=0` gets `450`, person `claimers[1]=1` gets `450`. Result over the
> 3-person table: `[450, 450, 0]` — Ana $4.50, Ben $4.50, **Cy $0** (didn't order).

### `itemSubtotals(itemVectors, prices, n)` — roll items up

Each item gives one `n`-person vector (from `itemShare`). `itemSubtotals` adds
them element-wise (via `vectorAdd`, whose proof is just "the sum of the sum is the
sum of the sums" — linearity). Proven: `Σ subtotals === Σ prices`. Now every
person has one subtotal: what their food cost.

### `billTotals(subtotals, tax, tip, G)` — split tax & tip

Here `allocate` is called the *other* way — with `subtotals` as the weights, so a
**slot is a person**: tax and tip are split across the table in proportion to what
each person's food cost.

```ts
const taxShares = allocate(tax, subtotals, G);   // slot k = person k
const tipShares = allocate(tip, subtotals, G);
totals[p] = subtotals[p] + taxShares[p] + tipShares[p];
```

Proven: `Σ totals === Σ subtotals + tax + tip`.

### `bill(...)` — the top

`bill` just chains the two: `itemSubtotals` then `billTotals`. Its theorem is the
one you cannot check by hand on a messy five-way split:

```ts
//@ ensures sumTo(\result, n) === sumTo(prices, ...) + tax + tip
```

**`Σ person totals === Σ item prices + tax + tip`**, for any items, any claim
pattern, any roundness. The grand total, to the cent.

---

## 5. The same `allocate`, two index spaces — side by side

This is the crux of the original confusion, so here it is explicitly:

| call site            | `allocate(..., weights, ...)` with weights = | a slot means…       | how meaning is attached |
|----------------------|----------------------------------------------|---------------------|-------------------------|
| `billTotals`         | `subtotals` (length `n`)                     | **a person**        | used positionally — slot `k` *is* person `k` |
| `itemShare`          | `claimerWeights` (length `c`)                | **a claim**         | re-mapped by the scatter: `result[claimers[j]] += shares[j]` |

`allocate` is identical in both. Its proof never changes. What changes is the
caller's interpretation of the positions — and `itemShare` does real work
(scatter) to translate claim-positions into person-positions, while `billTotals`
needs no translation because its slots already are people.

---

## 6. Balances & settlement (Stage 2) — back to person-indexed

Once everyone has a total (what they *owe*) and we know what each *paid*:

- **`balances(paid, owed)`** → `paid[k] - owed[k]` per person. Proven `Σ === 0`:
  positive = owed money back, negative = still owes, and it's a redistribution so
  the books net to zero. (`requires Σ paid === Σ owed` — the tab must be fully
  paid, which is why the shell gates on it.)
- **`settle(balances)`** → routes every settlement through one **hub** (the last
  person). Proven `net[p] === balances[p]` for everyone *and* `Σ net === 0`. The
  neat bit: because `Σ balances === 0`, the hub's leftover is *exactly* its own
  balance, so it squares with no special transfer.
- **`settleRounded(balances, hub, G)`** — **what the app actually calls.** Same
  star settlement, but each non-hub transfer is **rounded** to a multiple of `G`
  and the chosen hub (the person who fronted the bill) **absorbs the leftover**.
  Proven: `net[p] === roundToG(balances[p], G)` for every non-hub `p`, *and*
  `Σ net === 0`. At `G = 1`, `roundToG` is the identity, so `settleRounded`
  collapses to `settle`.

> **Why rounding lives *here* and not in `allocate`** (a spec-bug lesson the
> README tells in full): v1 rounded each *share* by passing `G > 1` into
> `allocate`. The proofs held — but an even $16/$16 split became $17/$15. Verified,
> and *wrong*: rounding at the share layer is the wrong spec. The fix keeps shares
> **exact** (`G = 1` everywhere in `bill`) and rounds only the **settlement**. A
> green proof means "matches the spec you *wrote*," never "the spec you *wanted*."

---

## 7. Stage 3: the op-log (`applyOp`, `replay`)

For multi-device editing: a shared tab is a log of edits, each modeled as a
balanced ledger move.

- **`applyOp(bal, from, to, amount)`** — move `amount` from account `from` to
  account `to`. Proven: the running total is **unchanged**. (Invariant
  preservation — one balanced step.)
- **`replay(froms, tos, amounts, n)`** — fold any log over an empty tab. Proven
  `Σ === 0`, **for any number of edits in any order**.

That `Σ === 0`-over-any-replay is the fact the live sync rests on. We deliberately
do *not* prove that edits commute (convergence) — the serializing backend gives
that for free. We prove the money, because the money is the part that isn't free.

---

## 8. How the shell uses it (`ui/src/App.tsx → compute()`)

The React app is the **untrusted** layer. It does exactly two things with the
core: (a) build inputs that satisfy each function's `requires`, and (b) *gate*
each call behind a check so it's never called out of contract. Here is the real
sequence, lightly trimmed:

```ts
import { itemShare, bill, balances, settleRounded } from "../../src/allocate";

function compute(s: State): Result {
  const n = s.people.length;

  // keep only claimed, positive-price items → each is a valid itemShare call
  const usable = s.items
    .map(it => ({ price: cents(it.price), claimers: it.claims.flatMap((c,i) => c ? [i] : []) }))
    .filter(it => it.price > 0 && it.claimers.length >= 1);
  const prices = usable.map(it => it.price);
  const tax = cents(s.tax), tip = cents(s.tip);
  const grand = sum(prices) + tax + tip;

  // GUARD: bill needs n ≥ 1 and Σ prices ≥ 1. Shares split to EXACT cents (G = 1).
  const hasItems = n >= 1 && sum(prices) >= 1;
  let totals = zeros;
  if (hasItems) {
    const itemVectors = usable.map(it =>
      itemShare(it.price, it.claimers, it.claimers.map(() => 1), n, 1)); // even split, exact
    totals = bill(itemVectors, prices, tax, tip, n, 1);
  }

  const paidV = s.paid.map(cents);
  // GUARD: balances needs Σ paid === Σ owed (=== grand). Only then is settlement in-contract.
  const fullyPaid = hasItems && sum(paidV) === grand;
  let bal = zeros, net = zeros;
  if (fullyPaid) {
    bal = balances(paidV, totals);          // Σ paid === Σ totals === grand ✓
    net = settleRounded(bal, s.hub, s.G);    // round transfers, hub absorbs; Σ net === 0 ✓
  }

  return { hasItems, fullyPaid, totals, bal, net, grand, paidTotal: sum(paidV) };
}
```

Read the guards as *honoring the contracts*:

- `bill` only runs once `Σ prices ≥ 1` — otherwise its `requires` would be
  violated, so the UI shows "add an item" instead of calling it.
- `balances` / `settleRounded` only run once `Σ paid === grand` — until the tab is
  fully paid, the `Σ net === 0` guarantee isn't in-contract, so the UI shows
  what's still owed instead of a settlement.
- Note `itemShare` is always called with `claimers.map(() => 1)` — an even split
  among claimers — and `G = 1`. Rounding is applied *only* at `settleRounded`.

The footer badges in the UI display the proven facts **live**: "shares sum to the
tab: $42.24 = $42.24" and "settlement nets to zero: Σ = $0.00." Those aren't
recomputed claims — they're the postconditions, shown on screen.

---

## 9. End-to-end trace (the demo tab)

People: **Ana (0), Ben (1), Cy (2)**. Items: Pizza $24.00 (all three), Beer $9.00
(Ana & Ben). Tax $3.30, tip $5.94. Ana fronts the whole bill. `G = 1` for shares.

```
itemShare(2400, [0,1,2], [1,1,1], 3, 1)   → [800, 800, 800]    (pizza: $8 each)
itemShare( 900, [0,1],   [1,1],   3, 1)   → [450, 450,   0]    (beer:  Cy pays $0)

itemSubtotals([[800,800,800],[450,450,0]], [2400,900], 3)
                                          → [1250, 1250, 800]   (Σ = 3300 = Σ prices ✓)

billTotals([1250,1250,800], 330, 594, 1):
   taxShares = allocate(330, [1250,1250,800], 1) → [125, 125,  80]   (Σ = 330 ✓)
   tipShares = allocate(594, [1250,1250,800], 1) → [225, 225, 144]   (Σ = 594 ✓)
   totals                                         → [1600, 1600, 1024]
                                          (Σ = 4224 = 3300+330+594 = grand ✓)

balances([4224,0,0], [1600,1600,1024])    → [2624, -1600, -1024]     (Σ = 0 ✓)

settleRounded([2624,-1600,-1024], hub=0, G=1) → [2624, -1600, -1024]
   ⇒ Ben pays Ana $16.00,  Cy pays Ana $10.24
```

Switch settlement rounding to **$1** (`G = 100`): `settleRounded(..., 0, 100)` →
`[2600, -1600, -1000]`. Cy now pays a round **$10.00**, and Ana (the hub) **covers
the $0.24** difference — still `Σ = 0`. Shares stayed exact; only the settlement
rounded.

Run it yourself: `npx tsx src/demo.ts`.

---

## 10. Where to go next

- **Read the core:** `src/allocate.ts` top to bottom — it's ordered exactly like
  this tutorial (leaf → bill → settlement → op-log).
- **Watch a proof fail:** `npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocateNaive.ts`
  — the vanished cent, rejected.
- **Verify the core (green):** `npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocate.ts`
- **The deeper "verified ≠ correct spec" stories:** `README.md` ("A subtler spec
  bug") and `FALSE_START.md`.
- **Design rationale & trade-offs:** `DESIGN.md`.

The one sentence to remember: **the core proves things about positions in vectors
of cents; the shell decides what a position means and only ever calls in-contract.**
