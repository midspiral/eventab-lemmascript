# EvenTab — verified allocation kernel (Stage 0 spike)

> **Split the tab, even — provably to the cent.**

This is the **Stage 0 spike** for EvenTab (full design in [DESIGN.md](DESIGN.md)).
Its one job: confirm the money kernel's proof comes out *clean and followable*
— before building the app around it.

## What's verified

`src/allocate.ts` — `allocate(total, weights)` splits an integer `total` (in
**cents**) across weighted parties by **largest-remainder** (Hamilton
apportionment). The headline theorem, proven for **every** input:

> **Conservation** — `Σ result === total`. Not a cent created or lost, for any
> weights and any total.

The entire proof burden is **two short `sumTo` lemmas** (append leaves a prefix
sum unchanged; bumping one entry by +1 raises the sum by exactly 1),
hand-written in `src/allocate.dfy`. Dafny discharges the rest — the
non-negativity and the `placed <= total` floor bound — on its own.

```
dafny verify src/allocate.dfy   →   10 verified, 0 errors
```

The algorithm stays readable: two loops, each citing one lemma. That clean,
followable proof (not an SMT one-liner, not an unreadable induction) is the
green light the spike was looking for.

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

- **Fairness + roundness `G`** (DESIGN §3) — bound each party within one
  roundness unit of its exact fair share, across `G ∈ {1¢, $1, $5}`. This is a
  genuine step up from conservation: it needs the `leftover < n` upper bound and
  per-element tracking through both passes, and its honest statement is
  cross-multiplied (`|result[k]·W − total·wₖ| ≤ G`), which reads less cleanly
  than `Σ === total`. How much of that to carry is a real workshop design choice.
- Then **Stages 1–4** — bill model, balances & settlement, ephemeral op-log —
  each composing on `allocate` (DESIGN §7).

## Layout

```
src/allocate.ts        VERIFIED core — allocate (largest-remainder). No floats, no I/O.
src/allocate.dfy       generated + 2 hand-written sumTo lemmas (the whole proof)
src/allocateNaive.ts   v0 counterexample (EXPECTED TO FAIL) — the vanished cent
```
