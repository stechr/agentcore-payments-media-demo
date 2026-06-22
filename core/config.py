"""Configuration for AgentCore Payments PoC — loads from environment."""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DemoConfig:
    """All configuration needed to run the demo agent."""

    payment_manager_arn: str
    payment_instrument_id: str
    payment_session_id: str
    payment_connector_id: str = "<YOUR_CONNECTOR_ID>"
    user_id: str = "researcher001"
    region: str = "us-east-1"
    merchant_url: str = "https://<YOUR_CLOUDFRONT_DOMAIN>"
    # Optional SECOND publisher gated by the managed AWS WAF "AI traffic
    # monetization" feature (verifies + settles on-chain at the edge). When set,
    # the agent discovers it ALONGSIDE merchant_url. Leave unset to behave exactly
    # as before (old-only mode → zero behavioral change).
    waf_merchant_url: str = ""
    trust_registry_url: str = "https://<YOUR_TRUST_REGISTRY_URL>"
    feedback_url: str = "https://<YOUR_FEEDBACK_SERVICE_URL>"
    research_topic: str = (
        "How are AI agents changing publisher revenue models, and what role do "
        "micropayments play in the transition from ad-supported to agent-paid content?"
    )

    @staticmethod
    def _is_configured(url: str) -> bool:
        """A URL is 'configured' when it is non-empty and not a placeholder."""
        return bool(url) and "<" not in url

    def active_merchant_urls(self) -> dict[str, str]:
        """Return the configured merchant base URLs keyed by a stable label.

        Yields the three deployment modes with no agent code changes:
          - old-only : only MERCHANT_URL set      -> {"merchant": ...}
          - new-only : only WAF_MERCHANT_URL set   -> {"waf_merchant": ...}
          - both     : both set                    -> both keys
        """
        urls: dict[str, str] = {}
        if self._is_configured(self.merchant_url):
            urls["merchant"] = self.merchant_url
        if self._is_configured(self.waf_merchant_url):
            urls["waf_merchant"] = self.waf_merchant_url
        return urls


def load_config(env_file: str | Path | None = None) -> DemoConfig:
    """Load config from environment variables, optionally sourcing a .env file first."""
    if env_file:
        _source_env_file(Path(env_file))

    return DemoConfig(
        payment_manager_arn=os.environ["PAYMENT_MANAGER_ARN"],
        payment_instrument_id=os.environ["PAYMENT_INSTRUMENT_ID"],
        payment_session_id=os.environ["PAYMENT_SESSION_ID"],
        payment_connector_id=os.environ.get("PAYMENT_CONNECTOR_ID", "<YOUR_CONNECTOR_ID>"),
        user_id=os.environ.get("USER_ID", "researcher001"),
        region=os.environ.get("AWS_REGION", "us-east-1"),
        merchant_url=os.environ.get("MERCHANT_URL", "https://<YOUR_CLOUDFRONT_DOMAIN>"),
        waf_merchant_url=os.environ.get("WAF_MERCHANT_URL", ""),
        trust_registry_url=os.environ.get("TRUST_REGISTRY_URL", "https://<YOUR_TRUST_REGISTRY_URL>"),
        feedback_url=os.environ.get("FEEDBACK_URL", "https://<YOUR_FEEDBACK_SERVICE_URL>"),
        research_topic=os.environ.get("RESEARCH_TOPIC", DemoConfig.research_topic),
    )


def _source_env_file(path: Path) -> None:
    """Parse a bash-style .env file (export KEY=VALUE) into os.environ."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        key, _, value = line.partition("=")
        if key and value:
            os.environ.setdefault(key.strip(), value.strip())
