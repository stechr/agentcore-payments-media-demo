"use client";

import { useState, useCallback, useRef } from "react";

// ── Sell-side model: the differentiated pricing matrix Quillrook Press turns on ──
const TIERS = [
  { key: "articles", label: "Articles", mult: 1, path: "/quillrook/articles/edge-settlement-explained.json" },
  { key: "data", label: "Data", mult: 3, path: "/quillrook/data/agent-settlement-feed.json" },
  { key: "premium", label: "Premium", mult: 8, path: "/quillrook/premium/managed-paywall-economics.json" },
] as const;

const CLASSES = [
  { key: "verified-crawler", label: "Verified crawler", action: "Allow", note: "free — referral search crawler" },
  { key: "known-agent", label: "Known agent", action: "Monetize ×1", note: "standard content-tier price" },
  { key: "unverified", label: "Unverified", action: "Monetize ×2", note: "premium multiplier" },
  { key: "training", label: "Training crawler", action: "Block", note: "403 — no training on this content" },
  { key: "human", label: "Human", action: "Pass-through", note: "no 402" },
] as const;

interface Entry { id: string; t: string; type: "req" | "res" | "pay" | "info"; text: string; status?: number; }
interface CellResult { status: number; outcome: string; price?: number | null; }

const PAYTO = "0xdA09416445671f9ba7bcE3c9Ea925A4757b0Dd14";

export default function PublisherConsole() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cells, setCells] = useState<Record<string, CellResult>>({});
  const [license, setLicense] = useState<{ link?: string; xml?: string } | null>(null);
  const [settlement, setSettlement] = useState<any>(null);
  const [revenue, setRevenue] = useState({ settled: 0, txs: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const settleBase = useRef<number | null>(null);

  const add = useCallback((e: Omit<Entry, "id" | "t">) => {
    setEntries((p) => [...p, { ...e, id: crypto.randomUUID(), t: new Date().toLocaleTimeString("en-US", { hour12: false }) }]);
    setTimeout(() => logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 30);
  }, []);

  const probe = useCallback(async (cls: string, path: string) => {
    const r = await fetch(`/api/waf-probe?class=${encodeURIComponent(cls)}&path=${encodeURIComponent(path)}`);
    return r.json();
  }, []);

  // STEP 2 — run the live differentiated matrix
  async function runMatrix() {
    setBusy("matrix");
    add({ type: "info", text: "Probing the live WAF edge — content tier × agent class" });
    for (const cls of CLASSES) {
      for (const tier of TIERS) {
        add({ type: "req", text: `GET ${tier.path}  ·  x-demo-agent-class: ${cls.key}` });
        const j = await probe(cls.key, tier.path);
        const detail = j.outcome === "monetize" ? `402 · $${(j.price_usdc ?? 0).toFixed(4)} USDC`
          : j.outcome === "block" ? "403 · blocked"
          : j.outcome === "allow" ? "200 · free / pass-through" : `${j.status}`;
        add({ type: "res", status: j.status, text: detail });
        setCells((p) => ({ ...p, [`${cls.key}|${tier.key}`]: { status: j.status, outcome: j.outcome, price: j.price_usdc } }));
        await new Promise((r) => setTimeout(r, 180));
      }
    }
    setBusy(null); setDone((d) => ({ ...d, matrix: true }));
  }

  // STEP 3 — RSL license discovery (Link header + license.xml)
  async function discoverLicense() {
    setBusy("license");
    add({ type: "req", text: "GET /quillrook/catalog.json  ·  inspect Link: rel=license" });
    const cat = await probe("known-agent", "/quillrook/catalog.json");
    add({ type: "res", status: cat.status, text: cat.link ? `Link: ${cat.link}` : "no Link header" });
    add({ type: "req", text: "GET /quillrook/license.xml  ·  fetch RSL terms (free path)" });
    const lic = await fetch(`/api/waf-probe?class=&path=${encodeURIComponent("/quillrook/license.xml")}&raw=1`).then((r) => r.json());
    add({ type: "res", status: lic.status, text: "RSL license.xml retrieved (read/inference OK, training prohibited)" });
    setLicense({ link: cat.link, xml: lic.body });
    setBusy(null); setDone((d) => ({ ...d, license: true }));
  }

  // STEP 4 — real on-chain settlement at the edge
  async function runSettlement() {
    setBusy("settle");
    // reset the settle section to a clean baseline so a retry shows one clean flow
    setEntries((prev) => {
      if (settleBase.current === null) settleBase.current = prev.length;
      return prev.slice(0, settleBase.current);
    });
    setSettlement(null);
    const path = "/quillrook/premium/managed-paywall-economics.json";
    add({ type: "info", text: "Research agent requests a premium article" });
    add({ type: "req", text: `GET ${path}  ·  x-demo-agent-class: known-agent` });
    add({ type: "res", status: 402, text: "402 · $0.0160 USDC — Monetize at the edge (premium ×8)" });
    add({ type: "info", text: "AgentCore Payments signs the x402 v2 authorization → settling on-chain…" });
    const r = await fetch("/api/waf-settle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, agentClass: "known-agent" }),
    }).then((x) => x.json());
    setSettlement(r);
    if (r.result === "settled" && r.tx_hash) {
      add({ type: "pay", text: `PAYMENT-SIGNATURE accepted · $${(r.price_usdc ?? 0.016).toFixed(4)} USDC settled` });
      add({ type: "res", status: 200, text: `200 · content delivered · tx ${r.tx_hash.slice(0, 14)}…` });
      setRevenue((p) => ({ settled: +(p.settled + (r.price_usdc ?? 0.016)).toFixed(4), txs: p.txs + 1 }));
    } else {
      add({ type: "info", text: `settlement: ${r.result || "error"}` });
    }
    setBusy(null); setDone((d) => ({ ...d, settle: true }));
  }

  return (
    <div className="h-screen flex flex-col"
      data-busy={busy || ""} data-step-matrix={done.matrix ? "1" : "0"}
      data-step-license={done.license ? "1" : "0"} data-step-settle={done.settle ? "1" : "0"}
      data-tx={settlement?.tx_hash || ""}>
      <header className="px-4 py-3 border-b bg-slate-900 text-white flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">📰 Quillrook Press — Publisher Console</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            AWS WAF AI traffic monetization · verify + settle at the CloudFront edge · Base Sepolia · <span className="text-emerald-400">SELL SIDE</span>
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide bg-emerald-600/20 text-emerald-300 px-2 py-1 rounded">No Lambda@Edge</span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT — the sell-side flow */}
        <div className="flex-1 max-w-[60%] overflow-y-auto p-4 space-y-4 bg-white">

          {/* STEP 1 — turn on monetization */}
          <section className="border rounded-lg p-3" data-scene="setup">
            <h2 className="font-semibold text-sm text-slate-800">1 · Turn on monetization (publisher setup)</h2>
            <p className="text-xs text-slate-500 mt-1">
              Defined in <code className="bg-slate-100 px-1 rounded">merchant-stack/lib/waf-merchant-stack.ts</code> (CDK) and applied via <code className="bg-slate-100 px-1 rounded">aws wafv2</code> — a managed <strong>Monetize</strong> rule action on the Web ACL. No Lambda@Edge.
            </p>
            <pre className="mt-2 text-[11px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto">{`Action: { Monetize: { PriceMultiplier: "8" } }   # premium tier
MonetizationConfig:
  CurrencyMode: TEST
  CryptoConfig: { Chain: BASE_SEPOLIA,
    WalletAddress: ${PAYTO},
    Prices: [{ Amount: "0.002", Currency: USDC }] }
Link: </quillrook/license.xml>; rel="license"   # RSL terms`}</pre>
            <p className="text-xs text-slate-500 mt-2">
              Effective price = base $0.002 × content-tier multiplier × agent-class multiplier — all expressed through the managed feature.
            </p>
          </section>

          {/* STEP 2 — pricing matrix */}
          <section className="border rounded-lg p-3" data-scene="matrix">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-slate-800">2 · Differentiated pricing matrix (live)</h2>
              <button onClick={runMatrix} disabled={!!busy}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-40" data-testid="run-matrix">
                {busy === "matrix" ? "Probing…" : "Run matrix (live)"}
              </button>
            </div>
            <table className="mt-2 w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left p-1">agent class \ tier</th>
                  {TIERS.map((t) => <th key={t.key} className="p-1 text-right">{t.label} ×{t.mult}</th>)}
                  <th className="p-1 text-right">action</th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((c) => (
                  <tr key={c.key} className="border-t">
                    <td className="p-1 font-medium text-slate-700">{c.label}</td>
                    {TIERS.map((t) => {
                      const r = cells[`${c.key}|${t.key}`];
                      const txt = !r ? "·" : r.outcome === "monetize" ? `$${(r.price ?? 0).toFixed(4)}`
                        : r.outcome === "block" ? "403" : r.outcome === "allow" ? (c.key === "human" ? "—" : "free") : `${r.status}`;
                      const col = !r ? "text-slate-300" : r.outcome === "monetize" ? "text-orange-600"
                        : r.outcome === "block" ? "text-red-600" : "text-emerald-600";
                      return <td key={t.key} className={`p-1 text-right font-mono ${col}`}>{txt}</td>;
                    })}
                    <td className="p-1 text-right text-slate-500">{c.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* STEP 3 — RSL license */}
          <section className="border rounded-lg p-3" data-scene="license">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-slate-800">3 · License terms — RSL discovery (live)</h2>
              <button onClick={discoverLicense} disabled={!!busy}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-40" data-testid="run-license">
                {busy === "license" ? "Fetching…" : "Discover license"}
              </button>
            </div>
            {license && (
              <div className="mt-2 text-[11px]">
                <div className="text-slate-600">Link header: <code className="bg-slate-100 px-1 rounded">{license.link}</code></div>
                {license.xml && <pre className="mt-1 bg-slate-50 border rounded p-2 max-h-32 overflow-auto text-slate-700">{license.xml}</pre>}
              </div>
            )}
          </section>

          {/* STEP 4 — settlement */}
          <section className="border rounded-lg p-3" data-scene="settle">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-slate-800">4 · Agent pays at the edge — real on-chain settlement</h2>
              <button onClick={runSettlement} disabled={!!busy}
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-40" data-testid="run-settle">
                {busy === "settle" ? "Settling…" : "Run settlement (live)"}
              </button>
            </div>
            {settlement?.tx_hash && (
              <div className="mt-2 p-2.5 rounded-lg border border-green-200 bg-green-50 text-xs" data-testid="settlement-card">
                <div className="text-green-800 font-medium">✅ Settled on-chain — Base Sepolia USDC</div>
                <div className="mt-1 text-slate-600 font-mono break-all">payer {settlement.payment_response?.payer}</div>
                <div className="text-slate-600 font-mono break-all">→ payTo {settlement.payTo}</div>
                <div className="text-slate-600 font-mono break-all">tx {settlement.tx_hash}</div>
                <a href={settlement.basescan_url} target="_blank" rel="noreferrer"
                  className="inline-block mt-1.5 px-2 py-1 rounded bg-slate-900 text-white" data-testid="basescan-link">
                  View on BaseScan ↗
                </a>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT — live edge / settlement activity + publisher revenue */}
        <div className="w-[40%] min-w-[320px] h-full flex flex-col border-l border-slate-200 bg-slate-50">
          <div className="p-3 border-b bg-white">
            <div className="flex justify-between text-xs text-slate-600 mb-1">
              <span>💰 Publisher revenue (settled)</span>
              <span>${revenue.settled.toFixed(4)} USDC</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(revenue.settled / 0.05 * 100, 100)}%` }} />
            </div>
            <div className="text-xs text-slate-400 mt-1">{revenue.txs} on-chain settlement{revenue.txs === 1 ? "" : "s"}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-xs" ref={logRef}>
            {entries.length === 0 && <div className="text-center text-slate-400 py-8">Live WAF edge activity appears here…</div>}
            {entries.map((e) => {
              const col = e.type === "pay" ? "border-l-green-600 text-green-700"
                : e.status === 402 ? "border-l-orange-500 text-orange-700"
                : e.status === 403 ? "border-l-red-500 text-red-700"
                : e.type === "info" ? "border-l-slate-300 text-slate-500"
                : "border-l-blue-500 text-blue-700";
              const icon = e.type === "req" ? "→" : e.type === "res" ? "←" : e.type === "pay" ? "💳" : "•";
              return (
                <div key={e.id} className={`flex gap-2 py-0.5 px-1.5 rounded border-l-2 ${col}`}>
                  <span className="text-slate-400 shrink-0">{e.t}</span>
                  <span className="shrink-0">{icon}</span>
                  <span className="truncate">{e.text}{e.status ? <span className="ml-1 opacity-70">[{e.status}]</span> : null}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
