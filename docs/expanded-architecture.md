# Expanded Demo Architecture — Agent Decision-Making for Paid Content

## Overview

The demo shows a research agent that must choose between multiple content providers
with different prices, quality levels, and reputations. The agent uses trust signals,
content previews, and cost-benefit reasoning to decide where to spend its budget.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  External Services (not owned by agent)                              │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ MediaTech Daily  │  │ Copperview       │  │ Thornwick Research     │     │
│  │ (Premium, $$$)   │  │ (Budget, $)     │  │ (New, $$)       │     │
│  │ Trust: 4.8/5     │  │ Trust: 2.1/5    │  │ Trust: N/A      │     │
│  │ CF + L@E         │  │ CF + L@E        │  │ CF + L@E        │     │
│  └────────┬─────────┘  └────────┬────────┘  └────────┬────────┘    │
│           │ 402                  │ 402                 │ 402         │
│           └──────────────────────┼─────────────────────┘            │
│                                  │                                   │
│  ┌───────────────────────────────┼───────────────────────────────┐  │
│  │  Trust Registry (mock API)    │                                │  │
│  │  - Merchant reputation scores │                                │  │
│  │  - Transaction history        │                                │  │
│  │  - Quality ratings            │                                │  │
│  │  - Dispute rate               │                                │  │
│  └───────────────────────────────┘                                │  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Feedback Service (mock API)                                   │  │
│  │  - Agent posts quality ratings after consuming content         │  │
│  │  - Updates trust registry scores                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Research Agent                                                       │
│                                                                      │
│  1. Receive research task                                            │
│  2. Discover available content (fetch catalogs from all merchants)   │
│  3. For each relevant article:                                       │
│     a. Check trust registry → merchant reputation                    │
│     b. Evaluate preview/metadata → relevance to task                 │
│     c. Check quality signals → freshness, citations, verified        │
│     d. Cost-benefit reasoning → price vs expected value vs budget    │
│     e. Decision: BUY / SKIP / FIND_ALTERNATIVE                      │
│  4. Purchase selected articles                                       │
│  5. Consume and synthesize                                           │
│  6. Rate content quality → feedback service                          │
│  7. Report: findings + spending breakdown + quality assessment       │
└─────────────────────────────────────────────────────────────────────┘
```

## Merchant Personas

| Merchant | Brand | Pricing | Quality | Trust Score | Behavior |
|----------|-------|---------|---------|-------------|----------|
| MediaTech Daily | Premium publisher | $0.008-0.015 | High (detailed, sourced) | 4.8/5 (200 txns) | Always delivers quality |
| Copperview | Budget aggregator | $0.001-0.003 | Low (thin, sometimes stale) | 2.1/5 (150 txns) | Cheap but unreliable |
| Thornwick Research | New entrant | $0.005-0.008 | Medium-High | N/A (3 txns) | Good quality, no track record |
| Kettlebrook Analytics | Mid-tier | $0.004-0.006 | Medium | 3.5/5 (80 txns) | Decent, occasional misses |

## Implementation Plan

### Single CloudFront Distribution, Path-Based Merchants

Instead of 4 separate distributions, use path-based routing:
- `/mediatech/` → premium content
- `/copperview/` → budget content
- `/thornwick/` → new entrant content
- `/kettlebrook/` → mid-tier content

The Lambda@Edge reads the path prefix to determine which merchant persona to use
(pricing, quality signals, preview depth).

### Trust Registry (Lambda + DynamoDB)

API Gateway + Lambda that serves:
- `GET /merchants` → list all merchants with scores
- `GET /merchants/{id}/reputation` → detailed reputation (score, txn count, dispute rate, avg rating)
- `GET /merchants/{id}/history` → recent transaction outcomes
- `POST /feedback` → agent submits quality rating after purchase

Pre-seeded with synthetic data showing clear patterns:
- MediaTech: consistently high ratings, zero disputes
- Copperview: mixed ratings, 15% dispute rate, some "content didn't match description"
- Thornwick Research: only 3 transactions, all positive but too few to trust
- Kettlebrook Analytics: mostly good, occasional "stale data" complaints

### Enhanced 402 Response (B + D)

```json
{
  "x402Version": 1,
  "accepts": [...],
  "preview": {
    "title": "AI Agent Traffic Report: 23% of News Site Visits",
    "abstract": "Analysis of 500M page views across 200 publishers...",
    "keywords": ["agent-traffic", "publisher-analytics", "2026-Q2"],
    "wordCount": 2400
  },
  "qualitySignals": {
    "publishedDate": "2026-05-20",
    "citationCount": 12,
    "publisherVerified": true,
    "dataFreshness": "7d",
    "methodology": "primary-research"
  },
  "merchant": {
    "id": "mediatech-daily",
    "name": "MediaTech Daily",
    "domain": "mediatech.example.com"
  }
}
```

### Agent Decision Logic (C)

The agent's system prompt includes decision framework:

```
Before purchasing any content, evaluate using this framework:

1. TRUST: Check the trust registry for merchant reputation
   - Score > 4.0: proceed
   - Score 2.5-4.0: only if price is low or content is unique
   - Score < 2.5: skip unless no alternative exists
   - No score (new): limit to 1 purchase as trial

2. RELEVANCE: Evaluate preview against research goal
   - Keywords match? Abstract relevant? 
   - If <50% relevance, skip regardless of price

3. QUALITY SIGNALS: Check freshness and credibility
   - Data older than 30 days: discount value by 50%
   - No citations: treat as opinion, not research
   - Unverified publisher: apply trust penalty

4. COST-BENEFIT: Compare price to expected value
   - Remaining budget vs. articles still needed
   - Cheaper alternative available? Compare quality-adjusted price
   - Quality-adjusted price = price / (trust_score / 5.0)

5. DECIDE: BUY if (relevant AND (trusted OR cheap trial)) AND within budget
```

### Feedback Loop (E)

After consuming content, agent rates it:
```json
POST /feedback
{
  "merchantId": "copperview",
  "articleId": "streaming-metrics-q2",
  "rating": 2,
  "reason": "Data was 45 days old despite claiming 'real-time'. Thin analysis.",
  "useful": false
}
```

This updates the trust registry scores for future sessions.

## Demo Narrative

1. Agent gets task: "Research how AI agents are changing publisher revenue models"
2. Discovers 8 relevant articles across 4 merchants
3. **Shows reasoning:**
   - "MediaTech has an article for $0.01 — trust score 4.8, fresh data, 12 citations. Buying."
   - "Copperview has similar topic for $0.002 — but trust score 2.1, 15% dispute rate. Skipping."
   - "Thornwick Research has unique angle for $0.006 — no reputation yet. Buying as trial (1 article max)."
   - "Kettlebrook Analytics has overlapping content for $0.005 — trust 3.5, but I already have MediaTech's premium version. Skipping (diminishing returns)."
4. Purchases 3 articles, skips 5
5. Synthesizes research brief
6. Rates each purchased article → feedback service
7. Reports: "Spent $0.021 of $1.00 budget. 2/3 articles were high quality. Thornwick Research trial was positive — recommend for future sessions."

## What This Demonstrates

| Capability | What audience sees |
|------------|-------------------|
| A. Trust/Reputation | Agent checks merchant scores before paying |
| B. Preview | Agent reads abstracts to assess relevance |
| C. Cost-Benefit | Agent reasons about price vs value vs budget |
| D. Quality Signals | Agent uses freshness, citations, verification |
| E. Feedback Loop | Agent rates content, improving future decisions |
| Budget Controls | AgentCore enforces hard spending cap |
| Multi-merchant | Agent compares across providers |
