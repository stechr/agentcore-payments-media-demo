#!/usr/bin/env bash
# waf-smart-paywall.sh — Publisher-centric demo of the AWS WAF "Smart Paywall".
#
# Shows the DIFFERENTIATED-PRICING MATRIX (content tier x agent class) that the
# managed AWS WAF AI traffic monetization feature enforces at the edge for the
# Quillrook Press publisher (WafMerchantStack):
#
#   (a) prints the matrix (base price x content-tier x agent-class multiplier)
#   (b) drives the SAME content path as each SIMULATED agent class via curl with
#       an `x-demo-agent-class` header -> differentiated 402 price / Allow / 403
#   (c) runs the research agent against the WAF publisher (live content-tier pricing)
#   (d) shows RSL license discovery (the CloudFront `Link: rel=license` header)
#   (e) narrates analytics, settlement transparency, idempotency, settlement latency
#
# The `x-demo-agent-class` header is a SIMULATION of what Bot Control + Web Bot
# Auth classify in production (see docs/waf-monetization.md / README).
#
# Usage:
#   WAF_MERCHANT_URL=https://dxxxx.cloudfront.net ./demo/waf-smart-paywall.sh
#   # or rely on agent/.env (WAF_MERCHANT_URL). Without it, prints the matrix +
#   # the exact curl commands it WOULD run (useful before the foreground deploy).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../agent"
PYTHON="$AGENT_DIR/.venv/bin/python"

# Source agent/.env if present (for WAF_MERCHANT_URL + payment resources).
[ -f "$AGENT_DIR/.env" ] && source "$AGENT_DIR/.env" || true

WAF_URL="${WAF_MERCHANT_URL:-}"
BASE_PRICE="${BASE_PRICE:-0.002}"   # must match WafMerchantStack BaseMonetizePriceUsdc

bar() { printf '═%.0s' {1..71}; echo; }
hdr() { echo; bar; echo "  $1"; bar; echo; }

# ─────────────────────────────────────────────────────────────────────────────
# (a) The differentiated-pricing matrix (computed from base price x multipliers)
# ─────────────────────────────────────────────────────────────────────────────
hdr "Smart Paywall — differentiated pricing matrix (base \$$BASE_PRICE USDC)"
BASE_PRICE="$BASE_PRICE" python3 - <<'PY'
import os
base = float(os.environ["BASE_PRICE"])
# content tier -> path multiplier
tiers = [("/articles/", 1), ("/data/", 3), ("/premium/", 8)]
# agent class -> (action, class multiplier or None)
classes = [
    ("verified-crawler", "Allow", 0),
    ("known-agent",      "Monetize", 1),
    ("unverified",       "Monetize", 2),
    ("training",         "Block", None),
    ("human",            "pass-through", 0),
]
def cell(action, cmul, tmul):
    if action == "Allow":        return "free"
    if action == "pass-through": return "(no 402)"
    if action == "Block":        return "403"
    return f"${base*tmul*cmul:.3f}"
w = 18
print(f'{"agent class \\ tier":<{w}}' + "".join(f'{t:>12}' for t, _ in tiers) + "   action")
print("-" * (w + 12*len(tiers) + 11))
for name, action, cmul in classes:
    row = f'{name:<{w}}'
    for tpath, tmul in tiers:
        row += f'{cell(action, cmul, tmul):>12}'
    print(row + f'   {action}')
print()
print("PriceMultiplier on each WAF Monetize rule = content-tier x agent-class:")
print("  known-agent : articles=1  data=3  premium=8")
print("  unverified  : articles=2  data=6  premium=16")
print("verified-crawler=Allow, training=Block, human/no-header=pass-through.")
PY

if [ -z "$WAF_URL" ]; then
  echo
  echo "⚠️  WAF_MERCHANT_URL not set — printing the curl commands this demo WOULD run."
  echo "    Set WAF_MERCHANT_URL (cdk output WafMerchantUrl) to drive it live."
  WAF_URL="https://<WafMerchantUrl>"
  DRY=1
else
  DRY=0
fi

# helper: curl a path as a given simulated agent class, show status + decoded 402
probe() {
  local cls="$1" path="$2"
  local url="$WAF_URL$path"
  echo "── x-demo-agent-class: ${cls:-<none/human>}  →  GET $path"
  if [ "$DRY" = "1" ]; then
    echo "   curl -s -D - -o /dev/null ${cls:+-H \"x-demo-agent-class: $cls\"} \"$url\""
    return 0
  fi
  local hdrs
  hdrs=$(curl -s -D - -o /dev/null --max-time 20 --retry 1 \
    ${cls:+-H "x-demo-agent-class: $cls"} "$url" || echo "HTTP/2 000")
  local code
  code=$(printf '%s' "$hdrs" | awk 'toupper($1) ~ /HTTP/ {c=$2} END{print c}')
  echo "   → HTTP $code"
  # Decode the base64 x402 v2 `payment-required` header into a human-readable 402.
  local pr
  pr=$(printf '%s' "$hdrs" | awk 'BEGIN{IGNORECASE=1} /^payment-required:/ {sub(/^[^:]*:[ \t]*/,""); print; exit}' | tr -d '\r')
  if [ -n "$pr" ]; then
    echo "   payment-required (decoded x402 v2):"
    printf '%s' "$pr" | base64 -d 2>/dev/null | (jq . 2>/dev/null || cat) | sed 's/^/     /'
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# (b) Same content path, each simulated agent class → differentiated outcome
# ─────────────────────────────────────────────────────────────────────────────
hdr "(b) One premium path (/quillrook/premium/managed-paywall-economics.json), five agent classes"
PP="/quillrook/premium/managed-paywall-economics.json"
probe "verified-crawler" "$PP"   # → Allow (free, 200 after origin)
probe "known-agent"      "$PP"   # → 402 standard (base x 8)
probe "unverified"       "$PP"   # → 402 premium  (base x 16)
probe "training"         "$PP"   # → 403 Block
probe "human"            "$PP"   # → pass-through (Allow, no 402)

hdr "(b') Content-tier pricing for a known-agent across all three tiers"
probe "known-agent" "/quillrook/articles/edge-settlement-explained.json"   # base x 1
probe "known-agent" "/quillrook/data/agent-settlement-feed.json"           # base x 3
probe "known-agent" "$PP"                                                # base x 8

# ─────────────────────────────────────────────────────────────────────────────
# (d) RSL license discovery — the CloudFront Link: rel=license header
# ─────────────────────────────────────────────────────────────────────────────
hdr "(d) RSL license discovery (Link: rel=license header on origin responses)"
if [ "$DRY" = "1" ]; then
  echo "   curl -s -I \"$WAF_URL/quillrook/catalog.json\"   # look for the Link: rel=license header"
  echo "   curl -s \"$WAF_URL/quillrook/license.xml\"        # the RSL terms (free path)"
else
  echo "── Link header on a FREE origin response (catalog.json):"
  curl -s -I --max-time 20 --retry 1 "$WAF_URL/quillrook/catalog.json" 2>/dev/null \
    | awk 'BEGIN{IGNORECASE=1} /^link:/' | sed 's/^/   /' || echo "   (no Link header seen)"
  echo "── RSL terms (license.xml, free path):"
  curl -s --max-time 20 --retry 1 "$WAF_URL/quillrook/license.xml" 2>/dev/null | sed 's/^/   /' || true
  echo
  echo "   NOTE: the WAF 402 challenge does NOT carry the Link header — only origin"
  echo "   responses do (per the WAF license-terms doc)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# (c) Run the research agent against the WAF publisher (live content-tier pricing)
# ─────────────────────────────────────────────────────────────────────────────
hdr "(c) Research agent vs the WAF publisher (live content-tier pricing + payment)"
if [ "$DRY" = "1" ]; then
  echo "   WAF_MERCHANT_URL=$WAF_URL $PYTHON $AGENT_DIR/research_agent.py"
  echo "   (the agent sends no demo header → matched by the STANDARD monetize rules,"
  echo "    i.e. priced at the content-tier rate, then pays via the AgentCore plugin)"
elif [ -x "$PYTHON" ] && [ -f "$AGENT_DIR/research_agent.py" ]; then
  echo "Running the research agent (it discovers /quillrook/, hits content-tier 402s,"
  echo "and the AgentCore Payments plugin signs + retries). No demo header is sent,"
  echo "so the STANDARD monetize rules price it at the content-tier rate."
  echo
  WAF_MERCHANT_URL="$WAF_URL" "$PYTHON" "$AGENT_DIR/research_agent.py" || \
    echo "⚠️  agent run failed (payment grant / wallet not configured?) — see follow-ups."
else
  echo "⚠️  agent venv/script not found — skipping live agent run."
fi

# ─────────────────────────────────────────────────────────────────────────────
# (e) Narration: analytics, settlement transparency, idempotency, latency
# ─────────────────────────────────────────────────────────────────────────────
hdr "(e) What the managed feature gives the publisher (narration)"
cat <<'EOF'
  • ANALYTICS — WAF emits CloudWatch metrics per rule (monetize-content,
    class-*, bot-control) + sampled requests; revenue analytics show paid-request
    counts and settled amounts per tier/class. (Console screenshot ref:
    docs/waf-monetization.md → "Revenue analytics".)
  • SETTLEMENT TRANSPARENCY — a successful paid request returns a `payment-response`
    header with the on-chain settlement confirmation. AWS is NOT in the flow of
    funds: the client pays the publisher's wallet directly via the Coinbase x402
    facilitator. Failed origins (4xx/5xx) are NOT charged.
  • IDEMPOTENCY — authorizations are single-use; a `payment-identifier` lets an
    honest client retry a transient failure without double-paying.
  • LATENCY — paid requests add SEVERAL SECONDS (authorization verify + on-chain
    settlement). Requests that don't match Monetize, or carry no payment signature,
    are unaffected. Throttling is possible under abnormally high payment volume.
EOF
echo
bar
echo "  Smart Paywall demo complete."
bar
