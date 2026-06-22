import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WAF_URL = (process.env.WAF_MERCHANT_URL || "https://<YOUR_WAF_CLOUDFRONT_DOMAIN>").replace(/\/$/, "");

function decodeB64Json(s: string | null) {
  if (!s) return null;
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}

/**
 * Server-side probe of the live Quillrook WAF publisher edge. Runs from the
 * Next.js server (the allowlisted IP), so it avoids browser CORS and faithfully
 * reflects the WAF Monetize decision for a given content tier x agent class.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path") || "/quillrook/catalog.json";
  const agentClass = searchParams.get("class") || "";

  const headers: Record<string, string> = { Accept: "application/json" };
  if (agentClass) headers["x-demo-agent-class"] = agentClass;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(WAF_URL + path, { headers, signal: ctrl.signal, redirect: "manual" });
    clearTimeout(t);
    const status = resp.status;
    const pr = resp.headers.get("payment-required");
    const link = resp.headers.get("link");
    const challenge = decodeB64Json(pr);
    const accept = challenge?.accepts?.[0] || {};
    const amount = accept.amount ? parseInt(accept.amount, 10) : null;
    const outcome =
      status === 402 ? "monetize" : status === 403 ? "block" : status === 200 ? (pr ? "monetize" : "allow") : "other";
    let bodyText: string | null = null;
    if (searchParams.get("raw") === "1" && status === 200) {
      bodyText = (await resp.text()).slice(0, 2000);
    }
    return NextResponse.json({
      path, agentClass, status, outcome,
      price_usdc: amount != null ? amount / 1e6 : null,
      amount_units: accept.amount ?? null,
      payTo: accept.payTo ?? null,
      network: accept.network ?? null,
      asset: accept.asset ?? null,
      x402_version: challenge?.x402Version ?? null,
      link, has_license_link: !!(link && /rel="?license"?/.test(link)),
      body: bodyText,
    });
  } catch (e: any) {
    clearTimeout(t);
    return NextResponse.json({ path, agentClass, status: 0, outcome: "error", error: String(e?.message || e) }, { status: 200 });
  }
}
