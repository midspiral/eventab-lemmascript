import { useEffect, useMemo, useRef, useState } from "react";
// The VERIFIED money core (Dafny-proven, integer cents). The shell is
// UNTRUSTED: it may only CALL these proven ops with inputs that satisfy their
// preconditions — every call below is gated (see `compute()`):
//   • bill          requires Σ prices ≥ 1   (at least one priced, claimed item)
//   • balances      requires Σ paid === Σ owed   (the tab is fully paid)
//   • settleRounded requires 0 ≤ hub < n   and proves Σ net === 0
import { itemShare, bill, balances, settleRounded } from "../../src/allocate";

// Rounding is applied to the SETTLEMENT only — each non-payer's transfer is
// rounded to a whole multiple of G and the payer (hub) absorbs the difference.
// Shares themselves are always computed to the exact cent (G = 1), so an even
// split stays even. `settleRounded` proves the rounding still nets to zero.
const ROUNDNESS: { g: number; label: string }[] = [
  { g: 1, label: "1¢" },
  { g: 100, label: "$1" },
  { g: 500, label: "$5" },
];

// ── money helpers (UI works in dollars, the core works in integer cents) ──
const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** parse a dollars string ("24", "24.5", "$24.00") → non-negative cents int */
const cents = (s: string): number => {
  const v = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  if (!isFinite(v) || v < 0) return 0;
  return Math.round(v * 100);
};

// ── persisted state ──────────────────────────────────────────────────
type Item = { id: number; name: string; price: string; claims: boolean[] };
type State = {
  people: string[];
  items: Item[];
  tax: string;
  tip: string;
  paid: string[];
  G: number; // settlement rounding: 1=cent, 100=$1, 500=$5
  hub: number; // who fronted the bill / absorbs the rounding
};

let _id = 1;
const nextId = () => _id++;

function demoState(): State {
  // The README/demo tab: $42.24 grand, Ana fronted it all.
  return {
    people: ["Ana", "Ben", "Cy"],
    items: [
      { id: nextId(), name: "Pizza", price: "24.00", claims: [true, true, true] },
      { id: nextId(), name: "Beer", price: "9.00", claims: [true, true, false] },
    ],
    tax: "3.30",
    tip: "5.94",
    paid: ["42.24", "0", "0"],
    G: 1,
    hub: 0,
  };
}

/** Fill defaults and fix array lengths so the core's shape preconditions hold. */
function normalize(s: Partial<State>): State {
  const d = demoState();
  const people = Array.isArray(s.people) && s.people.length ? s.people.map(String) : d.people;
  const n = people.length;
  const fix = (claims: unknown): boolean[] => {
    const c = Array.isArray(claims) ? claims.map(Boolean) : [];
    return Array.from({ length: n }, (_, i) => c[i] ?? false);
  };
  const items = (Array.isArray(s.items) ? s.items : d.items).map((it) => ({
    id: nextId(),
    name: String(it?.name ?? ""),
    price: String(it?.price ?? ""),
    claims: fix(it?.claims),
  }));
  const paidArr = Array.isArray(s.paid) ? s.paid : [];
  const paid = Array.from({ length: n }, (_, i) => String(paidArr[i] ?? "0"));
  const G = ROUNDNESS.some((r) => r.g === s.G) ? (s.G as number) : 1;
  const hub = typeof s.hub === "number" && s.hub >= 0 && s.hub < n ? s.hub : 0;
  return { people, items, tax: String(s.tax ?? d.tax), tip: String(s.tip ?? d.tip), paid, G, hub };
}

// share-link codec (unicode-safe base64 in the URL hash; no server)
const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
const dec = (s: string) => decodeURIComponent(escape(atob(s)));

function loadState(): State {
  try {
    const h = location.hash;
    if (h.startsWith("#d=")) return normalize(JSON.parse(dec(h.slice(3))));
  } catch {
    /* fall through */
  }
  try {
    const raw = localStorage.getItem("eventab");
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return demoState();
}

// ── the verified computation (mirrors src/demo.ts, with guards) ───────
type Result = {
  hasItems: boolean; // Σ prices ≥ 1 — bill's precondition holds
  fullyPaid: boolean; // Σ paid === grand — balances' precondition holds
  totals: number[]; // per-person OWES, exact to the cent (from bill); zeros until hasItems
  bal: number[]; // exact balances; valid only when fullyPaid
  net: number[]; // rounded settlement (hub absorbs); valid only when fullyPaid
  grand: number;
  paidTotal: number;
};

function compute(s: State): Result {
  const n = s.people.length;
  const zeros = s.people.map(() => 0);

  // Only claimed, positive-price items — each gives itemShare a valid call.
  const usable = s.items
    .map((it) => ({ price: cents(it.price), claimers: it.claims.flatMap((c, i) => (c ? [i] : [])) }))
    .filter((it) => it.price > 0 && it.claimers.length >= 1);
  const prices = usable.map((it) => it.price);
  const tax = cents(s.tax);
  const tip = cents(s.tip);
  const grand = sum(prices) + tax + tip;

  // GUARD: bill requires n ≥ 1 and Σ prices ≥ 1. Shares are split to the EXACT
  // cent (G = 1) — rounding happens only at settlement, so even splits stay even.
  const hasItems = n >= 1 && sum(prices) >= 1;
  let totals = zeros;
  if (hasItems) {
    const itemVectors = usable.map((it) =>
      itemShare(it.price, it.claimers, it.claimers.map(() => 1), n, 1),
    );
    totals = bill(itemVectors, prices, tax, tip, n, 1);
  }

  const paidV = s.paid.map(cents);
  const paidTotal = sum(paidV);

  // GUARD: balances requires Σ paid === Σ owed (=== grand). Only then is the
  // settlement (and its Σ === 0 guarantee) in-contract.
  const fullyPaid = hasItems && paidTotal === grand;
  let bal = zeros;
  let net = zeros;
  if (fullyPaid) {
    bal = balances(paidV, totals); // Σ paid === Σ totals === grand ✓
    net = settleRounded(bal, s.hub, s.G); // round transfers, hub absorbs; Σ net === 0 ✓
  }

  return { hasItems, fullyPaid, totals, bal, net, grand, paidTotal };
}

// ── component ─────────────────────────────────────────────────────────
export default function App() {
  const init = useRef(loadState()).current;
  const [people, setPeople] = useState<string[]>(init.people);
  const [items, setItems] = useState<Item[]>(init.items);
  const [tax, setTax] = useState(init.tax);
  const [tip, setTip] = useState(init.tip);
  const [paid, setPaid] = useState<string[]>(init.paid);
  const [G, setG] = useState(init.G);
  const [hub, setHub] = useState(init.hub);
  const [copied, setCopied] = useState(false);

  const state: State = { people, items, tax, tip, paid, G, hub };

  // persist
  useEffect(() => {
    try {
      localStorage.setItem("eventab", JSON.stringify(state));
    } catch {
      /* ignore quota / private mode */
    }
  });

  const r = useMemo(() => compute(state), [people, items, tax, tip, paid, G, hub]);
  const n = people.length;

  // ── people ──
  const addPerson = () => {
    setPeople((p) => [...p, `Person ${p.length + 1}`]);
    setItems((its) => its.map((it) => ({ ...it, claims: [...it.claims, false] })));
    setPaid((pd) => [...pd, "0"]);
  };
  const removePerson = (idx: number) => {
    if (people.length <= 1) return;
    setPeople((p) => p.filter((_, i) => i !== idx));
    setItems((its) => its.map((it) => ({ ...it, claims: it.claims.filter((_, i) => i !== idx) })));
    setPaid((pd) => pd.filter((_, i) => i !== idx));
    setHub((h) => Math.max(0, Math.min(h >= idx ? h - 1 : h, people.length - 2)));
  };
  const renamePerson = (idx: number, name: string) =>
    setPeople((p) => p.map((x, i) => (i === idx ? name : x)));

  // ── items ──
  const addItem = () =>
    setItems((its) => [
      ...its,
      { id: nextId(), name: "", price: "", claims: people.map(() => false) },
    ]);
  const removeItem = (id: number) => setItems((its) => its.filter((it) => it.id !== id));
  const patchItem = (id: number, patch: Partial<Item>) =>
    setItems((its) => its.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const toggleClaim = (id: number, p: number) =>
    setItems((its) =>
      its.map((it) =>
        it.id === id ? { ...it, claims: it.claims.map((c, i) => (i === p ? !c : c)) } : it,
      ),
    );

  // ── paid ──
  const setPaidAt = (idx: number, v: string) =>
    setPaid((pd) => pd.map((x, i) => (i === idx ? v : x)));
  // one person fronted the whole bill → they're also the settlement hub
  const paidAll = (idx: number) => {
    setPaid(people.map((_, i) => (i === idx ? (r.grand / 100).toFixed(2) : "0")));
    setHub(idx);
  };

  // ── tip helper ── (% of the items subtotal)
  const subtotal = r.grand - cents(tax) - cents(tip);
  const tipPct = (pct: number) => setTip(((subtotal * pct) / 10000).toFixed(2));

  // ── share ──
  const share = async () => {
    const hash = "#d=" + enc(JSON.stringify(state));
    history.replaceState(null, "", hash);
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the URL bar still holds the link */
    }
  };
  const reset = () => {
    const d = demoState();
    setPeople(d.people);
    setItems(d.items);
    setTax(d.tax);
    setTip(d.tip);
    setPaid(d.paid);
    setG(d.G);
    setHub(d.hub);
    history.replaceState(null, "", location.pathname + location.search);
  };

  // star settlement: each non-hub person squares their (rounded) balance with the hub
  const transfers = people
    .map((nm, p) => ({ p, nm, amt: r.net[p] ?? 0 }))
    .filter((x) => x.p !== hub && x.amt !== 0);
  const shortfall = r.grand - r.paidTotal;
  // what the hub gives up (or keeps) because the transfers were rounded
  const hubRounding = r.fullyPaid ? (r.net[hub] ?? 0) - (r.bal[hub] ?? 0) : 0;

  return (
    <div className="wrap">
      <header>
        <h1>
          Even<span className="accent">Tab</span>
        </h1>
        <p className="tag">split the tab, even — provably to the cent</p>
      </header>

      {/* People */}
      <section className="card">
        <div className="card-head">
          <h2>People</h2>
          <button className="ghost" onClick={addPerson}>
            + person
          </button>
        </div>
        <div className="people">
          {people.map((nm, i) => (
            <div className="person-chip" key={i}>
              <input
                aria-label={`person ${i + 1} name`}
                value={nm}
                onChange={(e) => renamePerson(i, e.target.value)}
              />
              {people.length > 1 && (
                <button className="x" title="remove" onClick={() => removePerson(i)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Items */}
      <section className="card">
        <div className="card-head">
          <h2>Items</h2>
          <button className="ghost" onClick={addItem}>
            + item
          </button>
        </div>
        <div className="items">
          <div className="item-row head">
            <span>Item</span>
            <span>Price</span>
            <span className="who">Who's in?</span>
            <span />
          </div>
          {items.map((it) => (
            <div className="item-row" key={it.id}>
              <input
                className="iname"
                placeholder="e.g. Tacos"
                value={it.name}
                onChange={(e) => patchItem(it.id, { name: e.target.value })}
              />
              <label className="money">
                <span>$</span>
                <input
                  className="iprice"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={it.price}
                  onChange={(e) => patchItem(it.id, { price: e.target.value })}
                />
              </label>
              <div className="who">
                {people.map((nm, p) => (
                  <button
                    key={p}
                    className={"claim" + (it.claims[p] ? " on" : "")}
                    onClick={() => toggleClaim(it.id, p)}
                    title={nm}
                  >
                    {nm.slice(0, 6) || p + 1}
                  </button>
                ))}
              </div>
              <button className="x" title="remove item" onClick={() => removeItem(it.id)}>
                ×
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="muted">No items yet — add one above.</p>}
        </div>
      </section>

      {/* Tax / tip / rounding */}
      <section className="card grid3">
        <div>
          <h2>Tax</h2>
          <label className="money">
            <span>$</span>
            <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </label>
        </div>
        <div>
          <h2>Tip</h2>
          <label className="money">
            <span>$</span>
            <input inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} />
          </label>
          <div className="pcts">
            {[15, 18, 20].map((p) => (
              <button key={p} className="ghost sm" onClick={() => tipPct(p)}>
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2>Round payments</h2>
          <div className="seg">
            {ROUNDNESS.map((rr) => (
              <button
                key={rr.g}
                className={"seg-btn" + (G === rr.g ? " on" : "")}
                onClick={() => setG(rr.g)}
              >
                {rr.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Who paid */}
      <section className="card">
        <div className="card-head">
          <h2>Who paid?</h2>
          <span className={"paidline" + (r.fullyPaid ? " ok" : "")}>
            paid {fmt(r.paidTotal)} of {fmt(r.grand)}
            {shortfall > 0 && ` · ${fmt(shortfall)} to go`}
            {shortfall < 0 && ` · ${fmt(-shortfall)} over`}
          </span>
        </div>
        <div className="paid">
          {people.map((nm, i) => (
            <div className="paid-row" key={i}>
              <span className="pn">{nm || `Person ${i + 1}`}</span>
              <label className="money">
                <span>$</span>
                <input
                  inputMode="decimal"
                  value={paid[i] ?? "0"}
                  onChange={(e) => setPaidAt(i, e.target.value)}
                />
              </label>
              <button
                className="ghost sm"
                onClick={() => paidAll(i)}
                title="this person paid the whole tab"
              >
                paid all
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Results */}
      <section className="card result">
        <div className="card-head">
          <h2>The split</h2>
          {r.fullyPaid && (
            <label className="hubpick">
              hub{" "}
              <select value={hub} onChange={(e) => setHub(Number(e.target.value))}>
                {people.map((nm, i) => (
                  <option key={i} value={i}>
                    {nm || `Person ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!r.hasItems ? (
          <p className="muted">Add an item with a price and at least one person to see the split.</p>
        ) : (
          <>
            <table className="totals">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Owes</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {people.map((nm, i) => (
                  <tr key={i}>
                    <td>{nm || `Person ${i + 1}`}</td>
                    <td className="num">{fmt(r.totals[i] ?? 0)}</td>
                    <td className="num">{fmt(cents(paid[i] ?? "0"))}</td>
                  </tr>
                ))}
                <tr className="grandrow">
                  <td>Total</td>
                  <td className="num">{fmt(sum(r.totals))}</td>
                  <td className="num">{fmt(r.paidTotal)}</td>
                </tr>
              </tbody>
            </table>

            <div className="settle">
              <h3>Settle up</h3>
              {r.fullyPaid ? (
                transfers.length === 0 ? (
                  <p className="muted">Everyone's already square.</p>
                ) : (
                  <>
                    <ul>
                      {transfers.map((t) => (
                        <li key={t.p}>
                          {t.amt < 0 ? (
                            <>
                              <b>{t.nm}</b> pays <b>{people[hub]}</b>{" "}
                              <span className="amt">{fmt(-t.amt)}</span>
                            </>
                          ) : (
                            <>
                              <b>{people[hub]}</b> pays <b>{t.nm}</b>{" "}
                              <span className="amt">{fmt(t.amt)}</span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    {hubRounding !== 0 && (
                      <p className="muted rounding-note">
                        Rounded to {ROUNDNESS.find((x) => x.g === G)?.label} —{" "}
                        <b>{people[hub] || `Person ${hub + 1}`}</b>{" "}
                        {hubRounding < 0 ? "covers" : "keeps"} the {fmt(Math.abs(hubRounding))}{" "}
                        rounding difference.
                      </p>
                    )}
                  </>
                )
              ) : (
                <p className="warn">
                  Enter who paid — totalling {fmt(r.grand)} — to settle up.{" "}
                  {shortfall > 0 ? `${fmt(shortfall)} to go` : `${fmt(-shortfall)} over`}.
                </p>
              )}
            </div>

            {/* what the proofs guarantee, shown live */}
            <div className="badges">
              <span className="badge ok" data-testid="badge-conserve">
                ✓ verified · shares sum to the tab: {fmt(sum(r.totals))} = {fmt(r.grand)}
              </span>
              <span
                className={"badge " + (r.fullyPaid ? "ok" : "wait")}
                data-testid="badge-settle"
              >
                {r.fullyPaid
                  ? `✓ verified · settlement nets to zero: Σ = ${fmt(sum(r.net))}`
                  : "○ settlement nets to zero once the tab is fully paid"}
              </span>
            </div>
          </>
        )}
      </section>

      <div className="actions">
        <button onClick={share}>{copied ? "link copied ✓" : "share link"}</button>
        <button className="ghost" onClick={reset}>
          reset to demo
        </button>
      </div>

      <footer>
        <p>
          Every number above is computed by a <b>Dafny-verified core</b> (integer cents). Proven, for
          all inputs: per-person shares are <b>exact to the cent</b> and <b>sum to the tab</b> (no cent
          created or lost), non-claimers pay <b>0</b>, and rounding the settlement to your chosen unit
          — with the payer absorbing the difference — <b>still nets to zero</b>. The page (this React
          shell) is untrusted: it only calls the proven ops with valid inputs.
        </p>
        <p className="muted">
          EvenTab · {n} {n === 1 ? "person" : "people"} · payments rounded to{" "}
          {ROUNDNESS.find((x) => x.g === G)?.label} · no account, no server — your tab stays in this
          browser (and in the share link).
        </p>
        <p className="muted">
          <a href="https://github.com/midspiral/LemmaScript" target="_blank" rel="noreferrer">
            Verified with LemmaScript
          </a>{" "}
          ·{" "}
          <a href="https://github.com/midspiral/eventab-lemmascript" target="_blank" rel="noreferrer">
            Source
          </a>
        </p>
      </footer>
    </div>
  );
}
