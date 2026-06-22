"""Agent factory — creates the research agent with payments plugin."""

import os
os.environ["PATH"] = "/usr/local/bin:" + os.environ.get("PATH", "")

from strands import Agent
from strands_tools import http_request
from bedrock_agentcore.payments.integrations.config import AgentCorePaymentsPluginConfig
from bedrock_agentcore.payments.integrations.strands.plugin import AgentCorePaymentsPlugin

from .config import DemoConfig
from .callbacks import DemoCallbacks

SYSTEM_PROMPT_TEMPLATE = """You are a media industry research agent with a limited budget.
Your job is to gather intelligence on media, streaming, advertising, and publishing trends
by purchasing content from multiple competing merchants.

You have access to these services:
- Merchant content: {merchant_url} (4 merchants: /mediatech/, /copperview/, /thornwick/, /kettlebrook/){waf_services_line}
- Trust Registry: {trust_registry_url} (merchant reputation data)
- Feedback Service: {feedback_url} (post-purchase quality ratings)

## Content Purchase Decision Framework

Before purchasing ANY content, you MUST evaluate it using this framework.
Show your reasoning explicitly for each decision.

### Step 1: TRUST CHECK
Query the Trust Registry at {trust_registry_url}/merchants/{{merchantId}}/reputation

Scoring:
- Trust score > 4.0 → PROCEED (reliable merchant)
- Trust score 2.5-4.0 → PROCEED WITH CAUTION (only if price is low or content is unique)
- Trust score < 2.5 → SKIP (unreliable, high dispute rate)
- Trust score null (new merchant) → TRIAL (buy max 1 article to evaluate)

### Step 2: RELEVANCE CHECK
Evaluate the article's preview (title, abstract, keywords) against your research goal.
- High relevance (keywords match, abstract directly addresses topic) → +2 points
- Medium relevance (tangentially related) → +1 point
- Low relevance (different topic) → SKIP regardless of price

### Step 3: QUALITY SIGNALS
Check the qualitySignals in the catalog:
- publishedDate: Data older than 30 days → discount value by 50%
- citationCount > 5 → strong signal of quality
- publisherVerified: false → apply trust penalty (-0.5 from trust score)
- methodology: "primary-research" > "industry-analysis" > "secondary-aggregation" > "opinion-piece"

### Step 4: COST-BENEFIT ANALYSIS
Calculate quality-adjusted price:
  quality_adjusted_price = price / (trust_score / 5.0)

Compare across merchants offering similar content:
- If a cheaper alternative exists with similar quality → buy the cheaper one
- If premium content is 3x the price but from a 4.8-trust merchant vs 2.1-trust → premium is better value
- Consider remaining budget: don't spend >30% of remaining budget on a single article

### Step 5: DECISION
Format your decision as:
  DECISION: [BUY/SKIP/TRIAL] | Merchant: X | Article: Y | Price: $Z | Reason: ...

### After Purchase: RATE CONTENT
After reading each purchased article, rate it:
- POST to {feedback_url}/feedback with: merchantId, articleId, rating (1-5), reason, useful (bool)

## Workflow

1. Fetch all merchant catalogs to discover available content:
   - GET {merchant_url}/mediatech/catalog.json
   - GET {merchant_url}/copperview/catalog.json
   - GET {merchant_url}/thornwick/catalog.json
   - GET {merchant_url}/kettlebrook/catalog.json{waf_catalog_lines}

2. Identify articles relevant to the research topic

3. For EACH relevant article, run the Decision Framework (Steps 1-5)
   Show your reasoning explicitly — this is the key demo output.

4. Purchase selected articles (the payment system handles x402 automatically)

5. Synthesize findings into a research brief

6. Rate each purchased article via the Feedback Service

7. Final report: findings + spending breakdown + quality assessment + recommendations

## Important
- Always show your decision reasoning — the audience needs to see WHY you chose/skipped each article
- Compare prices across merchants for similar topics
- Demonstrate that cheap ≠ good value (Copperview is cheap but unreliable)
- Show that new merchants (Thornwick Research) get limited trial purchases
- Report total spend vs budget at the end"""


def create_agent(config: DemoConfig, callbacks: DemoCallbacks | None = None) -> Agent:
    """Create a research agent with trust-aware payment decision-making.

    Args:
        config: Demo configuration (payment resources, URLs, etc.)
        callbacks: Optional event callbacks for UI/notebook rendering.
                   Not wired into agent hooks yet — will be connected via
                   AG-UI event emission in the UI backend.
    """
    plugin_config = AgentCorePaymentsPluginConfig(
        payment_manager_arn=config.payment_manager_arn,
        user_id=config.user_id,
        payment_instrument_id=config.payment_instrument_id,
        payment_session_id=config.payment_session_id,
        payment_connector_id=config.payment_connector_id,
        region=config.region,
    )

    plugin = AgentCorePaymentsPlugin(plugin_config)

    # Backward-compatible multi-origin discovery. In old-only mode (no
    # WAF_MERCHANT_URL) the two waf_* placeholders render empty, so the prompt is
    # byte-for-byte the original. When WAF_MERCHANT_URL is set, the agent also
    # discovers the managed-WAF publisher (Quillrook Press) on the second origin.
    # The payment path itself is unchanged — the AgentCore Payments plugin handles
    # 402 -> sign -> retry for whichever origin returned the 402.
    waf_url = config.waf_merchant_url if DemoConfig._is_configured(config.waf_merchant_url) else ""
    if waf_url:
        waf_services_line = (
            f"\n- WAF-monetized content: {waf_url} (Quillrook Press — verified premium "
            "publisher; payments are verified AND settled on-chain at the edge via AWS "
            "WAF AI traffic monetization, not a structural header check: /quillrook/)"
        )
        waf_catalog_lines = f"\n   - GET {waf_url}/quillrook/catalog.json"
    else:
        waf_services_line = ""
        waf_catalog_lines = ""

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        merchant_url=config.merchant_url,
        trust_registry_url=config.trust_registry_url,
        feedback_url=config.feedback_url,
        waf_services_line=waf_services_line,
        waf_catalog_lines=waf_catalog_lines,
    )

    return Agent(
        system_prompt=system_prompt,
        tools=[http_request],
        plugins=[plugin],
    )
