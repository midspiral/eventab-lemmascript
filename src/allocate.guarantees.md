# Guarantees: src/allocate.ts

Generated: 2026-06-16

> Verification is **assumed** (run `lsc check` to discharge the proofs). This report vets only that each `//@ contract` faithfully describes its formal `requires`/`ensures`, via claimcheck's blind round-trip.

## Coverage

- **11** backed contracts: 11 confirmed, 0 disputed
- **0** gaps (contract with no formal spec behind it)

## Claimcheck Results

| Function | Contract | Status |
|----------|----------|--------|
| `allocate` | Splits total cents across the parties (one per weight) so the shares sum back to exactly total, and each share is within one roundness unit G of its fair share. | ✅ confirmed |
| `billTotals` | The per-person totals sum to exactly the subtotals plus the tax and tip (conservation of the grand total). | ✅ confirmed |
| `itemShare` | Splits one item's price across the people who claimed it, so the shares sum to exactly the price and anyone who did not claim it owes zero. | ✅ confirmed |
| `vectorAdd` | Adds two equal-length cent vectors element-wise; the result sums to the sum of the two inputs. | ✅ confirmed |
| `itemSubtotals` | Rolls up each person's subtotal across all item vectors, so the subtotals sum to exactly the total of the item prices and stay non-negative. | ✅ confirmed |
| `bill` | Computes each person's grand total from the item vectors plus tax and tip, so the totals sum to exactly the item prices plus tax plus tip. | ✅ confirmed |
| `balances` | Computes each person's net balance as what they paid minus what they owe; the balances sum to exactly zero. | ✅ confirmed |
| `settle` | Doesn't do anything useful, since it just returns the balances unchanged — the hub settlement it's named for is never captured by the spec (the app uses settleRounded instead). | ✅ confirmed |
| `settleRounded` | Routes settlement through the hub but rounds each non-hub transfer to a whole multiple of G (the hub absorbs the leftover); each non-hub transfer equals its rounded balance and the transfers sum to zero. | ✅ confirmed |
| `applyOp` | Preserves the total across all accounts — the running balance total is unchanged. | ✅ confirmed |
| `replay` | Replays an append-only log of balanced ledger moves over an empty tab; whatever the edits and order, the final balances sum to zero. | ✅ confirmed |

## Confirmed Guarantees

**Splits total cents across the parties (one per weight) so the shares sum back to exactly total, and each share is within one roundness unit G of its fair share.** — `allocate`
```
allocate(total: number, weights: number[], G: number): number[]
  requires total >= 0
  requires weights.length >= 1
  requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
  requires sumTo(weights, weights.length) >= 1
  requires G >= 1
  ensures \result.length === weights.length
  ensures sumTo(\result, \result.length) === total
  ensures forall(k, 0 <= k && k < \result.length ==> floorShareG(total, weights[k], sumTo(weights, weights.length), G) <= \result[k])
  ensures forall(k, 0 <= k && k < \result.length ==> \result[k] <= floorShareG(total, weights[k], sumTo(weights, weights.length), G) + G)
```
- Back-translation: The allocate function takes a total amount, an array of weights, and a granularity G, and returns an array of allocations such that the allocations sum to the total, each allocation is at least the floor share (total times weight divided by sum of weights, rounded down to granularity G), and each allocation is at most the floor share plus G.

**The per-person totals sum to exactly the subtotals plus the tax and tip (conservation of the grand total).** — `billTotals`
```
billTotals(subtotals: number[], tax: number, tip: number, G: number): number[]
  requires subtotals.length >= 1
  requires forall(k, 0 <= k && k < subtotals.length ==> subtotals[k] >= 0)
  requires sumTo(subtotals, subtotals.length) >= 1
  requires tax >= 0
  requires tip >= 0
  requires G >= 1
  ensures \result.length === subtotals.length
  ensures sumTo(\result, \result.length) === sumTo(subtotals, subtotals.length) + tax + tip
```
- Back-translation: The billTotals function takes an array of subtotals, a tax amount, a tip amount, and a granularity G, and returns an array of bill totals such that the sum of the result equals the sum of subtotals plus tax plus tip.

**Splits one item's price across the people who claimed it, so the shares sum to exactly the price and anyone who did not claim it owes zero.** — `itemShare`
```
itemShare(price: number, claimers: number[], claimerWeights: number[], n: number, G: number): number[]
  requires price >= 0
  requires n >= 1
  requires claimers.length >= 1
  requires claimers.length === claimerWeights.length
  requires forall(j, 0 <= j && j < claimers.length ==> 0 <= claimers[j] && claimers[j] < n)
  requires forall(j, 0 <= j && j < claimerWeights.length ==> claimerWeights[j] >= 0)
  requires sumTo(claimerWeights, claimerWeights.length) >= 1
  requires G >= 1
  ensures \result.length === n
  ensures sumTo(\result, n) === price
  ensures forall(q, 0 <= q && q < n && !claimers.includes(q) ==> \result[q] === 0)
```
- Back-translation: The itemShare function takes a price, an array of claimer indices, an array of claimer weights, the total number of people n, and a granularity G, and returns an array of length n where the price is distributed among the claimers according to their weights, and non-claimers receive zero.

**Adds two equal-length cent vectors element-wise; the result sums to the sum of the two inputs.** — `vectorAdd`
```
vectorAdd(a: number[], b: number[]): number[]
  requires a.length === b.length
  ensures \result.length === a.length
  ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === a[k] + b[k])
  ensures sumTo(\result, \result.length) === sumTo(a, a.length) + sumTo(b, b.length)
```
- Back-translation: The vectorAdd function takes two arrays of equal length and returns an array where each element is the sum of the corresponding elements from the input arrays.

**Rolls up each person's subtotal across all item vectors, so the subtotals sum to exactly the total of the item prices and stay non-negative.** — `itemSubtotals`
```
itemSubtotals(itemVectors: number[][], prices: number[], n: number): number[]
  requires n >= 1
  requires itemVectors.length === prices.length
  requires forall(i, 0 <= i && i < itemVectors.length ==> itemVectors[i].length === n)
  requires forall(i, 0 <= i && i < itemVectors.length ==> sumTo(itemVectors[i], n) === prices[i])
  requires forall(i, 0 <= i && i < itemVectors.length ==> forall(k, 0 <= k && k < n ==> itemVectors[i][k] >= 0))
  ensures \result.length === n
  ensures sumTo(\result, n) === sumTo(prices, prices.length)
  ensures forall(k, 0 <= k && k < n ==> \result[k] >= 0)
```
- Back-translation: The itemSubtotals function takes a 2D array of item vectors (where each row represents how an item's price is distributed among n people), an array of prices, and the number of people n, and returns an array of subtotals where each element is the total amount owed by each person across all items.

**Computes each person's grand total from the item vectors plus tax and tip, so the totals sum to exactly the item prices plus tax plus tip.** — `bill`
```
bill(itemVectors: number[][], prices: number[], tax: number, tip: number, n: number, G: number): number[]
  requires n >= 1
  requires itemVectors.length === prices.length
  requires forall(i, 0 <= i && i < itemVectors.length ==> itemVectors[i].length === n)
  requires forall(i, 0 <= i && i < itemVectors.length ==> sumTo(itemVectors[i], n) === prices[i])
  requires forall(i, 0 <= i && i < itemVectors.length ==> forall(k, 0 <= k && k < n ==> itemVectors[i][k] >= 0))
  requires sumTo(prices, prices.length) >= 1
  requires tax >= 0
  requires tip >= 0
  requires G >= 1
  ensures \result.length === n
  ensures sumTo(\result, n) === sumTo(prices, prices.length) + tax + tip
```
- Back-translation: The bill function takes a 2D array of item vectors, an array of prices, a tax amount, a tip amount, the number of people n, and a granularity G, and returns an array of final bill amounts for each person such that the sum of all bills equals the sum of prices plus tax plus tip.

**Computes each person's net balance as what they paid minus what they owe; the balances sum to exactly zero.** — `balances`
```
balances(paid: number[], owed: number[]): number[]
  requires paid.length === owed.length
  requires sumTo(paid, paid.length) === sumTo(owed, owed.length)
  ensures \result.length === paid.length
  ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === paid[k] - owed[k])
  ensures sumTo(\result, \result.length) === 0
```
- Back-translation: The balances function takes an array of amounts paid and an array of amounts owed (which must sum to the same total) and returns an array of balances where each element is the amount paid minus the amount owed for that person.

**Doesn't do anything useful, since it just returns the balances unchanged — the hub settlement it's named for is never captured by the spec (the app uses settleRounded instead).** — `settle`
```
settle(balances: number[]): number[]
  requires balances.length >= 1
  requires sumTo(balances, balances.length) === 0
  ensures \result.length === balances.length
  ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === balances[k])
  ensures sumTo(\result, \result.length) === 0
```
- Back-translation: The settle function takes an array of balances (which must sum to zero) and returns an array that is identical to the input array.

**Routes settlement through the hub but rounds each non-hub transfer to a whole multiple of G (the hub absorbs the leftover); each non-hub transfer equals its rounded balance and the transfers sum to zero.** — `settleRounded`
```
settleRounded(balances: number[], hub: number, G: number): number[]
  requires balances.length >= 1
  requires 0 <= hub && hub < balances.length
  requires G >= 1
  ensures \result.length === balances.length
  ensures forall(p, 0 <= p && p < \result.length && p !== hub ==> \result[p] === roundToG(balances[p], G))
  ensures sumTo(\result, \result.length) === 0
```
- Back-translation: The settleRounded function takes an array of balances (which must sum to zero), a hub person index, and a granularity G, and returns an array where all balances except the hub's are rounded to the nearest multiple of G, and the hub's balance is adjusted so the total remains zero.

**Preserves the total across all accounts — the running balance total is unchanged.** — `applyOp`
```
applyOp(bal: number[], from: number, to: number, amount: number): number[]
  requires 0 <= from && from < bal.length
  requires 0 <= to && to < bal.length
  ensures \result.length === bal.length
  ensures sumTo(\result, \result.length) === sumTo(bal, bal.length)
```
- Back-translation: The applyOp function takes an array of balances, a from index, a to index, and an amount, and returns an array where the total sum of balances is preserved.

**Replays an append-only log of balanced ledger moves over an empty tab; whatever the edits and order, the final balances sum to zero.** — `replay`
```
replay(froms: number[], tos: number[], amounts: number[], n: number): number[]
  requires n >= 1
  requires froms.length === tos.length
  requires tos.length === amounts.length
  requires forall(k, 0 <= k && k < froms.length ==> 0 <= froms[k] && froms[k] < n)
  requires forall(k, 0 <= k && k < tos.length ==> 0 <= tos[k] && tos[k] < n)
  ensures \result.length === n
  ensures sumTo(\result, n) === 0
```
- Back-translation: The replay function takes arrays of from indices, to indices, amounts, and a number of people n, and returns an array of length n where the sum of all elements is zero.

