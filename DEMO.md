# Who Decides When the AI Is Done?

A 20-minute talk about the future of programming, built around EvenTab.

**Audience:** programmers who understand functions and tests; no formal-methods background required.

**Thesis:** As generating code gets easier, programming increasingly involves stating what must hold, getting machine-checked evidence, and deciding whether those guarantees capture what we actually wanted.

The story has two failures: an implementation that violates its contract, then a contract that permits behavior the user never wanted. The second failure is the turning point. Keep the audience with one application throughout.

## The talk at a glance

| Time | Slide | Show | Point to make |
|---|---|---|---|
| 0–2 min | Build me a bill splitter | The working app with three diners | A small app still contains consequential decisions. |
| 2–4 min | The missing cent | `10 → [3, 3, 3]` | Plausible code can violate a simple requirement. |
| 4–7 min | Make the promise executable | Conservation contract, failed check, repaired allocator | An implementation must satisfy a requirement held fixed during repair. |
| 7–10 min | The books balance. The bill is wrong. | `101, [0, 1, 1] → [1, 50, 50]` | A passing proof can leave a product requirement unstated. |
| 10–13 min | Programming the requirement | Non-claimers owe zero; corrected result | Refining the contract changes what counts as a solution. |
| 13–15 min | Small guarantees compose | Items → subtotals → whole bill | Local contracts support a larger guarantee. |
| 15–18 min | A different AI coding loop | Intent → contract → code/proof → checker → review | Agents can propose; a checker supplies evidence; people judge intent. |
| 18–20 min | Who decides when it is done? | Both failures side by side | Correctness depends on the promise and the evidence. |

## Rehearsal and setup

Run the commands below from the `eventab-lemmascript` directory. Have Node, the project dependencies, Dafny, and the sibling `../LemmaScript` toolchain ready before presenting. If dependencies are missing, run `npm ci` here and in `ui/`, and follow the sibling toolchain's setup instructions.

Start the app in a separate terminal:

```sh
npm --prefix ui run dev
```

Open the URL printed by Vite. For a prepared offline copy:

```sh
npm --prefix ui run build
```

The build produces the self-contained `ui/dist/index.html`. Prepare a browser window with the demo state; the app restores local storage and shared URL state, so do not rely on a reload to reset it.

Use the default tab:

- Ana, Ben, and Cy share a $24 pizza.
- Ana and Ben share $9 of beer; Cy does not claim it.
- Tax is $3.30 and tip is $5.94: the grand total is $42.24.
- Ana has paid $42.24. Keep settlement rounding at 1¢ for the main talk.

Open these source locations in advance:

- [The intentionally incorrect allocator](src/allocateNaive.ts).
- [`allocate`, `itemShare`, and `bill`](src/allocate.ts).
- [The recorded design false starts](FALSE_START.md).
- [The UI's imports and calls into the core](ui/src/App.tsx).

Rehearse verification separately from the presentation:

```sh
# Expected success: both modules in LemmaScript-files.txt.
npm run verify

# Expected failure: the teaching implementation violates conservation.
node --import tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny src/allocateNaive.ts
```

Save the actual output from a successful rehearsal and from the expected failure. Verification counts and diagnostic formatting can change; the important evidence is which obligation fails and which files pass. The failing example is deliberately excluded from the verified manifest. Do not describe a timeout or tool setup error as a discovered bug.

## 1. Build me a bill splitter — 0:00–2:00

Show the working app for about a minute. Point out the item claims and the grand total. Keep the UI tour short.

Suggested opening:

> “Suppose I ask an AI to build a bill splitter. It gives me a working app. The buttons work, the numbers look plausible, and three people can settle dinner. When should I accept the result?”

Then make the audience's job concrete:

> “We will ask two questions. Does every cent get assigned? And can someone be charged for an item they didn't order?”

Mention that the app imports the same TypeScript core being verified. Introduce LemmaScript only when the first contract appears.

## 2. The missing cent — 2:00–4:00

Show the essential operation in `allocateNaive`:

```ts
Math.floor((total * weights[i]) / W)
```

Explain that amounts are integer cents and `W` is the sum of the weights. Run:

```sh
node --import tsx --input-type=module <<'JS'
import { allocateNaive } from './src/allocateNaive.ts';
const shares = allocateNaive(10, [1, 1, 1]);
console.log({ shares, sum: shares.reduce((a, b) => a + b, 0), total: 10 });
JS
```

Expected values: `shares: [3, 3, 3]`, `sum: 9`, `total: 10`.

> “Each share looks reasonable. Together, they lose a cent.”

A unit test can catch this example. Say so. The next step is to express a property for all modeled inputs satisfying the preconditions.

## 3. Make the promise executable — 4:00–7:00

Show this actual annotation from `allocateNaive`:

```ts
//@ ensures sumTo(\result, \result.length) === total
```

Read it as “the returned shares sum to the original total.” Explain `sumTo` as the sum of an array prefix and `\result` as the return value.

> “LemmaScript reads these comments on ordinary TypeScript and translates the verification problem to Dafny. The checker must establish this promise for every input allowed by the preconditions.”

Show the failed check from rehearsal, or run the expected-failure command above. Point to the conservation postcondition. Supply the concrete `10 → 9` example yourself; do not imply that the tool necessarily prints that counterexample.

Switch to `allocate`. It distributes the leftover cents after computing the floors. Run:

```sh
node --import tsx --input-type=module <<'JS'
import { allocate } from './src/allocate.ts';
console.log(allocate(10, [1, 1, 1], 1));
JS
```

Expected output: `[4, 3, 3]`. The final argument, `G = 1`, means cent granularity.

Show the successful verification of the core from rehearsal. Runtime output illustrates one case; the proof supports the contract across its modeled domain.

> “An agent can try different implementations and proof steps while this requirement stays fixed. We now have a checkable acceptance condition.”

Avoid walking through every loop invariant. One contract and the red-to-green transition are enough.

## 4. The books balance. The bill is wrong. — 7:00–10:00

Keep the successful check visible. Introduce a $1.01 item claimed equally by Ben and Cy. Ana did not order it.

The tempting encoding gives Ana weight zero and allocates over the whole table:

```sh
node --import tsx --input-type=module <<'JS'
import { allocate } from './src/allocate.ts';
console.log(allocate(101, [0, 1, 1], 1));
JS
```

Expected output:

```text
             Ana   Ben   Cy
weights:       0     1    1
shares:        1    50   50    sum = 101 cents
```

Pause before explaining. Ana is charged a cent despite having zero weight.

This call satisfies the allocator's preconditions. Its result also satisfies conservation and the kernel's per-person rounding bound: a zero-weight party may receive between zero and `G`. The allocator redistributes whole-unit leftovers by index, so it can assign one to Ana.

> “The verifier answered the question we asked. We hadn't asked whether someone who ordered nothing could be charged.”

Be explicit that this is a demonstration of a tempting integration mistake, documented in `FALSE_START.md`. The current app uses `itemShare` and avoids this mistake. No existing theorem has been refuted.

## 5. Programming the requirement — 10:00–13:00

Show the two relevant guarantees on `itemShare`:

```ts
//@ ensures sumTo(\result, n) === price
//@ ensures forall(q, 0 <= q && q < n && !claimers.includes(q) ==> \result[q] === 0)
```

Read the second line aloud: “Anyone who did not claim this item owes zero for it.”

Explain the implementation with three boxes:

```text
Claimers only             Allocate their shares        Full table
Ben, Cy                  [51, 50]                     [0, 51, 50]
```

Run the existing implementation:

```sh
node --import tsx --input-type=module <<'JS'
import { itemShare } from './src/allocate.ts';
console.log(itemShare(101, [1, 2], [1, 1], 3, 1));
JS
```

Expected output: `[0, 51, 50]`. Here `[1, 2]` names the claimers, `[1, 1]` gives their weights, and `3` is the table size.

`itemShare` is included in the verified core. It allocates among claimers, then scatters those shares into a full-table vector initialized to zero. Non-claimers never receive an allocation.

> “The consequential programming decision was refining what correct means. Once we stated that requirement, the implementation had to respect it.”

This contract concerns the item's allocation. Do not expand it into a claim that the person owes nothing for other items, tax, or the entire dinner.

## 6. Small guarantees compose — 13:00–15:00

Show this diagram, then the postcondition on `bill`:

```text
Each item's shares sum to its price
                  ↓
Subtotals sum to all item prices
                  ↓
Final amounts sum to item prices + tax + tip
```

```ts
//@ ensures sumTo(\result, \result.length) === sumTo(prices, prices.length) + tax + tip
```

Each function still has preconditions. For example, `bill` requires each input item vector to sum to its corresponding price; `itemShare` provides that guarantee. This is how the parts connect.

> “We can reason about a larger computation through the promises of its parts. Each caller has obligations, and each callee gives guarantees.”

Return briefly to the $42.24 tab. Show that the UI calls these functions. Keep settlement rounding and synchronization for questions.

## 7. A different AI coding loop — 15:00–18:00

Show the proposed workflow:

```text
Human intent
    ↓
Proposed contract ← human review of meaning and omissions
    ↓
Candidate implementation + proof steps
    ↓
Checker feedback → revise implementation/proof → check again
    ↓
Review the guarantee and integrate the result
```

Agents can help propose the contract as well as the implementation and proof. People remain responsible for deciding whether the accepted contract represents the intended behavior.

Connect each failure to this workflow:

- **Missing cent:** preserve the conservation contract; repair the implementation and proof.
- **Non-claimer charged:** revise the accepted contract to include the missing requirement; then repair the integration.

An agent should not silently weaken the contract to get a passing check. Contract changes are changes to the acceptance criteria and deserve explicit review.

If showing an AI session, use a short recording with a fixed prompt such as:

> “Repair this allocator so that the existing conservation postcondition verifies. Preserve its preconditions and postconditions. Add the implementation and proof steps needed, without introducing assumptions to bypass the obligation.”

Review the resulting diff as well as the verification result. Label a prepared session as a staged demonstration unless it is an actual development recording. The repository's failing allocator is a teaching artifact; its presence alone is not evidence of how an AI originally generated the code.

## 8. Who decides when it is done? — 18:00–20:00

Put the two failures side by side:

| Failure | What had to change? | What supplied the evidence? |
|---|---|---|
| A cent disappeared | Implementation and proof | Conservation check, plus the concrete example |
| A non-claimer was charged | The stated requirement and its implementation | Product judgment, then the stronger verified contract |

State the scope in plain language: these proofs concern the modeled money core under its preconditions. They do not establish the correctness of the UI, persistence, all integration code, or arbitrary JavaScript floating-point arithmetic. Integer cents are the model; runtime inputs and intermediate computations must respect the intended numeric domain. Tests and integration checks still have work to do.

Suggested closing:

> “The programmer's question becomes: what have we promised, what evidence supports that promise, and what did we forget to promise?”

## Fallbacks and cuts

- **Verifier is slow:** show the saved rehearsal output and source contract. Clearly label the output as recorded; do not wait on a long proof during the talk.
- **Browser fails:** use a screenshot of the prepared tab, then continue with the terminal examples.
- **AI repair stalls:** use the reviewed candidate and recorded check. The live agent session is optional.
- **Only 10 minutes:** keep the two failures, the stronger contract, and the closing workflow. Cut composition and the extended UI tour.
- **More time:** add the settlement example below, or inspect a proof helper in questions.

## Optional extension: a contract that accepts doing nothing

`settleRounded` provides a second example of an incomplete requirement. A settlement contract saying only `sum(net) === 0` permits an all-zero result: nobody pays anyone, and the books still sum to zero.

The current contract also pins each non-hub transfer to its intended rounded balance:

```ts
//@ ensures forall(p, 0 <= p && p < \result.length && p !== hub ==> \result[p] === roundToG(balances[p], G))
//@ ensures sumTo(\result, \result.length) === 0
```

Together, these determine the hub's remainder as well. This is a useful follow-up if someone asks how to tell whether a specification is strong enough: try implementations that satisfy the words while violating the intended behavior, then refine the contract.

## Presenter accuracy notes

- Describe the demonstrated allocator as flooring shares and redistributing leftovers by index. It does not sort parties by fractional remainder, so do not promise Hamilton/largest-remainder ranking.
- A proof establishes the written contract in the verifier's model. “Verified bill splitter” needs that scope explained.
- A failing verification attempt alone does not prove an implementation wrong; it can also indicate missing proof steps. The naive example has an independently demonstrated concrete violation.
- The four terminal examples above have been checked against the current TypeScript source. Re-run verification and prepare its recordings on the presentation machine before claiming a fresh passing run.
