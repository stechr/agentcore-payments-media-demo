# AgentCore Payments — Media Content Monetization PoC

AI agents paying for premium media content via x402 micropayments. End-to-end proof of concept showing both the **publisher side** (merchant paywall) and the **agent side** (autonomous buyer with budget controls).

> ⚠️ **All sample content is synthetic.** Merchant names, article text, metrics, and company references in this repository are entirely fictional. Any resemblance to real organizations is coincidental. This is a technical demonstration of the x402 payment protocol, not market research.

## The Problem

Publishers face a binary choice with AI agents: **block them** or **let them scrape for free**. There's no "pay per article" button for a research agent that needs content from multiple sources in a single task.

## The Solution

This PoC demonstrates a third path: agents pay per-article via [x402 micropayments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html), settling in milliseconds at fractions of a cent.

## Demo

[![Watch the demo](docs/diagrams/architecture.png)](https://schristoph.online/media/2026-06-03-building-agent-that-pays-demo.mp4)

> 🎬 **[Click to watch the 4-min demo video](https://schristoph.online/media/2026-06-03-building-agent-that-pays-demo.mp4)** — the agent discovers content, evaluates trust scores, makes autonomous purchase decisions, and synthesizes a research brief.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PUBLISHER (Merchant)                                        │
│                                                              │
│  S3 (articles) → CloudFront → Lambda@Edge (x402 paywall)   │
│                                                              │
│  • Free: catalog/index                                       │
│  • $0.003: standard articles                                 │
│  • $0.005: data feeds                                        │
│  • $0.01: premium research                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP 402 + price / X-PAYMENT header
┌──────────────────────────┴──────────────────────────────────┐
│  AGENT (Buyer)                                               │
│                                                              │
│  Strands Agent + AgentCore Payments Plugin                   │
│                                                              │
│  • Discovers content via catalog                             │
│  • Encounters 402 → plugin auto-pays via Coinbase wallet    │
│  • Reads content → synthesizes research brief               │
│  • Reports total spend                                       │
│                                                              │
│  Budget: $1.00 USDC session limit                           │
└─────────────────────────────────────────────────────────────┘
```

### Payment Flow (x402 Protocol)

```
Agent                    CloudFront/Lambda@Edge           Blockchain (Base L2)
  │                              │                              │
  │── GET /premium/article ─────►│                              │
  │◄── 402 + payment payload ────│                              │
  │                              │                              │
  │── [AgentCore checks budget] ─┤                              │
  │── [Signs payment via wallet]─┼─── USDC transfer ──────────►│
  │                              │                              │
  │── GET + X-PAYMENT header ───►│                              │
  │                              │── verify payment proof ──────►│
  │◄── 200 + article content ────│                              │
```

## Project Structure

```
agentcore-payments-media-poc/
├── merchant-stack/          # CDK — publisher infrastructure
│   ├── lib/                 # CDK stack definition
│   ├── lambda/x402-paywall/ # Lambda@Edge paywall logic
│   ├── sample-content/      # Mock media articles (3 tiers)
│   └── bin/                 # CDK app entry
├── agent/                   # Python — research agent
│   ├── research_agent.py    # Strands agent + payments plugin
│   ├── setup_payments.py    # Interactive setup helper
│   └── requirements.txt
└── docs/                    # Architecture diagrams
```

## Prerequisites

1. **AWS Account** with CDK bootstrapped in `us-east-1`
2. **Coinbase CDP Account** (free) — [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)
3. **Node.js 18+** and **Python 3.10+**
4. **AWS CLI** configured

## Setup Guide

### Step 1: Deploy the Merchant Stack

```bash
cd merchant-stack
npm install
npx cdk bootstrap  # if not already done
npx cdk deploy
```

Note the `DistributionUrl` output — this is your merchant endpoint.

### Step 1b (optional): Deploy the WAF-monetized publisher

This repo ships **two** independently-deployable publishers:

| Stack | Publisher(s) | Paywall | Notes |
|-------|--------------|---------|-------|
| `AgentCorePaymentsMediaMerchant` | mediatech / copperview / thornwick / kettlebrook | DIY Lambda@Edge, **structural-only** check | The original (Parts 1 & 2) |
| `AgentCorePaymentsWafMerchant` | **Quillrook Press** | Managed **AWS WAF AI traffic monetization** — verifies + settles on-chain at the edge | New (Part 3); see [docs/waf-monetization.md](docs/waf-monetization.md) |

Deploy whichever you want — **old**, **new**, or **both**:

```bash
cd merchant-stack
npm install
npx cdk bootstrap   # if not already done

# Old only (exactly as before):
npx cdk deploy AgentCorePaymentsMediaMerchant

# New only (managed WAF publisher):
npx cdk deploy AgentCorePaymentsWafMerchant \
  --parameters PayToWallet=0xYOUR_TESTNET_WALLET

# Both:
npx cdk deploy --all --parameters PayToWallet=0xYOUR_TESTNET_WALLET
```

WAF stack parameters: `PayToWallet` (USDC wallet, testnet), `BaseMonetizePriceUsdc`
(BASE price, default `0.002`; effective price = base × tier × class multiplier),
`AllowedIps` (demo IP allowlist), `RslLicenseUrl` (RSL `Link` header target,
default relative `/quillrook/license.xml`). Note the `WafMerchantUrl` output.

> ⚠️ The `Monetize` action / `MonetizationConfig` are days old and may not yet be
> in the CloudFormation schema. `cdk synth` always passes (L1 escape-hatch); if
> `cdk deploy` rejects `MonetizationConfig`, use the documented fallback
> `scripts/apply-waf-monetization.sh`. See [docs/waf-monetization.md](docs/waf-monetization.md).

### Smart Paywall — deploy in your account

`AgentCorePaymentsWafMerchant` is a full **Smart Paywall**: it prices **by content
tier × agent class** in one managed web ACL, and publishes machine-readable license
terms (RSL). The code is **real end-to-end** — your own funded + delegated Coinbase
wallet completes settlement.

**Differentiated-pricing matrix** (base `$0.002` USDC):

| agent class \ tier | `/articles/` ×1 | `/data/` ×3 | `/premium/` ×8 | action |
|---|---|---|---|---|
| verified-crawler | free | free | free | Allow |
| known-agent (×1) | $0.002 | $0.006 | $0.016 | Monetize |
| unverified (×2) | $0.004 | $0.012 | $0.032 | Monetize |
| training | 403 | 403 | 403 | Block |
| human / no-header | pass-through | pass-through | pass-through | Allow |

**Prerequisites**

- AWS account + CDK bootstrapped in `us-east-1` (CLOUDFRONT-scope WAF lives there).
- A Coinbase **CDP** wallet on Base Sepolia, funded from the [Circle faucet](https://faucet.circle.com), with a **WalletHub delegated-signing grant** (this is what lets the AgentCore Payments client sign settlements; the demo documents it but does not provision it for you).
- Your public IP for the demo allowlist.

**Deploy ONLY the WAF stack**

```bash
cd merchant-stack && npm install
npx cdk bootstrap   # if not already done
npx cdk deploy AgentCorePaymentsWafMerchant \
  --parameters PayToWallet=0xYOUR_TESTNET_WALLET \
  --parameters BaseMonetizePriceUsdc=0.002 \
  --parameters AllowedIps=YOUR.IP.ADDR.0/32
# note the WafMerchantUrl + WafLicenseUrl outputs
```

**Configure pricing & rules**

- **Base price** → `BaseMonetizePriceUsdc` param (→ `MonetizationConfig`, min `$0.001`, ≤3 dp).
- **Content-tier & agent-class multipliers** → the `PriceMultiplier` on each
  `Monetize` rule in `lib/waf-merchant-stack.ts` (effective = base × multiplier).
- **payTo wallet** → `PayToWallet` param.
- **Agent classes** → the simulation matches a self-asserted `x-demo-agent-class`
  header; for production swap to Bot Control `LabelMatchStatement` + Web Bot Auth
  (shown in code comments + [docs/waf-monetization.md](docs/waf-monetization.md)).
- **License (RSL)** → edit `sample-content/quillrook/license.xml`; the Link header is
  injected by the CloudFront `ResponseHeadersPolicy` (`RslLicenseUrl` param).

**Drive the matrix + run the agent**

```bash
WAF_MERCHANT_URL=<WafMerchantUrl> ./demo/waf-smart-paywall.sh
```

**Test → live**: defaults to `CurrencyMode: TEST` (Base Sepolia). Flip to `REAL` and
switch the chain to `BASE`/`SOLANA` for production — validate in TEST first.

> ⚠️ Settlement requires a **funded wallet with a WalletHub delegated-signing
> grant**. The matrix (Allow/Monetize/Block + the 402 prices) is fully observable
> without it via `curl`; the *on-chain settlement* step needs your own granted
> wallet. This is the one foreground prerequisite the demo cannot pre-provision.


### Agent deployment modes (which env var drives which)

The agent discovers **whichever** merchant URLs are set — no code changes:

| Mode | Env vars set | Agent behavior |
|------|--------------|----------------|
| **old-only** | `MERCHANT_URL` | Exactly as today — 4 Lambda publishers (no regression) |
| **new-only** | `WAF_MERCHANT_URL` | Only the WAF-monetized publisher (Quillrook Press) |
| **both** | `MERCHANT_URL` + `WAF_MERCHANT_URL` | Discovers + can pay across both distributions |

### Step 2: Get Coinbase CDP Credentials

1. Go to [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)
2. Create a new project
3. Generate an API key (save the key ID and secret)

### Step 3: Configure AgentCore Payments

```bash
cd agent
pip install -r requirements.txt
python setup_payments.py
```

This creates:
- Payment Manager (coordinates payment operations)
- Payment Connector (links to Coinbase CDP)
- Payment Instrument (embedded wallet)
- Payment Session ($1.00 budget, 1-hour expiry)

### Step 4: Fund the Wallet (Free — Testnet)

Get free testnet USDC:
1. Go to [faucet.circle.com](https://faucet.circle.com)
2. Select **Base Sepolia** network
3. Paste your wallet address (from setup script output)
4. Receive free testnet USDC (can request multiple times, no limit)

### Step 5: Run the Agent

```bash
source .env
export MERCHANT_URL=<DistributionUrl from Step 1>
# Optional — also discover the WAF-monetized publisher (Step 1b):
# export WAF_MERCHANT_URL=<WafMerchantUrl from Step 1b>

python research_agent.py
```

> ✅ Header-interop note (PROVEN 2026-06-17): the AgentCore Payments SDK
> (`bedrock-agentcore` 1.14.1) reads WAF's `payment-required` header, parses the
> x402 v2 challenge, and emits a `PAYMENT-SIGNATURE` request header — exactly what
> AWS WAF expects. **No mapping shim is needed**; the same agent pays both
> publishers. On-chain *settlement* is separately gated by a Coinbase WalletHub
> delegated-signing grant (KYC) — the agent reaches a real payment **attempt** then
> hits the expected grant gate. See [docs/waf-monetization.md](docs/waf-monetization.md).

Or with a custom topic:

```bash
export RESEARCH_TOPIC="How are publishers monetizing AI agent traffic?"
python research_agent.py
```

### Step 6: Run the Researcher UI (optional — AG-UI frontend)

The CLI above is headless. For the interactive Researcher UI (live reasoning + an HTTP/activity panel showing each 402/200 at the edge), run the **AG-UI backend** and the **Next.js frontend**:

```bash
# 1) AG-UI backend (FastAPI/uvicorn on :8000) — bridges the Strands agent to CopilotKit
cd ui/agent
uv sync                       # creates .venv + installs deps (ag-ui, strands, copilotkit, bedrock-agentcore)
set -a && source ../../agent/.env && set +a   # load PAYMENT_*/MERCHANT_URL/WAF_MERCHANT_URL
.venv/bin/uvicorn main:app --port 8000        # (prepend PATH for isengardcli if using SSO creds)

# 2) Frontend (Next.js on :3000) — in a second terminal
cd ui
npm install
echo "AGENT_URL=http://localhost:8000" > .env   # where the CopilotKit runtime reaches the agent
npm run build && npm start                       # or: npm run dev
```

Open <http://localhost:3000>, then click **🔍 Full Research** (or type a request in the chat). The agent fetches catalogs, queries the Trust Registry, applies the BUY/SKIP decision framework, and hits the live 402 paywalls — all streamed into the UI with the edge-activity panel on the right.

> **`.env` gotcha:** `RESEARCH_TOPIC` is a multi-word value — it **must be quoted** (`export RESEARCH_TOPIC="..."`), or `source .env` fails. Settlement additionally needs a non-expired `PAYMENT_SESSION_ID` (re-run `python setup_payments.py` if you see `PaymentSessionNotFound`).

## Sample Output

```
============================================================
Research Topic: What are the latest trends in AI agent traffic?
Merchant: https://d1234abcdef.cloudfront.net
============================================================

[Agent] Fetching content catalog...
[Agent] Found 6 articles. Selecting relevant ones...
[Agent] Purchasing: "Agent Traffic Report" ($0.01) ✓
[Agent] Purchasing: "Publisher Revenue Deep Dive" ($0.01) ✓
[Agent] Purchasing: "Streaming Wars Q2" ($0.003) ✓

Research Brief:
AI agent traffic now accounts for 23% of news site visits...
[synthesized findings]

Spend Report:
  - 3 articles purchased
  - Total: $0.023 USDC
  - Budget remaining: $0.977 / $1.00
============================================================
```

## Cost

| Component | Cost |
|-----------|------|
| AgentCore Payments (Preview) | Free |
| CloudFront | Free tier (1TB/month) |
| Lambda@Edge | Free tier (1M requests) |
| Bedrock model calls | ~$0.01-0.05 per research session |
| USDC (Base Sepolia testnet) | **Free** — from faucet.circle.com |
| Gas fees (Base Sepolia) | **Free** — testnet |

**Total PoC cost: $0** (only Bedrock model invocation costs apply, typically cents per session)

> **Note:** This PoC uses Base Sepolia testnet by default. Testnet USDC has zero monetary value.
> To switch to production (real money), change 3 variables — see "Going to Production" below.

## Customization

### Add Your Own Content

Drop JSON files into `merchant-stack/sample-content/` following the schema:

```json
{
  "id": "my-article",
  "title": "Article Title",
  "tier": "standard|premium|data",
  "price_usdc": 0.003,
  "content": "Full article text..."
}
```

### Adjust Pricing

Edit `merchant-stack/lambda/x402-paywall/index.js`:

```javascript
const PRICING = {
  "/articles/": 0.003,
  "/premium/": 0.01,
  "/data/": 0.005,
};
```

## Going to Production

To switch from testnet to real payments, change 3 values:

| File | Variable | Testnet | Production |
|------|----------|---------|------------|
| `lambda/x402-paywall/index.js` | `NETWORK` | `base-sepolia` | `base` |
| `lambda/x402-paywall/index.js` | `USDC_CONTRACT` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `agent/setup_payments.py` | `network` | `base-sepolia` | `base` |

Then fund the wallet with real USDC instead of using the faucet.

## Related Resources

- [AgentCore Payments Docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)
- [x402 Protocol Spec](https://www.x402.org/)
- [AWS Blog: x402 and Agentic Commerce](https://aws.amazon.com/blogs/industries/x402-and-agentic-commerce-redefining-autonomous-payments-in-financial-services/)
- [Blog: HTTP 402 — When Agents Pay](https://schristoph.online/blog/http-402-agents-pay/)
- [Merchant Sample (AWS)](https://github.com/aws-samples/sample-x402-content-monetization-with-cloudfront-and-waf)

## License

MIT-0
