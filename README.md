# EvenTab — verified allocation kernel (Stage 0 spike)

> **Split the tab, even — provably to the cent.**

This is the **Stage 0 spike** for EvenTab (full design in [DESIGN.md](DESIGN.md)).
Its one job: confirm the money kernel's proof comes out *clean and followable*
— before building the app around it.

## What's verified

`src/allocate.ts` — `allocate(total, weights)` splits an integer `total` (in
**cents**) across weighted parties by **largest-remainder** (Hamilton
apportionment). Two theorems, proven for **every** input:

> **Conservation** — `Σ result === total`. Not a cent created or lost.
>
> **Fairness** — `floorShare(k) ≤ result[k] ≤ floorShare(k) + 1`. Everyone gets
> their exact fair share rounded down, plus at most one redistributed cent —
> i.e. within a cent of fair. No one is silently overcharged.

Conservation is the load-bearing one; fairness is its companion. The proof keeps
the algorithm readable — two short loops that each just **cite small, named
lemmas**: prefix-sum facts, the floor/remainder bounds, and a pair of
arithmetic-cancellation lemmas from the Dafny standard library. All the
nonlinear and division reasoning is *quarantined* inside those lemmas, so the
method's own verification stays linear and fast.

```
dafny verify src/allocate.dfy --standard-libraries   →   17 verified, 0 errors  (~5s)
```

> A proof-engineering note worth keeping: the first attempt crammed the
> nonlinear bounds and cancellations *inline* and **timed out past 150 s**.
> Lifting each into its own lemma dropped it to ~5 s with no logic change — the
> structure, not the math, was the cost. (That lesson is itself workshop-worthy.)

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

- **Roundness `G`** (DESIGN §3.2) — let amounts round to whole dollars or the
  nearest $5 across `G ∈ {1¢, $1, $5}` while **conservation stays exact** and
  fairness stays within `G`. Conservation is never traded for roundness; the
  sub-`G` remainder lands on one designated party. The clean `≤ G` bound needs a
  G-granular floor and a residual absorber — a real increment on top of this
  `G = 1` (cent) kernel.
- Then **Stages 1–4** — bill model, balances & settlement, ephemeral op-log —
  each composing on `allocate` (DESIGN §7).

## Layout

```
src/allocate.ts        VERIFIED core — allocate (largest-remainder). No floats, no I/O.
src/allocate.dfy       generated + hand-written lemmas (sumTo, floor bounds, cancellation)
src/allocateNaive.ts   v0 counterexample (EXPECTED TO FAIL) — the vanished cent
```
