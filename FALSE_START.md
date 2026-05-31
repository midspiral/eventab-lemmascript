# False starts

Approaches that *looked* right — type-checked, often even conserved — but were
wrong. These reject→fix loops are what make EvenTab a teaching artifact: the
lesson isn't "we were careful," it's **"the obvious encoding is wrong, and
something catches it."**

---

## 1. Item-split with zero weights — the silent overcharge

**The instinct.** Split each item by calling the kernel over the *whole table*,
giving people who didn't claim it a weight of 0:

```ts
allocate(item.price, [1, 1, 0, 1], G)   // person 2 didn't order this dish
```

It type-checks. It **conserves** — `Σ result === price`, every cent assigned.
Looks done.

**Why it's wrong.** `allocate` redistributes its leftover cents to the *first L
parties by index* (largest-remainder's tie-break), and nothing stops a leftover
cent from landing on a **weight-0 non-claimer**. So person 2, who didn't order
the dish, can be charged for it.

The kernel's own **fairness** bound is what exposes it:
`result[k] ≤ floorShareG(k) + G`, and `floorShareG(non-claimer) = 0`, so a
non-claimer is bounded only by `[0, G]` — *up to G*, not 0. Negligible at 1¢
roundness; **a whole $5 at nearest-$5 roundness.** A silent, real overcharge.

**The fix.** Allocate over the *claimers only*, then **scatter** the shares back
into the n-person vector — non-claimers are never in the allocation, so they get
exactly 0:

```ts
const shares = allocate(item.price, claimerWeights, G); // among claimers
// scatter: person claimers[j] += shares[j];  everyone else stays 0
```

Conservation still holds (`Σ scattered === Σ shares === price`), now *with*
non-claimers at 0. This is what Stage 1's `itemShare` does.

**The lesson.** *Conserves ≠ correct.* The wrong encoding passed the headline
theorem and was still a bug; it took the **companion** property (per-element
fairness) to surface it. Verify the property that would actually hurt if it
broke — not just the one that's easy to state.

---

## 2. The naive round (v0) — the vanished cent

`weights.map(w => Math.round(total*w/W))` rounds each share independently; the
parts don't sum to `total`, so a cent — or, at $1 roundness, a whole dollar —
**vanishes**. No unit test you'd likely write catches it; the conservation
`ensures` rejects it instantly. The fix is the redistribution loop that *is*
`allocate` (largest-remainder). The artifact lives in `src/allocateNaive.ts`
(EXPECTED-FAIL, deliberately not in the manifest).

---

## Implementation false starts (proof-engineering, not design)

These didn't change *what* we proved, only *how* — but they cost real time, so
they're worth remembering.

- **Inline nonlinear reasoning timed out.** The first `allocate` proof crammed
  the division bounds and cancellations inline and **timed out past 150 s**.
  Quarantining each fact into its own small lemma dropped it to ~5 s with *no
  logic change*. The structure, not the math, was the cost.

- **`{:opaque}` ≠ `{:axiom}` under a quantifier.** To hide the G-floor's costly
  division-by-a-product, a `//@ opaque` LemmaScript annotation was prototyped —
  clean and single-file. But under a per-element `forall`, `{:opaque}`'s *hidden
  body* creates quantifier-instantiation pressure and the proof stalls, where the
  cross-file `{:axiom}` (no body at all) stays fast. Stashed; the kernel keeps
  the cross-file extern (`src/floorShare.ts`).
