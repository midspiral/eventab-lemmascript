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
check.sh dafny   →   floorShare: 4 verified · allocate.ts: 35 verified · 0 errors  (~7s)
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

## Stage 3 — the ephemeral op-log (what makes the live sync safe)

A shared tab is edited from several phones at once. The Durable Object serializes
the edits into an append-only log and replays it. We model each edit as a
balanced ledger entry and prove the one thing the sync rests on:

> **`applyOp`** — move `amount` between two accounts (a claim moves a share onto
> a person, a payment moves it off). Proven: it leaves the running total
> **unchanged** — the invariant-preservation step.
>
> **`replay`** — fold any op log over an empty tab. Proven: **`Σ === 0`**, for
> however many edits, **in whatever order** the devices produced them.

That's the load-bearing fact. We deliberately **don't** verify that edits commute
(*convergence*) — the DO's serialization hands us that for free, and verifying it
would be re-proving the architecture's own guarantee. The money is the part that
isn't free, so the money is the part we prove.

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

The verified **money core is complete** — Stages 0–3 cover allocate, the bill,
settlement, and the op-log. What remains is the app around it:

- **Stage 4** — a verified receipt export (DESIGN §7): a printable summary that
  re-totals to the bill (projection soundness).
- **The shell** — wrap the core in a thin React UI (it can only *call* proven
  operations, never re-implement them) on the Cloudflare Durable Object backend,
  and run it browser-first end to end.

## Layout

```
src/floorShare.ts      VERIFIED — the G-floor + its bracketing bounds (the only div proof).
src/allocate.ts        VERIFIED core — kernel (allocate, roundness G) + Stage 1 bill model
                       (itemShare, itemSubtotals, billTotals, bill) + Stage 2
                       (balances, settle) + Stage 3 op-log (applyOp, replay).
                       No floats, no I/O.
src/*.dfy              generated + hand-written lemmas (sumTo, deficit bound, cancellation)
src/allocateNaive.ts   v0 counterexample (EXPECTED TO FAIL) — the vanished cent
FALSE_START.md         reject→fix log: encodings that conserved but were still wrong
```

## The app — a single-file verified bill-splitter

`ui/` is a React + Vite app that runs the verified core directly in the browser and
bundles to ONE self-contained `index.html` (works on GitHub Pages and over `file://`).
Build it with `cd ui && npm ci && npm run build` → `ui/dist/index.html`.

The shell is **untrusted**: it only ever calls the proven ops with inputs that satisfy
their preconditions, and it *gates* on those preconditions rather than calling out of
contract —

- `bill` runs only once there is at least one priced, claimed item (`Σ prices ≥ 1`);
- `balances` / `settle` run only once the tab is fully paid (`Σ paid === grand`), so the
  `Σ balances === 0` guarantee is always in-contract — until then the UI shows what is
  still owed instead of a settlement.

Every figure on screen — per-person shares, the tax/tip split, the star settlement —
comes from `src/allocate.ts`. The verified rounding is on display: switch *round shares*
to $1 or $5 and the per-line shares snap to the unit while the total still sums to the
exact tab (conservation holds for every `G`, with one share absorbing the sub-`G`
remainder). State persists to `localStorage` and to a shareable URL hash; no account,
no server.

Browser-tested headless (Playwright + chromium) against the live `dist/index.html`:
17/17 assertions — values, the conservation/settlement badges, the rounding demo, and
the precondition gate.

### Deploy

`.github/workflows/deploy.yml` builds `ui/` and publishes `ui/dist` to GitHub Pages on
push to `main` (enable Pages → "GitHub Actions" in the repo settings).
