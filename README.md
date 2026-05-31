# EvenTab — verified allocation kernel (Stage 0 spike)

> **Split the tab, even — provably to the cent.**

This is the **Stage 0 spike** for EvenTab (full design in [DESIGN.md](DESIGN.md)).
Its one job: confirm the money kernel's proof comes out *clean and followable*
— before building the app around it.

## What's verified

`src/allocate.ts` — `allocate(total, weights, G)` splits an integer `total` (in
**cents**) across weighted parties by **largest-remainder** (Hamilton
apportionment), at a chosen **roundness** `G` (G = 1 cent, 100 = $1, 500 =
nearest $5). Two theorems, proven for **every** input and **every** `G ≥ 1`:

> **Conservation** — `Σ result === total`. Exact, to the cent — *never* traded
> away for roundness.
>
> **Fairness** — `floorShareG(k) ≤ result[k] ≤ floorShareG(k) + G`. Everyone
> gets their fair share rounded *down to a multiple of G*, plus at most one
> roundness unit — i.e. within `G` of fair. No one is silently overcharged.

So you can split a $237.46 bill five ways at whole-dollar roundness and the
dollar amounts still sum to exactly $237.46 — the unavoidable sub-dollar
remainder lands on one named party, never vanishes. Conservation is the
load-bearing theorem; fairness is its companion.

The proof keeps the algorithm readable — three short loops (G-floor each share,
hand whole-G chunks back to those rounded down, drop the remainder) that each
just **cite small, named lemmas**. Two techniques keep it fast *and* honest:

- **The division is quarantined.** The one division-heavy fact — that the
  G-floor brackets the exact share — lives in `floorShare.ts` and is proved
  there once. `allocate` *imports* `floorShareG`, so LemmaScript hands it over
  as an **opaque axiom with that bound lifted onto callers** (SPEC §2.5.2);
  `allocate` never unfolds a division.
- The arithmetic cancellations go through the Dafny standard library.

```
check.sh dafny   →   floorShare: 4 verified · allocate.ts: 31 verified · 0 errors  (~7s)
```
(`allocate.ts` now holds the kernel **and** the Stage 1 bill model below.)

> Two proof-engineering lessons worth keeping. **(1)** A first attempt crammed
> the nonlinear reasoning *inline* and **timed out past 150 s**; quarantining
> each fact into its own lemma dropped it to ~5 s with no logic change.
> **(2)** Tracking each party as `result[k] == floorShareG(k)` — an *equality*
> against the opaque axiom — verifies instantly, whereas the equivalent
> cross-multiplied *inequality* (a product under a quantifier) times out. The
> structure, not the math, is the cost.

## Stage 1 — the bill model (conservation *composes*)

On top of the kernel, the whole bill composes — **leaves to root**, the property
you can't check by hand on a $237.46 five-way split with 18% tip:

> **`bill`** — `Σ person totals === Σ item prices + tax + tip` (the **grand
> total**), exactly, for any items, any claim pattern, any roundness G.

It's built from three proven pieces:

> **`itemShare`** — split one item's price across the people who **claimed** it.
> Proven: `Σ === price` **and** every non-claimer gets exactly `0`. That second
> half fixes a real trap (see [FALSE_START.md](FALSE_START.md) §1): the "obvious"
> encoding — `allocate` over the whole table with weight 0 for non-claimers —
> *conserves but overcharges*, because the leftover-cent redistribution can land
> on someone who didn't order. So we allocate over the claimers only and
> **scatter** the shares home.
>
> **`itemSubtotals`** — roll those per-item vectors up into per-person subtotals.
> Proven: `Σ subtotals === Σ item prices` (the sum-swap — nothing leaks in the
> roll-up), via `vectorAdd`'s linearity and an accumulation invariant.
>
> **`billTotals`** — split tax and tip across the table proportional to subtotals.
> Proven: `Σ person totals === Σ subtotals + tax + tip`.

Each step just composes the one below it through its `ensures` — no step
re-derives conservation, it inherits it. That inheritance *is* the lesson: prove
the leaf once, and the whole tree is sound.

## Stage 2 — balances & settlement

Once everyone has a total, who actually pays whom:

> **`balances`** — net what each person paid against what they owe. Proven:
> `Σ balances === 0` (a redistribution, not a faucet — no money appears at the
> netting step).
>
> **`settle`** — the payments that square everyone up, routed through one **hub**.
> Proven: every person ends square (`net[p] === balances[p]`) **and** the books
> still sum to zero (`Σ net === 0`). The neat part: because `Σ balances === 0`,
> the hub's leftover is *exactly* its own balance — so it settles with no special
> transfer. Valid and conserving; routing through one hub isn't *minimal* (that's
> NP-hard, DESIGN §5), so the shell can swap in a fancier matcher later — the
> *theorem* it must satisfy is the one proved here.

## The teaching contrast (v0 → v1)

`src/allocateNaive.ts` is the version you write first — floor each share, ship
it — carrying the *same* `Σ === total` claim. LemmaScript **rejects** it:

```
allocateNaive.dfy: Error: a postcondition could not be proved
  ensures (sumTo(res, |res|) == total)
```

`allocate(10, [1, 1, 1])` floors to `[3, 3, 3]` — sum 9, a vanished cent. No
unit test you'd likely write catches it; the verifier does, instantly. The fix
is one more loop (hand the leftover cents back out) — which *is* `allocate`. The
proof obligation is what **drove** the fix. This reject→fix loop is the workshop
spine (DESIGN §3.3, §9).

> `allocateNaive.ts` is intentionally **not** in `LemmaScript-files.txt` — it is
> meant to fail. It is a teaching artifact, not part of the verified core.

## Run it

```sh
# verify the kernel (green)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocate.ts

# watch the naive version get rejected (red)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocateNaive.ts
```

## What's next

- **Stage 3 — the ephemeral op-log** (DESIGN §6) — claims/payments as an
  append-only log; **every reachable tab conserves** (the money invariants hold
  over any replay), which is what makes the live multi-device sync safe.
- **Stage 4** — receipt export (DESIGN §7), and wrapping the verified core in a
  thin UI + the Cloudflare Durable Object backend.

## Layout

```
src/floorShare.ts      VERIFIED — the G-floor + its bracketing bounds (the only div proof).
src/allocate.ts        VERIFIED core — kernel (allocate, roundness G) + Stage 1 bill model
                       (itemShare, itemSubtotals, billTotals, bill) + Stage 2
                       (balances, settle). No floats, no I/O.
src/*.dfy              generated + hand-written lemmas (sumTo, deficit bound, cancellation)
src/allocateNaive.ts   v0 counterexample (EXPECTED TO FAIL) — the vanished cent
FALSE_START.md         reject→fix log: encodings that conserved but were still wrong
```
