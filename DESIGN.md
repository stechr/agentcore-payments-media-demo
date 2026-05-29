# Design Document — AgentCore Payments Media Content PoC

## 1. Problem Statement

Publishers face a binary choice with AI agents: **block them** (losing potential revenue) or **let them scrape for free** (losing content value). There's no "pay per article" mechanism for a research agent that needs content from multiple sources in a single task.

Meanwhile, agents lack the ability to:
- Evaluate whether paid content is worth the price
- Compare competing providers on trust, quality, and cost
- Enforce spending limits autonomously
- Provide feedback that improves future purchasing decisions

## 2. Solution Overview

This PoC demonstrates **autonomous agent commerce** — an AI research agent that discovers, evaluates, purchases, and rates content from multiple competing publishers using x402 micropayments settled on-chain in milliseconds.

The system shows both sides of the marketplace:
- **Publisher side**: A multi-merchant content platform with per-article paywalls
- **Agent side**: A research agent with budget controls, trust evaluation, and quality feedback

## 3. Architecture

### 3.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PUBLISHER LAYER (AWS — single CloudFront distribution)                  │
│                                                                          │
│  S3 (content)  →  CloudFront  →  Lambda@Edge (x402 paywall)            │
│                                                                          │
│  Path-based merchants:                                                   │
│    /mediatech/     Premium    $0.008–0.015   Trust 4.8/5                │
│    /copperview/     Budget     $0.001–0.003   Trust 2.1/5                │
│    /thornwick/   New        $0.005–0.008   Trust N/A                  │
│    /kettlebrook/ Mid-tier   $0.004–0.006   Trust 3.5/5                │
│                                                                          │
│  WAF WebACL: IP-restricted (demo only)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  SUPPORT SERVICES                                                        │
│                                                                          │
│  Trust Registry API (API Gateway + Lambda)                               │
│    GET /merchants                    → all merchants with scores         │
│    GET /merchants/{id}/reputation    → detailed reputation data          │
│    GET /merchants/{id}/history       → recent transaction outcomes       │
│                                                                          │
│  Feedback Service API (API Gateway + Lambda)                             │
│    POST /feedback                    → agent submits quality rating      │
│    GET  /feedback/{merchantId}       → view ratings for a merchant       │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP 402 (x402 payment required)
                              │ HTTP 200 (after payment verified)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT LAYER                                                             │
│                                                                          │
│  Strands Agent (Claude via Bedrock)                                      │
│    + AgentCore Payments Plugin (auto-handles 402 → sign → retry)        │
│    + http_request tool (makes HTTP calls, triggers payment flow)         │
│                                                                          │
│  AgentCore Payments Resources:                                           │
│    PaymentManager  → coordinates all payment operations                  │
│    PaymentConnector (CoinbaseCDP) → links to wallet provider            │
│    PaymentInstrument (embedded wallet) → holds USDC on Base Sepolia     │
│    PaymentSession ($1.00 budget, 8h expiry) → enforces spending cap     │
│                                                                          │
│  Decision Framework (in system prompt):                                  │
│    1. Trust Check    → query Trust Registry                              │
│    2. Relevance      → evaluate preview against research goal            │
│    3. Quality Signals → freshness, citations, methodology                │
│    4. Cost-Benefit   → quality-adjusted price comparison                 │
│    5. Decision       → BUY / SKIP / TRIAL                               │
│    6. Post-purchase  → rate via Feedback Service                         │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ EIP-3009 transferWithAuthorization
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BLOCKCHAIN LAYER (Base Sepolia L2 — testnet, $0 cost)                   │
│                                                                          │
│  USDC Token Contract: 0x036CbD53842c5426634e7929541eC2318f3dCF7e        │
│  Agent Wallet: 0x3db4C074379036659269a686392BE6b4CF67eaC4               │
│  Settlement: ~2 seconds (1 block confirmation)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Payment Flow (x402 Protocol)

```
Agent                    CloudFront + Lambda@Edge        Base Sepolia (L2)
  │                              │                              │
  │── GET /mediatech/premium/    │                              │
  │   article.json ────────────►│                              │
  │                              │                              │
  │◄── 402 Payment Required ─────│                              │
  │    Body: {x402Version: 1,    │                              │
  │     accepts: [{scheme,       │                              │
  │     network, amount,         │                              │
  │     payTo, asset}]}          │                              │
  │                              │                              │
  │── [Plugin intercepts 402] ───┤                              │
  │── [Validates budget] ────────┤                              │
  │── [Signs EIP-3009 auth] ─────┼── transferWithAuth ────────►│
  │── [Waits 3s for block] ──────┤                              │
  │                              │                              │
  │── GET + X-PAYMENT header ───►│                              │
  │   (base64 signed proof)      │── verify proof ────────────►│
  │                              │◄── confirmed ────────────────│
  │◄── 200 + article content ────│                              │
  │                              │                              │
  │── [Agent reads content] ─────┤                              │
  │── POST /feedback ───────────►│ (Feedback Service)           │
```

### 3.3 Component Responsibilities

| Component | Responsibility | Inputs | Outputs |
|-----------|---------------|--------|---------|
| **CloudFront Distribution** | Edge delivery of content; TLS termination; caching | HTTP requests from agents | Cached responses or origin fetch |
| **Lambda@Edge (x402 Paywall)** | Payment gate — blocks unpaid requests, returns x402 payment requirements, verifies payment proofs | Viewer requests (with or without X-PAYMENT header) | 402 + payment payload OR pass-through to S3 origin |
| **S3 Content Bucket** | Stores article JSON files organized by merchant path | Origin requests from CloudFront | Article content (JSON) |
| **WAF WebACL** | Network-level access control — restricts to demo IPs only | All inbound requests | ALLOW (allowlisted) or BLOCK (everyone else) |
| **Trust Registry API** | Serves merchant reputation data for agent decision-making | GET requests with merchantId | Reputation scores, transaction history, badges, warnings |
| **Feedback Service API** | Accepts and stores post-purchase quality ratings | POST with rating data | Acknowledgment; updates trust scores |
| **Strands Agent** | Orchestrates the research workflow — discovers, evaluates, purchases, synthesizes | Research topic + system prompt with decision framework | Research brief + spending report |
| **AgentCore Payments Plugin** | Intercepts 402 responses, generates payment headers, retries with proof | 402 response from any tool | Signed X-PAYMENT header; automatic retry |
| **PaymentManager** | Coordinates payment operations — instrument lookup, session validation, payment signing | Plugin API calls | Signed EIP-3009 authorization; budget checks |
| **PaymentConnector (CoinbaseCDP)** | Links AgentCore to the wallet provider's signing infrastructure | Signing requests from PaymentManager | Cryptographic signatures for on-chain transfers |
| **PaymentInstrument** | Represents the agent's on-chain wallet — holds USDC, signs transactions | Balance queries, transfer authorizations | Wallet address, balance, signed transfers |
| **PaymentSession** | Enforces spending limits and session lifetime | Payment requests | Budget validation (approve/reject); remaining balance |

### 3.4 Technology Choices & Rationale

#### Why CloudFront + Lambda@Edge (not API Gateway + Lambda)

| Consideration | CloudFront + Lambda@Edge | API Gateway + Lambda |
|---------------|--------------------------|---------------------|
| Latency | <1ms added at edge (runs in viewer request) | 10-50ms cold start + regional hop |
| Caching | Built-in — free content (catalogs) cached globally | Requires separate caching layer |
| x402 fit | Paywall is a request interceptor — perfect for edge function pattern | Would work but adds unnecessary API layer |
| Cost at scale | $0 for cached requests; Lambda@Edge only runs on cache misses or paywalled paths | Every request invokes Lambda |
| Real-world analogy | This is how CDNs work — content delivery with access control at the edge | Over-engineered for static content serving |

**Rejected alternative**: API Gateway was considered but adds latency and cost for what is fundamentally a content delivery + access control problem. Lambda@Edge is the natural pattern for "check credentials before serving content."

#### Why Strands Agents (not LangChain, CrewAI, or raw Bedrock)

| Consideration | Strands | LangChain | CrewAI | Raw Bedrock API |
|---------------|---------|-----------|--------|-----------------|
| AgentCore Payments plugin | ✅ Native, first-party | ❌ Would need custom integration | ❌ No support | ❌ Manual implementation |
| AWS-native | ✅ Built by AWS, optimized for Bedrock | ⚠️ Works but not optimized | ⚠️ Works but not optimized | ✅ Direct |
| Plugin system | ✅ Hooks (before/after tool call) — perfect for payment interception | ⚠️ Callbacks exist but different pattern | ❌ No equivalent | ❌ Manual |
| Complexity | Low — single Agent class, tools as functions | High — chains, agents, memory, retrievers | Medium — roles, tasks, crews | Lowest but most manual |
| Deployment to AgentCore Runtime | ✅ Native support | ❌ Requires wrapper | ❌ Requires wrapper | ✅ With custom code |

**Rejected alternatives**:
- **LangChain**: No native AgentCore Payments plugin. Would require building the 402-interception logic from scratch.
- **CrewAI**: Multi-agent framework adds complexity without benefit — this is a single-agent use case.
- **Raw Bedrock**: Would work but requires manually implementing the 402 → sign → retry loop that the plugin handles automatically.

#### Why Base Sepolia / USDC (not Ethereum mainnet, Solana, or fiat)

| Consideration | Base Sepolia (chosen) | Ethereum Mainnet | Solana | Fiat (Stripe) |
|---------------|----------------------|------------------|--------|---------------|
| Transaction cost | $0 (testnet) | $0.50-5.00 per tx | $0.001 per tx | 2.9% + $0.30 |
| Settlement time | ~2 seconds | ~12 seconds | ~0.4 seconds | Days (chargebacks) |
| Micropayment viable | ✅ $0.003 articles work | ❌ Gas > article price | ✅ | ❌ Minimum $0.50 |
| AgentCore support | ✅ Supported | ✅ Supported | ✅ Supported | ❌ Not yet (roadmap) |
| Production path | Change 3 variables → Base mainnet | Same but expensive | Different wallet type | Waiting for AgentCore fiat rails |
| Demo safety | ✅ Zero monetary risk | ❌ Real money | ❌ Real money | ❌ Real money |

**Rejected alternatives**:
- **Ethereum mainnet**: Gas fees ($0.50+) exceed article prices ($0.003-0.015). Economically nonsensical for micropayments.
- **Solana**: Viable for production but AgentCore's Coinbase CDP connector is more mature for EVM chains. Would require different wallet setup.
- **Fiat/Stripe**: Not supported by AgentCore Payments today. On the roadmap (per AgentCore PM) but not available. Also, traditional payment rails have minimum transaction sizes that make micropayments impossible.

#### Why Coinbase CDP (not self-custodial wallet or Stripe/Privy)

| Consideration | Coinbase CDP (chosen) | Self-custodial | Stripe/Privy |
|---------------|----------------------|----------------|--------------|
| Embedded wallet | ✅ AgentCore provisions wallet automatically | ❌ Must manage keys yourself | ✅ Also embedded |
| Key management | Managed by Coinbase (MPC) | Developer responsibility | Managed by Privy |
| Testnet support | ✅ Full Base Sepolia support | ✅ | ⚠️ Limited testnet |
| AgentCore integration | ✅ First-class connector | ❌ Not supported | ✅ Supported |
| Setup complexity | Medium (API key + wallet secret) | High (key generation, secure storage) | Medium |
| Production readiness | ✅ Coinbase is regulated, insured | ⚠️ Security burden on developer | ✅ |

**Rejected alternatives**:
- **Self-custodial**: AgentCore doesn't support raw private key wallets. Would bypass the managed security model.
- **Stripe/Privy**: Viable alternative but Coinbase CDP has better documentation and the official AWS samples use it. Both are supported by AgentCore.

#### Why x402 Protocol (not custom API keys, OAuth, or subscription)

| Consideration | x402 (chosen) | API Keys | OAuth | Subscription |
|---------------|---------------|----------|-------|--------------|
| Per-request pricing | ✅ Native — price in every 402 response | ❌ Pre-negotiated flat rate | ❌ Access-based, not usage-based | ❌ Flat monthly fee |
| No pre-registration | ✅ Agent discovers price at request time | ❌ Must register, get key, agree to terms | ❌ Must register app, get tokens | ❌ Must sign contract |
| Multi-merchant | ✅ Same protocol works across all publishers | ❌ Different key per publisher | ❌ Different OAuth flow per publisher | ❌ Different contract per publisher |
| Machine-readable | ✅ Structured JSON payload with price, asset, network | ⚠️ Varies by provider | ⚠️ Varies by provider | ❌ Human contracts |
| Standards-based | ✅ HTTP 402 (RFC 7231) + x402.org spec | ❌ Proprietary per provider | ✅ OAuth 2.0 standard | ❌ Proprietary |

**Rejected alternatives**:
- **API Keys**: Require pre-registration and bilateral agreements. An agent can't discover and pay a new publisher in the same session.
- **OAuth**: Solves authentication, not payment. Doesn't encode price or enable per-request billing.
- **Subscriptions**: Don't work for agents that need 3 articles from publisher A and 1 from publisher B in a single task. Over-commits budget.

#### Why a Trust Registry (not just price comparison)

**Problem**: Without trust signals, a rational agent always buys the cheapest option. But cheap content is often low-quality, stale, or fraudulent. The agent needs a way to assess value beyond price.

**Design choice**: Separate Trust Registry service (not embedded in the paywall) because:
1. **Independence**: Trust data should come from a neutral source, not the merchant itself
2. **Composability**: Multiple agents can share the same trust infrastructure
3. **Feedback loop**: Post-purchase ratings update trust scores for future sessions
4. **Extensibility**: Could integrate with on-chain reputation protocols (e.g., EAS attestations) in production

**Rejected alternative**: Embedding reputation in the 402 response (merchant self-reporting). This is like asking a used car dealer "is this car reliable?" — the incentive is to always say yes.

## 4. Decision Framework

The agent's system prompt encodes a 5-step decision framework that it must apply to every potential purchase:

### Step 1: Trust Check
```
Query: GET {trust_registry}/merchants/{merchantId}/reputation

Rules:
  trust > 4.0       → PROCEED (reliable)
  trust 2.5–4.0     → PROCEED WITH CAUTION (only if cheap or unique)
  trust < 2.5       → SKIP (unreliable, high dispute rate)
  trust = null      → TRIAL (max 1 article to evaluate)
```

### Step 2: Relevance Check
```
Evaluate preview (title, abstract, keywords) against research goal:
  High relevance    → +2 points
  Medium relevance  → +1 point
  Low relevance     → SKIP regardless of price
```

### Step 3: Quality Signals
```
Check metadata from 402 response:
  publishedDate > 30 days old  → discount value by 50%
  citationCount > 5            → strong quality signal
  publisherVerified = false    → trust penalty (-0.5)
  methodology hierarchy:
    primary-research > industry-analysis > secondary-aggregation > opinion-piece
```

### Step 4: Cost-Benefit Analysis
```
quality_adjusted_price = price / (trust_score / 5.0)

Rules:
  - Cheaper alternative with similar quality exists → buy cheaper
  - Premium 3x price but 4.8 trust vs 2.1 trust → premium is better value
  - Never spend >30% of remaining budget on single article
```

### Step 5: Decision
```
Format: DECISION: [BUY/SKIP/TRIAL] | Merchant: X | Article: Y | Price: $Z | Reason: ...
```

## 5. Merchant Personas

| Merchant | Positioning | Price Range | Trust | Behavior | Demo Purpose |
|----------|-------------|-------------|-------|----------|--------------|
| **MediaTech Daily** | Premium publisher | $0.008–0.015 | 4.8/5 (203 txns) | Always delivers quality | Shows "expensive but worth it" |
| **Copperview** | Budget aggregator | $0.001–0.003 | 2.1/5 (156 txns) | Cheap but unreliable | Shows "cheap ≠ good value" |
| **Thornwick Research** | New entrant | $0.005–0.008 | N/A (3 txns) | Good quality, no track record | Shows "trial purchase" logic |
| **Kettlebrook Analytics** | Mid-tier | $0.004–0.006 | 3.5/5 (82 txns) | Decent, occasional misses | Shows "good enough" reasoning |

## 6. Security Model

### Network Security
- **WAF WebACL**: Default BLOCK action — only allowlisted IPs can reach the merchant
- **IPv6 disabled**: Simplifies IP allowlisting
- **HTTPS only**: CloudFront redirects HTTP → HTTPS

### Payment Security
- **Budget enforcement**: PaymentSession hard cap ($1.00) — cannot be exceeded
- **Session expiry**: 8-hour maximum lifetime
- **Wallet isolation**: Embedded wallet per user — no shared keys
- **Testnet isolation**: Base Sepolia has zero monetary value
- **IAM scoping**: Service role with minimal permissions for AgentCore operations

### Access Control
- **IAM authentication**: SigV4 for all AgentCore API calls
- **User scoping**: All payment resources (instruments, sessions) are scoped to a userId
- **Credential storage**: Coinbase CDP credentials stored via AgentCore Identity (Secrets Manager)

## 7. Data Flow

### Content Discovery
```
Agent → GET /mediatech/catalog.json → 200 (free, no paywall)
Agent → GET /copperview/catalog.json → 200 (free)
Agent → GET /thornwick/catalog.json → 200 (free)
Agent → GET /kettlebrook/catalog.json → 200 (free)
```

### Trust Evaluation
```
Agent → GET /merchants/mediatech-daily/reputation → {trustScore: 4.8, ...}
Agent → GET /merchants/copperview/reputation → {trustScore: 2.1, ...}
```

### Purchase (automated by plugin)
```
Agent → GET /mediatech/premium/article.json → 402
Plugin → generate_payment_header() → signs EIP-3009
Plugin → GET + X-PAYMENT header → 200 + content
```

### Feedback
```
Agent → POST /feedback {merchantId, articleId, rating: 5, reason: "...", useful: true}
```

## 8. Technology Summary

See **Section 3.4** for detailed rationale on each technology choice. Quick reference:

| Component | Technology |
|-----------|-----------|
| Content hosting | CloudFront + S3 |
| Paywall | Lambda@Edge |
| APIs | API Gateway HTTP + Lambda |
| Agent framework | Strands Agents |
| Payment orchestration | AgentCore Payments |
| Wallet provider | Coinbase CDP |
| Blockchain | Base Sepolia (L2) |
| Stablecoin | USDC |
| IaC | AWS CDK (TypeScript) |

## 9. Deployment

### AWS Resources Created

| Resource | Service | Purpose |
|----------|---------|---------|
| Content Bucket | S3 | Stores article JSON files |
| Distribution | CloudFront | Edge delivery + paywall |
| X402 Paywall | Lambda@Edge | Payment gate |
| Trust Registry | API Gateway + Lambda | Reputation data |
| Feedback Service | API Gateway + Lambda | Quality ratings |
| WAF WebACL | WAF v2 | IP restriction |
| Payment Manager | AgentCore | Payment coordination |
| Payment Connector | AgentCore | Coinbase CDP link |
| Payment Instrument | AgentCore | Embedded wallet |
| Payment Session | AgentCore | Budget enforcement |
| Service Role | IAM | AgentCore permissions |

### Account & Region
- **Account**: Your AWS account (us-east-1, with CDK bootstrapped)
- **Region**: us-east-1 (required for Lambda@Edge + AgentCore Payments preview)

## 10. What's AWS vs What's Custom

| Component | Provider | Status |
|-----------|----------|--------|
| Payment Manager, Connector, Instrument, Session | **AWS (AgentCore Payments)** | Preview |
| x402 payment signing & settlement | **AWS (AgentCore Payments)** | Preview |
| Budget enforcement | **AWS (AgentCore Payments)** | Preview |
| Strands Agent framework | **AWS (open source)** | GA |
| AgentCore Payments Plugin for Strands | **AWS (SDK)** | Preview |
| CloudFront + Lambda@Edge paywall | **Custom (CDK)** | PoC |
| Trust Registry | **Custom (Lambda)** | PoC — no AWS equivalent exists |
| Feedback Service | **Custom (Lambda)** | PoC — no AWS equivalent exists |
| Decision Framework (agent prompt) | **Custom (prompt engineering)** | PoC |
| Merchant content | **Custom (S3)** | PoC |

**Key point for demos:** The Trust Registry and Feedback Service are custom-built for this PoC. AWS does not offer a managed reputation/trust service today. The agent's decision-making intelligence comes from the system prompt — AgentCore Payments handles the money, not the judgment.

## 11. Trust Registry — Design Options (Future)

The PoC includes a custom Trust Registry to demonstrate intelligent purchasing. In production, this could be operated by different parties:

| Model | Operator | Pros | Cons |
|-------|----------|------|------|
| **Independent third party** | Neutral entity (like a credit bureau) | Unbiased, shared across ecosystems | Requires adoption, governance |
| **Agent platform provider** | AWS (hypothetical) | Network effect, built-in with Payments | Vendor lock-in, single point of trust |
| **Enterprise-private** | Each company for its own agents | Full control, proprietary advantage | No shared intelligence, cold start |
| **Decentralized (on-chain)** | No single operator | Permissionless, censorship-resistant | Sybil attacks, slower updates |
| **Hybrid** | Platform + on-chain attestations | Best of both — fast reads, verifiable | Complexity |

### What would make this an AWS service?

If AWS were to build this, it would likely be:
- Integrated with AgentCore Payments (automatic feedback after each transaction)
- Cross-agent aggregation (all agents on the platform contribute scores)
- Merchant onboarding (publishers register and get a reputation profile)
- Dispute resolution (agents can flag bad content, merchants can respond)
- Privacy-preserving (agents don't see each other's purchase history, only aggregate scores)

This is analogous to how AWS Marketplace has seller ratings — but for micropayment content providers.

### Current PoC implementation

Our Trust Registry is a stateless Lambda with pre-seeded synthetic data. It demonstrates the *concept* of trust-aware purchasing without requiring a production reputation system. The data is designed to show clear behavioral patterns:
- MediaTech: consistently excellent → agent always buys
- Copperview: consistently poor → agent always skips
- Thornwick Research: unknown → agent does limited trial
- Kettlebrook Analytics: mixed → agent proceeds with caution

## 12. Limitations & Future Work

### Current Limitations
- **Payment verification is structural only** — Lambda@Edge checks header format but doesn't verify on-chain settlement (would require async verification or a facilitator service)
- **Trust Registry is static** — pre-seeded data, not dynamically updated by feedback
- **Single distribution** — all merchants share one CloudFront distribution (path-based routing)
- **Testnet only** — Base Sepolia has no monetary value; production requires 3 variable changes

### Production Enhancements
- On-chain payment verification via facilitator service
- Dynamic trust scores updated by feedback loop
- Per-merchant CloudFront distributions with independent wallets
- Multi-chain support (Solana, Arbitrum)
- Fiat rails when AgentCore supports them (roadmap)
- Content quality ML scoring (beyond metadata signals)

## 11. References

- [AgentCore Payments Documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)
- [x402 Protocol Specification](https://www.x402.org/)
- [AWS Blog: x402 and Agentic Commerce](https://aws.amazon.com/blogs/industries/x402-and-agentic-commerce-redefining-autonomous-payments-in-financial-services/)
- [AWS Blog: AgentCore Payments Technical Deep Dive](https://aws.amazon.com/blogs/machine-learning/technical-deep-dive-agentcore-payments-and-innovation-in-agentic-commerce/)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
- [Base L2 Documentation](https://docs.base.org/)
