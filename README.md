# EvenTab — a verified group bill-splitter

> **Split the tab, even — provably to the cent.**

A complete, shipped bill-splitter built on a **Dafny-verified money core**
(`src/allocate.ts`) wrapped in a single-file React app (`ui/`) — full design in
[DESIGN.md](DESIGN.md). The rest of this README walks the verified core stage by
stage; the app (and how it only ever *calls* the proven ops) is at the end.

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
check.sh dafny   →   floorShare: 4 verified · allocate.ts: 39 verified · 0 errors
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
>
> **`settleRounded`** — what the app actually calls: the same star settlement, but
> each non-payer's transfer is **rounded** to the chosen unit and the payer (hub)
> absorbs the remainder. Proven: `net[p] === roundToG(balances[p], G)` for every
> non-hub `p` **and** `Σ net === 0` — the rounded transfers are the *named* rounded
> amounts, and no cent is invented. (Why rounding lives here and not in `allocate`:
> see the spec-bug note below.)

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

## A subtler spec bug: a green proof of the wrong thing

The naive allocator above is the *easy* kind of bug — the verifier **caught** it.
Rounding was the hard kind: every proof stayed green while the spec was quietly
wrong, twice.

**Wrong layer.** v1 rounded each *share* by passing roundness `G` into `allocate`
(and so `itemShare` / `bill`). Those proofs hold — `Σ` conserves, each share is
fair to within `G` — but it is the wrong place to round for a bill: an even
$16 / $16 split becomes **$17 / $15**, and each allocation's sub-`G` remainder
lands on whoever is last in it (often someone who didn't order). Verified, and
wrong. The fix keeps shares **exact** and rounds only the *settlement*, with the
payer absorbing the difference — `settleRounded`.

**Vacuous spec.** `settleRounded`'s first contract was only `Σ net === 0` — which
`[0, 0, …, 0]` also satisfies (settle nothing, conserve perfectly). Conservation
was proven; *that the right rounded amounts actually change hands* was not. The fix
pins it: `net[p] === roundToG(balances[p], G)` for every non-payer, which together
with `Σ = 0` forces the payer's absorption too.

The lesson the workshop keeps returning to: a green check means "matches the spec
you **wrote**," never "matches the spec you **wanted**." `settle` and `settleRounded`
are kept side by side (with the historical note above them in `allocate.ts`) so the
difference shows up in the *specs*, not just the code.

## Run it

```sh
# verify the kernel (green)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocate.ts

# watch the naive version get rejected (red)
npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocateNaive.ts
```

## What's next

The verified **money core is complete** (Stages 0–3: allocate, the bill,
settlement, the op-log) **and the app is shipped** — a single-file React UI on the
verified core (see below), browser-tested headless and deployed to GitHub Pages.
The one optional extension left is **Stage 4**, a verified receipt export
(DESIGN §7): a printable summary that re-totals to the bill (projection soundness).

## Layout

```
src/floorShare.ts      VERIFIED — the G-floor + its bracketing bounds (the only div proof).
src/allocate.ts        VERIFIED core — kernel (allocate, roundness G) + Stage 1 bill model
                       (itemShare, itemSubtotals, billTotals, bill) + Stage 2
                       (balances, settle, settleRounded, roundToG) + Stage 3 op-log (applyOp, replay).
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
- `balances` / `settleRounded` run only once the tab is fully paid (`Σ paid === grand`), so
  the `Σ net === 0` guarantee is always in-contract — until then the UI shows what is
  still owed instead of a settlement.

Every figure on screen — per-person shares, the tax/tip split, the star settlement —
comes from `src/allocate.ts`. Shares are computed to the **exact cent**, so an even split
stays even. The rounding control applies only to the **settlement**: pick $1 or $5 and
each non-payer's transfer rounds to that unit while the **payer absorbs the difference** —
`settleRounded` proves it still nets to zero. State persists to `localStorage` and to a
shareable URL hash; no account, no server.

Browser-tested headless (Playwright + chromium) against the live `dist/index.html`:
24/24 assertions — values, the conservation/settlement badges, the rounding demo, and
the precondition gate.

### Deploy

`.github/workflows/deploy.yml` builds `ui/` and publishes `ui/dist` to GitHub Pages on
push to `main` (enable Pages → "GitHub Actions" in the repo settings).
