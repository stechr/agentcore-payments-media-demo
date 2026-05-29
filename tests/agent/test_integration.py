"""Integration test for the agent — requires live deployed services.

Run after `npx cdk deploy` and with a valid .env.
Skipped if PAYMENT_MANAGER_ARN is not set.
"""

import os
import sys
import pytest
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


def _has_module(name):
    """Check if a module is importable."""
    try:
        __import__(name)
        return True
    except ImportError:
        return False


# Skip all tests if not configured
pytestmark = pytest.mark.skipif(
    not os.environ.get("PAYMENT_MANAGER_ARN"),
    reason="PAYMENT_MANAGER_ARN not set — run `source agent/.env` first"
)


@pytest.fixture(scope="module")
def config():
    from core.config import load_config
    return load_config()


class TestMerchantReachability:
    """Verify merchant services are reachable."""

    def test_merchant_url_returns_200(self, config):
        """Merchant content endpoint is reachable."""
        resp = httpx.get(f"{config.merchant_url}/merchants.json", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "merchants" in data
        assert len(data["merchants"]) == 4

    def test_trust_registry_returns_merchants(self, config):
        """Trust Registry returns 4 merchants."""
        resp = httpx.get(f"{config.trust_registry_url}/merchants", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["merchants"]) == 4

    def test_feedback_service_accepts_post(self, config):
        """Feedback Service accepts a POST."""
        resp = httpx.post(
            f"{config.feedback_url}/feedback",
            json={"merchantId": "test", "articleId": "test", "rating": 3, "reason": "integration test", "useful": True},
            timeout=10,
        )
        assert resp.status_code == 201

    def test_paywall_returns_402(self, config):
        """Premium content returns 402 without payment."""
        resp = httpx.get(f"{config.merchant_url}/mediatech/premium/agent-traffic-report-q2.json", timeout=10)
        assert resp.status_code == 402
        data = resp.json()
        assert data["x402Version"] == 1
        assert data["pricing"]["currency"] == "USDC"


class TestAgentCreation:
    """Verify the agent can be created and tools are available."""

    @pytest.mark.skipif(
        not _has_module("strands"),
        reason="strands-agents not installed — run inside agent/.venv"
    )
    def test_create_agent(self, config):
        """Agent creates without error."""
        from core import create_agent
        agent = create_agent(config)
        assert agent is not None

    @pytest.mark.skipif(
        not _has_module("strands"),
        reason="strands-agents not installed — run inside agent/.venv"
    )
    def test_agent_has_system_prompt(self, config):
        """Agent has the decision framework in its system prompt."""
        from core import create_agent
        agent = create_agent(config)
        assert agent.system_prompt is not None
        assert "TRUST CHECK" in agent.system_prompt


class TestPaymentResources:
    """Verify AgentCore Payments resources are accessible."""

    @pytest.mark.skipif(
        not _has_module("bedrock_agentcore"),
        reason="bedrock-agentcore not installed — run inside agent/.venv"
    )
    def test_get_payment_instrument(self, config):
        """Payment instrument is retrievable."""
        from bedrock_agentcore.payments.manager import PaymentManager
        pm = PaymentManager(payment_manager_arn=config.payment_manager_arn, region_name=config.region)
        inst = pm.get_payment_instrument(
            payment_instrument_id=config.payment_instrument_id,
            user_id=config.user_id,
        )
        assert inst["status"] == "ACTIVE"

    @pytest.mark.skipif(
        not _has_module("bedrock_agentcore"),
        reason="bedrock-agentcore not installed — run inside agent/.venv"
    )
    def test_get_payment_session(self, config):
        """Payment session is retrievable and has budget."""
        from bedrock_agentcore.payments.manager import PaymentManager
        pm = PaymentManager(payment_manager_arn=config.payment_manager_arn, region_name=config.region)
        sess = pm.get_payment_session(
            payment_session_id=config.payment_session_id,
            user_id=config.user_id,
        )
        assert "limits" in sess
        assert sess["limits"]["maxSpendAmount"]["currency"] == "USD"
