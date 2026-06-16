// Runs the VERIFIED core on a concrete tab — a runtime sanity check, since a
// proof is about the model, not the running bytes (floats, overflow, JS quirks).
// `npx tsx src/demo.ts`
import { itemShare, bill, balances, settleRounded, replay } from "./allocate";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const names = ["Ana", "Ben", "Cy"];
const n = 3;
const G = 1; // roundness: exact cents

console.log("=== EvenTab — a real tab, settled by the verified core ===\n");

// ── The bill: two items, claimed by different people ──
const pizza = itemShare(2400, [0, 1, 2], [1, 1, 1], n, G); // $24.00, all three
const beer = itemShare(900, [0, 1], [1, 1], n, G); //  $9.00, Ana & Ben only
console.log("Pizza $24.00 (all 3): ", pizza.map(fmt).join("  "));
console.log("Beer  $9.00  (Ana,Ben):", beer.map(fmt).join("  "), " ← Cy: $0.00 (didn't order)");

const itemVectors = [pizza, beer];
const prices = [2400, 900];
const tax = 330; // $3.30
const tip = 594; // $5.94 (18%)
const totals = bill(itemVectors, prices, tax, tip, n, G);
const grand = sum(prices) + tax + tip;

console.log("\nTotals (subtotal + tax + tip):");
names.forEach((nm, i) => console.log(`  ${nm}: ${fmt(totals[i])}`));
console.log(`  Σ = ${fmt(sum(totals))}  vs grand total ${fmt(grand)}  ${sum(totals) === grand ? "✓ conserves" : "✗ LEAK"}`);

// ── Ana fronted the whole bill; settle up ──
const paid = [grand, 0, 0];
const bal = balances(paid, totals);
console.log("\nBalances (paid − owed):");
names.forEach((nm, i) => console.log(`  ${nm}: ${bal[i] >= 0 ? "+" : ""}${fmt(bal[i])}`));
console.log(`  Σ balances = ${fmt(sum(bal))}  ${sum(bal) === 0 ? "✓" : "✗"}`);

const net = settleRounded(bal, n - 1, G); // hub = last person (Cy); G=1 → exact, like the app
console.log("\nSettlement (everyone squares with the hub, Cy):");
net.forEach((amt, i) => {
  if (i === n - 1 || amt === 0) return;
  console.log(amt > 0 ? `  Cy → ${names[i]}  ${fmt(amt)}` : `  ${names[i]} → Cy  ${fmt(-amt)}`);
});

// ── The op-log conserves over any replay ──
const finalBal = replay([0, 1, 2], [2, 0, 1], [500, 500, 500], n);
console.log("\nOp-log replay (3 edits, any order): Σ =", sum(finalBal), sum(finalBal) === 0 ? "✓" : "✗");

// ── Assert every money invariant at runtime ──
const ok =
  sum(totals) === grand &&
  beer[2] === 0 && // non-claimer pays nothing
  sum(bal) === 0 &&
  net.every((v, i) => v === bal[i]) && // settlement squares everyone
  sum(finalBal) === 0;
console.log(`\n${ok ? "✓ all money invariants hold at runtime" : "✗ a runtime invariant FAILED"}`);
if (!ok) throw new Error("a runtime money invariant FAILED");
