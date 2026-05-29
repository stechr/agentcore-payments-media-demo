"use client";

/**
 * Inline tool card renderer — shows contextual cards for each HTTP request.
 * Uses shared color scheme from activity-panel for visual linking.
 */

import { COLORS, getColorForPath } from "./activity-panel";

interface ToolCardProps {
  args: { url?: string; method?: string; headers?: Record<string, string>; body?: any };
  result?: string;
  status: "running" | "complete";
  onVisible?: (groupId: string) => void; // Called when card scrolls into view
}

export function HttpRequestCard({ args, result, status }: ToolCardProps) {
  const url = args.url || "";
  const path = extractPath(url);

  if (path.endsWith("/catalog.json")) return <CatalogCard path={path} result={result} status={status} />;
  if (path.includes("/reputation")) return <TrustCard path={path} result={result} status={status} />;
  if (path.includes("/feedback")) return <FeedbackCard result={result} status={status} />;

  if (result?.includes("PAYMENT_REQUIRED") || result?.includes('"statusCode":402'))
    return <PaywallCard path={path} result={result} />;

  if (args.headers?.["X-PAYMENT"] || args.headers?.["x-payment"])
    return <PaymentSuccessCard path={path} result={result} />;

  return <GenericHttpCard path={path} method={args.method} status={status} />;
}

function CatalogCard({ path, result, status }: { path: string; result?: string; status: string }) {
  const merchant = path.split("/")[1] || "unknown";
  let articleCount = 0;
  let priceRange = "";
  try {
    const data = JSON.parse(extractJsonFromResult(result));
    const articles = data?.articles || [];
    articleCount = articles.length;
    if (articles.length > 0) {
      const prices = articles.map((a: any) => a.price || a.price_usdc || 0).filter((p: number) => p > 0);
      if (prices.length) priceRange = `$${Math.min(...prices)}–$${Math.max(...prices)}`;
    }
  } catch {}

  const c = COLORS.catalog;
  return (
    <div className={`my-1.5 p-2.5 rounded-lg border-l-4 ${c.border} border border-blue-100 ${c.bg} text-sm`}>
      <div className="flex items-center gap-2">
        {status === "running" ? <Spinner /> : <span className="text-blue-500">📋</span>}
        <span className={c.text}>
          {status === "running" ? "Fetching" : "Fetched"} catalog from <strong className="capitalize">{merchant}</strong>
        </span>
      </div>
      {status === "complete" && articleCount > 0 && (
        <div className="mt-1 text-xs text-slate-500 ml-6">
          {articleCount} articles • {priceRange || "pricing varies"}
        </div>
      )}
    </div>
  );
}

function TrustCard({ path, result, status }: { path: string; result?: string; status: string }) {
  const merchantId = path.match(/\/merchants\/([^/]+)/)?.[1] || "unknown";
  let score: number | null = null;
  let name = merchantId;
  let disputes = 0;
  let txns = 0;

  try {
    const data = JSON.parse(extractJsonFromResult(result));
    score = data?.trustScore;
    name = data?.name || merchantId;
    disputes = data?.disputeRate || 0;
    txns = data?.totalTransactions || 0;
  } catch {}

  const verdict = score === null ? "TRIAL" : score >= 4 ? "PROCEED" : score >= 2.5 ? "CAUTION" : "SKIP";
  const c = COLORS.trust;
  const badgeColor = score === null ? "bg-gray-200 text-gray-700" : score >= 4 ? "bg-green-200 text-green-800" : score >= 2.5 ? "bg-yellow-200 text-yellow-800" : "bg-red-200 text-red-800";

  return (
    <div className={`my-1.5 p-2.5 rounded-lg border-l-4 ${c.border} border border-emerald-100 ${c.bg} text-sm`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "running" ? <Spinner /> : <span>🏪</span>}
          <span className={c.text}>
            {status === "running" ? "Checking trust for" : "Trust check:"} <strong>{name}</strong>
          </span>
        </div>
        {status === "complete" && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${badgeColor}`}>{verdict}</span>
        )}
      </div>
      {status === "complete" && score !== null && (
        <div className="mt-1 flex gap-3 text-xs text-slate-500 ml-6">
          <span>⭐ {score}/5</span>
          <span>📊 {txns} txns</span>
          <span>⚠️ {(disputes * 100).toFixed(0)}% disputes</span>
        </div>
      )}
      {status === "complete" && score === null && (
        <div className="mt-1 text-xs text-slate-500 ml-6">New merchant — only {txns} transactions, no trust score yet</div>
      )}
    </div>
  );
}

function PaywallCard({ path, result }: { path: string; result?: string }) {
  const merchant = path.split("/")[1] || "unknown";
  const article = path.split("/").slice(2).join("/").replace(".json", "").replace(/-/g, " ");
  let price = "?";
  try {
    const data = JSON.parse(extractJsonFromResult(result));
    const body = typeof data?.body === "string" ? JSON.parse(data.body) : data?.body || data;
    const amount = body?.pricing?.amount || (body?.accepts?.[0]?.maxAmountRequired ? parseInt(body.accepts[0].maxAmountRequired) / 1e6 : null);
    if (amount) price = `$${amount}`;
  } catch {}

  const c = COLORS.paywall;
  return (
    <div className={`my-1.5 p-2.5 rounded-lg border-l-4 ${c.border} border border-orange-100 ${c.bg} text-sm`}>
      <div className="flex items-center gap-2">
        <span className="text-orange-500">🚧</span>
        <span className={c.text}>
          Paywall hit: <strong className="capitalize">{merchant}</strong> requires <strong>{price}</strong> USDC
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500 ml-6 capitalize">{article}</div>
    </div>
  );
}

function PaymentSuccessCard({ path, result }: { path: string; result?: string }) {
  const merchant = path.split("/")[1] || "unknown";
  const article = path.split("/").slice(2).join("/").replace(".json", "").replace(/-/g, " ");

  const c = COLORS.payment;
  return (
    <div className={`my-1.5 p-2.5 rounded-lg border-l-4 ${c.border} border border-green-100 ${c.bg} text-sm`}>
      <div className="flex items-center gap-2">
        <span>✅</span>
        <span className={c.text}>
          Paid & received content from <strong className="capitalize">{merchant}</strong>
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500 ml-6 capitalize">{article}</div>
    </div>
  );
}

function FeedbackCard({ result, status }: { result?: string; status: string }) {
  const c = COLORS.feedback;
  return (
    <div className={`my-1.5 p-2.5 rounded-lg border-l-4 ${c.border} border border-purple-100 ${c.bg} text-sm`}>
      <div className="flex items-center gap-2">
        {status === "running" ? <Spinner /> : <span>⭐</span>}
        <span className={c.text}>
          {status === "running" ? "Submitting quality rating..." : "Quality rating submitted"}
        </span>
      </div>
    </div>
  );
}

function GenericHttpCard({ path, method, status }: { path: string; method?: string; status: string }) {
  const c = COLORS.generic;
  return (
    <div className={`my-1.5 p-2 rounded-lg border-l-4 ${c.border} border border-slate-100 ${c.bg} text-xs ${c.text} flex items-center gap-2`}>
      {status === "running" ? <Spinner /> : <span>🔗</span>}
      <span>{method || "GET"} {path}</span>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin shrink-0" />;
}

function extractPath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function extractJsonFromResult(result?: string): string {
  if (!result) return "{}";
  const paymentMatch = result.match(/PAYMENT_REQUIRED:\s*(.*)/s);
  if (paymentMatch) return paymentMatch[1];
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  return jsonMatch?.[0] || "{}";
}
