# WAF AI Traffic Monetization — the managed publisher

This repo started with a hand-rolled paywall: a ~40-line Lambda@Edge
(`merchant-stack/lambda/x402-paywall/index.js`) that returns an x402
`402 Payment Required`, then waves the request through the moment a payment
header is *structurally* well-formed. It never verifies funds and never settles
on-chain (see `DESIGN.md` §12, "payment verification is structural only").

On 2026-06-15 AWS WAF shipped **AI traffic monetization**: a managed **Monetize**
rule action plus a **`MonetizationConfig`** on the web ACL that does the part the
Lambda skips — it verifies the signed payment authorization, fetches origin, and
**settles on-chain** via Coinbase's x402 facilitator, all at the edge.

`WafMerchantStack` (`merchant-stack/lib/waf-merchant-stack.ts`) is a second,
independently-deployable publisher built on that managed feature. The existing
`MerchantStack` is untouched and still deploys + works standalone.

## DIY Lambda vs managed WAF — at a glance

| | `MerchantStack` (existing) | `WafMerchantStack` (new) |
|---|---|---|
| Paywall | Lambda@Edge, ~40 lines you maintain | Managed WAF Monetize action |
| 402 response | Hand-built JSON body | Returned by WAF at the edge |
| Payment check | **Structural only** (header shape) | **Verifies** signed authorization |
| Settlement | None | **On-chain** via x402 facilitator |
| Charged when origin fails | Possible | No — settlement gated on 2xx origin |
| Replay protection | None | Single-use authorizations + payment-identifier |
| Publisher code to own | The whole function | Configuration only |
| Flagship publisher | mediatech / copperview / thornwick / kettlebrook | **Quillrook Press** |

The managed feature is the capability that closes the §12 gap. The trade is
bespoke control (you can encode anything in a Lambda) for a fixed, audited
protocol — usually the right trade when your moat is content, not payment plumbing.

## How the WAF publisher is wired

`WafMerchantStack` provisions:

- **Its own S3 content bucket + CloudFront distribution** — and crucially **no
  Lambda@Edge**. That absence is the point.
- **Its own WAF web ACL** (scope `CLOUDFRONT`, us-east-1), `DefaultAction: Allow`.
  As originally built it had three rules (IP gate / Bot Control / one flat
  `MonetizeContent`). It is now **enriched into a differentiated-pricing matrix**
  (content tier × agent class) — see the **"Smart Paywall — publisher guide"**
  section below for the full rule set, priorities, and `PriceMultiplier` scheme.
  In brief: priority 0 `BlockNonDemoIps` (outer demo gate), priority 1
  `AWSBotControl` (`OverrideAction: Count`, label-only), then agent-class gates
  (Allow/Block/pass-through) and the priced `Monetize` rules.
- A **`MonetizationConfig`** (TEST mode → Base Sepolia) holding the **base** price
  (`BaseMonetizePriceUsdc`, default `0.002`); per-tier/per-class prices come from
  the `PriceMultiplier` on each `Monetize` rule (effective = base × multiplier):

  ```json
  {
    "CurrencyMode": "TEST",
    "CryptoConfig": {
      "PaymentNetworks": [
        { "Chain": "BASE_SEPOLIA", "WalletAddress": "<payTo>", "Prices": [{ "Amount": "0.002", "Currency": "USDC" }] }
      ]
    }
  }
  ```

  `payTo` wallet, the base price, and the demo IP come from CDK parameters
  (`PayToWallet`, `BaseMonetizePriceUsdc`, `AllowedIps`). Flip `CurrencyMode` to
  `REAL` and switch the chain to `BASE`/`SOLANA` for production.

### Request lifecycle (managed)

1. Agent requests a monetized path on the WAF distribution.
2. WAF returns `402 Payment Required` with price, accepted networks, and `payTo`.
3. Agent signs an authorization and resubmits with a `payment-signature` header.
4. WAF **verifies** the authorization (synchronously, in the request path).
5. On success, origin is fetched; on a 2xx, the payment is **settled on-chain**.
6. Content is served with a `payment-response` settlement-confirmation header.
7. Failed origins (4xx/5xx) are **not charged**.

## ⚠️ CFN-coverage caveat (escape-hatch)

The `Monetize` rule action and `MonetizationConfig` are days old and are **not yet
typed in the CDK `CfnWebACL` construct**, and may **not yet be in the
CloudFormation `AWS::WAFv2::WebACL` schema**. The stack injects both via L1
**escape-hatch** (`addPropertyOverride`):

- The **entire `Rules` array** is injected as one override. This is required:
  `Monetize` is `{ Monetize: {} }` (an empty object), and CDK's `deepMerge` prunes
  empty leaf objects from property overrides — *unless* they sit inside an array,
  which deepMerge assigns verbatim. Supplying all rules as one array keeps
  `Monetize: {}` intact.
- `MonetizationConfig` is injected as a top-level property override.

`cdk synth` **succeeds** regardless, because escape-hatch injection is raw template
construction — it is **not** validated against the live CloudFormation schema at
synth time. The coverage gap (if any) only surfaces at `cdk deploy`.

**Fallback if `cdk deploy` rejects the property:** deploy the stack with the
`MonetizationConfig` override commented out, then run
[`scripts/apply-waf-monetization.sh`](../scripts/apply-waf-monetization.sh) to set
it via the `wafv2` API after deploy. Note that this CLI path is **also unverified**
for a 2-day-old feature — the installed AWS CLI may not yet expose
`--monetization-config`; if so, upgrade the CLI or set it in the WAF console.
**Confirming which path works is a foreground, live-deploy task.**

## ✅ Header interop: `X-PAYMENT` vs `payment-signature` — PROVEN (2026-06-17)

This was the #1 unknown when the WAF publisher was first built. It is now
**resolved: the AgentCore Payments SDK interops with WAF natively, no shim.**

Verified on 2026-06-17 with **`bedrock-agentcore` 1.14.1**: the SDK
- **reads WAF's `payment-required` response header** (the x402 v2 challenge WAF
  returns on a 402),
- **parses the x402 v2 challenge**, signs an authorization, and
- **emits a `PAYMENT-SIGNATURE` request header** on the retry — exactly the header
  AWS WAF's verifier expects.

So there is **no header-name mismatch to bridge** and **no CloudFront Function /
client-side mapping shim** required. The same research agent that pays the DIY
Lambda publishers also drives the WAF publisher's 402 → sign → retry loop directly.

> **What is NOT proven yet:** actual on-chain **settlement**. Settlement is gated by
> a **Coinbase WalletHub delegated-signing grant** (KYC-walled), which is parked.
> So the agent gets as far as a real, WAF-accepted payment **attempt** and then hits
> `AccessDeniedException: Delegated signing grant…` — the expected, documented gate,
> **not** an interop failure. A viewer with their own granted wallet completes the
> settlement. See PHASE 3 validation note and the README go-live section.

## See also

- AWS docs: [AI traffic monetization](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization.html),
  [how it works](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-how-it-works.html),
  [getting started](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-getting-started.html)
- [x402 protocol](https://docs.x402.org/introduction)
- `DESIGN.md` §12 — the structural-only limitation this feature closes

---

# Smart Paywall — publisher guide (differentiated pricing + license terms)

> [!info] Verified against AWS docs (2026-06-17)
> [Pricing configuration](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-pricing.html)
> and [Communicating license terms to AI agents](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-license-terms.html).

The base `WafMerchantStack` returns one flat price for any monetized path. A real
publisher prices **differently by what the content is** *and* **who is asking**.
The managed feature supports both, and `WafMerchantStack` is enriched to a
**two-dimensional pricing matrix**:

```
effective_price = base_price  x  content_tier_multiplier  x  agent_class_multiplier
```

## The matrix (as built)

Base price `$0.002` USDC (CDK param `BaseMonetizePriceUsdc`, min `$0.001`, <=3 dp).

| agent class \ content tier | `/articles/` x1 | `/data/` x3 | `/premium/` x8 | action |
|---|---|---|---|---|
| **verified-crawler** | free | free | free | `Allow` |
| **known-agent** (x1) | $0.002 | $0.006 | $0.016 | `Monetize` |
| **unverified** (x2) | $0.004 | $0.012 | $0.032 | `Monetize` |
| **training** | 403 | 403 | 403 | `Block` |
| **human** / no-header | pass-through (no 402) | pass-through | pass-through | default `Allow` |

This single web ACL exercises **every action** the feature offers — `Allow`,
`Monetize`, `Block`, `Count` (Bot Control, label-only), and pass-through.

## How `PriceMultiplier` expresses the matrix

The base price lives once in `MonetizationConfig`. The per-cell price is the
**`PriceMultiplier`** on each `Monetize` rule action — *effective = base x
multiplier* (AWS docs, "Price multipliers"). The matrix collapses the two
dimensions into one multiplier per rule:

```jsonc
// content tier x agent class -> PriceMultiplier
{ "Action": { "Monetize": { "PriceMultiplier": "8"  } } }  // StandardPremium  (x8 * known-agent x1)
{ "Action": { "Monetize": { "PriceMultiplier": "16" } } }  // UnverifiedPremium (x8 * unverified x2)
```

Injected via the same L1 escape-hatch as the base stack (the whole `Rules` array +
`MonetizationConfig` as overrides). `cdk synth` passes for both stacks.

### Rule ordering (because `Monetize` is terminating)

Per the AWS docs, `Monetize` is a **terminating** action — when it matches, WAF
stops evaluating and returns the 402. So precedence is encoded by priority:

| Priority | Rule | Action | Why here |
|---|---|---|---|
| 0 | `BlockNonDemoIps` | Block | outer demo IP gate |
| 1 | `AWSBotControl` | Count (label-only) | classify, don't block |
| 10 | `ClassHumanPassThrough` | Allow | humans never see a 402 |
| 11 | `ClassTrainingBlock` | Block | no training crawlers |
| 12 | `ClassVerifiedCrawlerAllow` | Allow | free referral crawlers |
| 20-22 | `Unverified{Premium,Data,Articles}` | Monetize x16/6/2 | premium-priced unknown agents |
| 30-32 | `Standard{Premium,Data,Articles}` | Monetize x8/3/1 | known-agent / unclassified bot |

The `Standard*` rules carry **no agent-class condition**, so they catch both an
explicit `known-agent` and a request with **no demo header** (e.g. the live
research agent) — both pay the content-tier price. The earlier (lower-priority-
number) class gates terminate first, so `verified-crawler`/`training`/`human`/
`unverified` win over the standard fall-through.

## Agent-class differentiation — simulation vs production

**Simulation (the active rules).** Agent class is read from a self-asserted
request header `x-demo-agent-class: verified-crawler | known-agent | unverified |
training | human`, matched with a `ByteMatchStatement` on `SingleHeader`. A viewer
drives the whole matrix from `curl` with no Bot Control needed:

```bash
curl -H "x-demo-agent-class: training"          <url>/quillrook/premium/...   # -> 403
curl -H "x-demo-agent-class: verified-crawler"   <url>/quillrook/premium/...   # -> 200 (free)
curl -H "x-demo-agent-class: unverified"         <url>/quillrook/premium/...   # -> 402 ($0.032)
curl -H "x-demo-agent-class: known-agent"        <url>/quillrook/premium/...   # -> 402 ($0.016)
curl                                             <url>/quillrook/premium/...   # -> 402 ($0.016, standard)
```

> The `x-demo-agent-class` header is a **SIMULATION** of production classification.
> It is self-asserted and trivially spoofable — never use a self-asserted header
> for real pricing.

**Production (documented, not relied on here).** Replace each header `ByteMatch`
with a `LabelMatchStatement` on AWS WAF **Bot Control** labels, plus **Web Bot
Auth** signatures for the verified/known distinction:

```jsonc
// production: monetize only bot-labeled traffic; humans (no label) pass through
{
  "Name": "MonetizeBotTrafficOnly",
  "Statement": { "LabelMatchStatement": {
    "Scope": "LABEL", "Key": "awswaf:managed:aws:bot-control:bot" } },
  "Action": { "Monetize": { "PriceMultiplier": "8" } }
}
```

Verified search crawlers get verified-bot sub-labels (-> `Allow`); known agents
prove identity via Web Bot Auth request signatures (-> standard `Monetize`);
unlabeled/unverified bots get the premium multiplier; training crawlers are
identified by category and `Block`ed. Note the inversion: in **production**,
*no label = human = pass-through*; the simulation defaults *no header = standard
monetize* because the demo's subject is the paying agent (use
`x-demo-agent-class: human` to see the production human path).

## License terms (RSL)

Monetization says *how much*; it does not say *what you may do with the content*.
**RSL (Really Simple Licensing)** communicates machine-readable usage terms. The
demo wires it two ways:

- `sample-content/quillrook/license.xml` — synthetic RSL terms: **permits**
  read / inference / search-indexing, **prohibits** train / fine-tune /
  redistribute. Served from a **free** path so any agent can read it before paying.
- A **CloudFront `ResponseHeadersPolicy`** (`RslLinkHeaderPolicy`) injects
  `Link: </quillrook/license.xml>; rel="license"; type="application/rsl+xml"` on
  every **origin** response. (Relative by default to avoid a circular dependency on
  the distribution domain; set `RslLicenseUrl` to an absolute https URL to match
  the doc example verbatim.)
- `sample-content/robots.txt` — RSL `License:` directive for crawl-preflight
  discovery.

> **The 402 does not carry the `Link` header** — only origin (2xx) responses do
> (AWS docs). An agent discovers terms on a *free* fetch (catalog/robots/license),
> then decides whether to pay for the monetized resource.

## Test mode -> go-live

`MonetizationConfig.CurrencyMode` defaults to **`TEST`** (Base Sepolia testnet),
so the whole matrix is exercisable at zero cost. To go live:

1. Flip `CurrencyMode` to **`REAL`**.
2. Switch `CryptoConfig.PaymentNetworks[].Chain` to **`BASE`** / **`SOLANA`** (from
   `BASE_SEPOLIA`) and set a production `WalletAddress` (CDK param `PayToWallet`).
3. Validate the matrix in `TEST` first — the docs explicitly recommend Test mode to
   confirm policies produce expected results before enabling live monetization.

## Analytics, settlement, idempotency, latency

- **Analytics** — per-rule CloudWatch metrics (`monetize-content`, `class-*`,
  `bot-control`) + sampled requests; revenue analytics show paid-request counts and
  settled amounts per tier/class.
- **Settlement transparency** — a paid 2xx returns a `payment-response` header with
  the on-chain confirmation. **AWS is not in the flow of funds**: the client pays
  the publisher wallet directly via the Coinbase x402 facilitator. Failed origins
  (4xx/5xx) are **not** charged.
- **Idempotency** — single-use authorizations; a `payment-identifier` lets honest
  clients retry a transient failure without double-paying.
- **Latency** — paid requests add **several seconds** (verify + on-chain settle);
  non-monetized or signature-less requests are unaffected. High payment volume may
  be throttled (retry with backoff).

## Drive it

```bash
WAF_MERCHANT_URL=https://<WafMerchantUrl> ./demo/waf-smart-paywall.sh
```

Prints the matrix, drives each simulated agent class against one premium path,
shows content-tier pricing for a known-agent across all three tiers, demonstrates
RSL discovery (the `Link` header + `license.xml`), runs the research agent against
the WAF publisher, and narrates analytics/settlement/idempotency/latency. Decodes
the base64 x402 v2 `payment-required` header so the prices are human-readable.
