# EvenTab — design & staged proof plan

> **Split the tab, even — provably to the cent.**
>
> An ephemeral, no-login, shareable group bill-splitter whose money math is a
> *theorem*: every cent of the bill is assigned to exactly one person, nobody is
> overcharged beyond the roundness they chose, and the suggested payments settle
> everyone to zero. You can't check a five-way split with tax and tip by hand —
> so the app has to be trustworthy, and verification is what earns the trust.

This doc is the full design and the staged proof plan. EvenTab is also a teaching
artifact: it walks **design → spec → verified core → UI glue → ephemeral backend**,
and every `//@` annotation earns its place by catching a bug you watch get written.

---

## 1. The product

No accounts, ever. You open a tab, share a link, the table splits it.

1. **Open a tab.** Enter the bill (items + prices, or just a total), tax, and tip.
   Optionally pick a **roundness**: exact cents, whole dollars, or nearest $5.
2. **Share the link.** A short code → a Cloudflare Durable Object. No signup.
3. **The group claims.** Each person opens the link and claims their items (or takes
   an equal share). Live, multi-device.
4. **Settle.** EvenTab shows each person's total and the **minimal set of payments**
   to square up ("Ana pays Ben $14, Cy pays Ben $9").
5. **It's ephemeral.** The tab lives in the DO keyed by the code and auto-expires.

Why it's nicer than the incumbents: Splitwise makes everyone create an account for a
single dinner. EvenTab is a link you share and forget — and the numbers are *provably*
right, which is exactly the part a one-off group can't be bothered to double-check.

## 2. The one thing that must never break

> **Conservation.** The sum of what everyone owes equals the bill — exactly, to the
> cent — no matter the items, the tax, the tip, the rounding, or who claimed what.

That's the load-bearing invariant. Two companions make it useful:

- **Fairness (bounded deviation).** Each person's share is within one *roundness unit*
  of their exact fair share. Rounding can round; it can't quietly overcharge.
- **Settlement.** The suggested payments, applied, drive every balance to zero, and
  invent no money along the way.

Why this is the opposite of a decorative proof: the output is **hand-uncheckable**
(nobody verifies a 5-way split of a $237.46 bill with 18% tip), the failure is
**money** (a vanished cent, a silent overcharge, a settlement that doesn't settle),
and **no architecture hands it to you for free** — the whole risk is in the math.

## 3. The verified core — allocation

### 3.1 Money is integer cents. No floats. Ever.

The first money bug is `0.1 + 0.2 !== 0.3`. The core works in **integer cents**; floats
appear only when the UI prints `$2.51`. (Teaching beat #1: the cheapest correctness win
is choosing the right representation.)

### 3.2 The kernel: `allocate`

Everything reduces to one function — **split an integer amount across weighted parties,
losing nothing**:

```ts
//@ requires sum(weights) > 0 && all(weights, w => w >= 0) && total >= 0 && G >= 1
//@ ensures sum(\result) === total                                  // CONSERVATION
//@ ensures forall i: abs(\result[i] - fairShare(total, weights, i)) <= G   // FAIRNESS
//@ ensures forall i: \result[i] >= 0                                // SANITY
function allocate(total: cents, weights: cents[], G: cents): cents[]
```

- `fairShare(total, weights, i) = total · weights[i] / sum(weights)` (the exact, rational
  ideal — a spec-only quantity).
- `G` is the **roundness**: `1` = exact cents, `100` = whole dollars, `500` = nearest $5.

**The method is largest-remainder (Hamilton's apportionment).** Floor each fair share to
a multiple of `G`; this under-distributes by a known remainder; hand the remaining units,
one at a time, to the parties with the largest fractional remainders. Conservation is
*unconditional*; larger `G` buys rounder numbers at the cost of ≤ `G` fairness deviation —
**conservation is never traded for roundness.** (When `total` isn't a multiple of `G`, the
sub-`G` residual lands on one designated party so the sum stays exact; the proof says who.)

### 3.3 The teaching moment (v0 → v1)

- **v0 — the version AI writes.** `weights.map(w => Math.round(total * w / W))`. LemmaScript
  **rejects** it: the rounded parts don't sum to `total` — a cent (or, at `$1` roundness, a
  *dollar*) vanishes. No test caught it; the proof did.
- **v1 — largest-remainder.** LemmaScript **proves** `sum === total` and the deviation bound.
  The obligation *drove* the fix.

This reject→fix loop is the spine of the whole workshop. It is also the one thing to spike
first (see §9).

## 4. The bill model

A bill is items, tax, and tip — all built on `allocate`, so conservation **composes**.

- **Item split.** Each item's price is `allocate`d across the people who claimed it
  (weights all `1`). Per item, every cent is assigned.
- **Person subtotal.** Sum a person's per-item amounts. ∑ subtotals === ∑ item prices.
- **Tax & tip.** `allocate`d across people *proportionally to their subtotals*. This is the
  genuinely subtle part — proportional, integer-cent, conserving — and where naive
  `round(tax * mine / subtotal)` fails hardest.
- **Person total** = subtotal + tax share + tip share.

**The composed theorem:** `∑ person totals === ∑ item prices + tax + tip` (the grand total),
exactly, for any claim pattern and any roundness. Conservation at the leaves ⇒ conservation
at the root.

## 5. Balances & settlement

Some people front money (paid the waiter); everyone owes their total.

- **Net balance** per person = paid − owed. **`∑ balances === 0`** always (it's a
  redistribution, not a faucet).
- **`settle(balances)`** returns a list of transfers `(from, to, amount)` such that:
  - applying them drives **every** balance to `0` (correctness), and
  - **`∑ transfers` conserves** — settlement invents no money.

The settlement proof is the second meaty one: a greedy match of debtors to creditors,
proved to terminate with everyone at zero. (Minimal *number* of transfers is NP-hard; we
verify *valid and conserving*, and note minimality is best-effort — an honest line, not a
silent cap.)

## 6. The ephemeral group — and the trap we refuse

Multiple devices edit one shared tab, so we need a backend. The Durable Object serializes
edits and replays an append-only log of claims/expenses — which means concurrent "I had the
salad" updates **converge for free.**

**We do not verify that.** Convergence here is plumbing, handed to us by serialization (this
is exactly the hollow place a previous case study mistook for a result). EvenTab points its
proofs *only at the money*:

> **Every reachable tab conserves.** For any append-only log of claims/payments replayed
> over an empty tab, the conservation, fairness, and `∑ balances === 0` invariants hold.

That's load-bearing (it's money, over *every* state a shared tab can reach) and not free
from the architecture (serialization orders the edits; it does nothing to guarantee the
arithmetic). Sync is plumbing; conservation is the theorem.

## 7. Staged proof plan

Verified core first, built as a difficulty ramp that doubles as the teaching ramp.

| Stage | Lands | Family | Status |
|---|---|---|---|
| **0 — allocation kernel** | cents (no floats); `allocate` (largest-remainder) proving **conservation + fairness + non-negativity**; the v0 naive-`round` counterexample | A | _planned_ |
| **1 — bill model** | items (price + claimers), proportional tax/tip; per-person totals; **conservation composes** (∑ person === grand total) | B | _planned_ |
| **2 — balances & settlement** | net balances (`∑ === 0`); `settle` → transfers that zero everyone, conserving | C | _planned_ |
| **3 — ephemeral op log** | claims/payments as an append log; **every reachable tab conserves** (money over any replay — *not* convergence) | D | _planned_ |
| **4 — receipt export (optional)** | a verified printable summary: the receipt re-totals to the bill; projection soundness | E | _deferred_ |

Each stage: append TS fn → `lsc regen` → fill the `_ensures` proofs → `dafny verify` → keep
`.ts`/`.dfy`/`.dfy.gen` consistent. Stage 0's `allocate` is the heart; if its proof is clean
and *followable*, the rest composes on top of it.

## 8. Architecture

```
  src/core.ts        VERIFIED. allocate, bill, balances, settle, op-log. No floats, no I/O.
       │  (the only thing that touches money; proven in LemmaScript → Dafny)
  src/store.ts       glue: {getSnapshot, subscribe, dispatch}; lowers UI actions → verified ops
  src/App.tsx        thin React shell — can only CALL proven operations, never re-implement them
  worker/            Cloudflare Worker + EvenTabDO (one DO per code; serialized op log; auto-expire)
```

The architecture *is* the lesson: a **trusted verified core** plus an **untrusted shell**.
The UI can't violate conservation because it can't do arithmetic — it can only invoke
`allocate`/`settle`. AI writes the shell fast; the core stays a theorem.

## 9. The pedagogical arc (the workshop)

The case study is the talk. The sequence:

1. **Find the invariant** from the problem ("money is conserved").
2. **Formalize it** as `//@ ensures sum === total`.
3. **Watch it reject** the naive `round` split — the vanished cent/dollar. *(the aha)*
4. **Let the proof drive the fix** — largest-remainder.
5. **Grow the core** — items, tax/tip, balances, settle — conservation *composing*.
6. **Wrap it in a UI** that can only call proven operations (trusted core / thin shell).
7. **Make it ephemeral & shared** — the DO; AI builds the shell while the core stays sound.

Throughout, the AI + verification thesis: AI writes plausible-but-wrong money code; the
proof is the safety net that tests miss.

**First action — the spike:** Stage 0 only. Show LemmaScript rejecting `round(·)` and
accepting largest-remainder, proving conservation + fairness across `G ∈ {1¢, $1, $5}`.
If that proof is clean and followable (not an SMT one-liner, not an unreadable induction),
we've found the spine and we build the app around it.

## 10. What is *not* verified (the trust boundary, stated plainly)

- **Floats in the UI.** The core is integer cents; printing `$2.51` is display, unproven.
- **Sync / convergence.** The DO serializes edits (convergence is free); we verify the
  money over the resulting log, not the ordering.
- **Receipt OCR** (if we add photo capture): trusted input.
- **Tax/tip *rates*** are inputs; we prove the *allocation* of whatever tax/tip cents result,
  not that the rate is correct.
- **No auth.** Tabs are unlisted, link-shared via an unguessable code, and expire. Anyone
  with the link can edit — by design, like a paper tab on the table.
- **Minimal settlement** is best-effort (valid + conserving is proven; fewest-transfers is
  not). No silent cap — we say so.

No "verified end-to-end" claim. The trustworthy artifact is the **money**: conservation,
fairness, and settlement — the part you can't check and can't afford to get wrong.
