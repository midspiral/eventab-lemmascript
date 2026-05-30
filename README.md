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
check.sh dafny   →   floorShare: 4 verified · allocate: 17 verified · 0 errors  (~7s)
```

> Two proof-engineering lessons worth keeping. **(1)** A first attempt crammed
> the nonlinear reasoning *inline* and **timed out past 150 s**; quarantining
> each fact into its own lemma dropped it to ~5 s with no logic change.
> **(2)** Tracking each party as `result[k] == floorShareG(k)` — an *equality*
> against the opaque axiom — verifies instantly, whereas the equivalent
> cross-multiplied *inequality* (a product under a quantifier) times out. The
> structure, not the math, is the cost.

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

- **Stages 1–4** (DESIGN §7) — the bill model (items, proportional tax/tip),
  balances & settlement, and the ephemeral op-log — each composing on
  `allocate`, so conservation propagates from the leaves to the grand total.

## Layout

```
src/floorShare.ts      VERIFIED — the G-floor + its bracketing bounds (the only div proof).
src/allocate.ts        VERIFIED core — allocate (largest-remainder, roundness G). No floats, no I/O.
src/*.dfy              generated + hand-written lemmas (sumTo, deficit bound, cancellation)
src/allocateNaive.ts   v0 counterexample (EXPECTED TO FAIL) — the vanished cent
```
