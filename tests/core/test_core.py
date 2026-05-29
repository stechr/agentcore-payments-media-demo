"""Unit tests for core/ — config, agent factory, callbacks."""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


class TestConfig:
    """Tests for core/config.py."""

    def test_load_config_from_env(self, monkeypatch):
        """Config loads from environment variables."""
        monkeypatch.setenv("PAYMENT_MANAGER_ARN", "arn:aws:bedrock-agentcore:us-east-1:123:payment-manager/test")
        monkeypatch.setenv("PAYMENT_INSTRUMENT_ID", "payment-instrument-test")
        monkeypatch.setenv("PAYMENT_SESSION_ID", "payment-session-test")

        from core.config import load_config
        config = load_config()

        assert config.payment_manager_arn == "arn:aws:bedrock-agentcore:us-east-1:123:payment-manager/test"
        assert config.payment_instrument_id == "payment-instrument-test"
        assert config.payment_session_id == "payment-session-test"
        assert config.user_id == "researcher001"
        assert config.region == "us-east-1"

    def test_load_config_defaults(self, monkeypatch):
        """Config uses sensible defaults for optional fields."""
        monkeypatch.setenv("PAYMENT_MANAGER_ARN", "arn:aws:bedrock-agentcore:us-east-1:123:payment-manager/x")
        monkeypatch.setenv("PAYMENT_INSTRUMENT_ID", "inst-x")
        monkeypatch.setenv("PAYMENT_SESSION_ID", "sess-x")

        from core.config import load_config
        config = load_config()

        assert config.user_id == "researcher001"
        assert config.region == "us-east-1"

    def test_load_config_missing_required_raises(self, monkeypatch):
        """Config raises when required env vars are missing."""
        monkeypatch.delenv("PAYMENT_MANAGER_ARN", raising=False)
        monkeypatch.delenv("PAYMENT_INSTRUMENT_ID", raising=False)
        monkeypatch.delenv("PAYMENT_SESSION_ID", raising=False)

        from core.config import load_config
        with pytest.raises(KeyError):
            load_config()

    def test_source_env_file(self, tmp_path, monkeypatch):
        """Config can source a .env file."""
        env_file = tmp_path / ".env"
        env_file.write_text(
            "export PAYMENT_MANAGER_ARN=arn:aws:bedrock-agentcore:us-east-1:999:payment-manager/from-file\n"
            "export PAYMENT_INSTRUMENT_ID=inst-from-file\n"
            "export PAYMENT_SESSION_ID=sess-from-file\n"
        )
        monkeypatch.delenv("PAYMENT_MANAGER_ARN", raising=False)
        monkeypatch.delenv("PAYMENT_INSTRUMENT_ID", raising=False)
        monkeypatch.delenv("PAYMENT_SESSION_ID", raising=False)

        from core.config import load_config
        config = load_config(env_file=str(env_file))

        assert "from-file" in config.payment_manager_arn


class TestAgentFactory:
    """Tests for core/agent.py — SYSTEM_PROMPT_TEMPLATE only (no strands import needed)."""

    def test_system_prompt_template_has_placeholders(self):
        """System prompt template contains format placeholders."""
        # Import just the template string without triggering strands import
        import importlib.util
        spec = importlib.util.spec_from_file_location("agent_module", os.path.join(os.path.dirname(__file__), "../../core/agent.py"))
        # Read the file directly instead of importing (avoids strands dependency)
        with open(os.path.join(os.path.dirname(__file__), "../../core/agent.py")) as f:
            content = f.read()
        assert "{merchant_url}" in content
        assert "{trust_registry_url}" in content
        assert "{feedback_url}" in content

    def test_system_prompt_contains_decision_framework(self):
        """System prompt includes the 5-step decision framework."""
        with open(os.path.join(os.path.dirname(__file__), "../../core/agent.py")) as f:
            content = f.read()
        assert "TRUST CHECK" in content
        assert "RELEVANCE" in content
        assert "QUALITY SIGNALS" in content
        assert "COST-BENEFIT" in content
        assert "DECISION" in content


class TestCallbacks:
    """Tests for core/callbacks.py."""

    def test_print_callbacks_instantiates(self):
        """PrintCallbacks can be created."""
        from core.callbacks import PrintCallbacks
        cb = PrintCallbacks()
        assert hasattr(cb, "on_trust_check")
        assert hasattr(cb, "on_decision")
        assert hasattr(cb, "on_purchase")

    def test_collector_callbacks_collects(self):
        """CollectorCallbacks stores events."""
        from core.callbacks import CollectorCallbacks, TrustCheckEvent
        cb = CollectorCallbacks()
        event = TrustCheckEvent(
            merchant_id="test", merchant_name="Test", trust_score=4.5,
            total_transactions=100, dispute_rate=0.01, decision="PROCEED"
        )
        cb.on_trust_check(event)
        assert len(cb.trust_checks) == 1
        assert cb.trust_checks[0].trust_score == 4.5

    def test_event_dataclasses(self):
        """Event dataclasses can be instantiated with required fields."""
        from core.callbacks import DecisionEvent, PurchaseEvent, BudgetUpdateEvent, FeedbackEvent

        d = DecisionEvent(action="BUY", merchant_name="X", article_title="Y", price=0.01, reason="good")
        assert d.action == "BUY"

        p = PurchaseEvent(merchant_name="X", article_title="Y", price=0.01)
        assert p.success is True

        b = BudgetUpdateEvent(spent=0.02, remaining=0.98, total=1.0, articles_purchased=2)
        assert b.remaining == 0.98

        f = FeedbackEvent(merchant_id="x", article_id="y", rating=5, reason="great")
        assert f.rating == 5
