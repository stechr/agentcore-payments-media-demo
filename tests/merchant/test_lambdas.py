"""Unit tests for merchant-stack Lambdas — paywall, trust registry, feedback service.

These test the Lambda handler functions directly (no deployment needed).
"""

import json
import os
import sys
import subprocess
import pytest


LAMBDA_DIR = os.path.join(os.path.dirname(__file__), "../../merchant-stack/lambda")


def invoke_lambda(lambda_name, event):
    """Invoke a Node.js Lambda handler locally via subprocess."""
    script = f"""
    const handler = require('./{lambda_name}/index.js').handler;
    handler({json.dumps(event)}).then(r => console.log(JSON.stringify(r)));
    """
    result = subprocess.run(
        ["node", "-e", script],
        capture_output=True, text=True, cwd=LAMBDA_DIR, timeout=10
    )
    if result.returncode != 0:
        pytest.fail(f"Lambda invocation failed: {result.stderr}")
    return json.loads(result.stdout.strip())


class TestX402Paywall:
    """Tests for the x402 paywall Lambda@Edge function."""

    def test_free_path_passes_through(self):
        """Catalog and index paths are not paywalled."""
        event = {"Records": [{"cf": {"request": {
            "uri": "/merchants.json",
            "headers": {"host": [{"value": "example.com"}]},
        }}}]}
        result = invoke_lambda("x402-paywall", event)
        # Pass-through returns the request object (not a response)
        assert result.get("uri") == "/merchants.json"

    def test_catalog_passes_through(self):
        """Catalog JSON is free."""
        event = {"Records": [{"cf": {"request": {
            "uri": "/mediatech/catalog.json",
            "headers": {"host": [{"value": "example.com"}]},
        }}}]}
        result = invoke_lambda("x402-paywall", event)
        assert result.get("uri") == "/mediatech/catalog.json"

    def test_premium_returns_402(self):
        """Premium content without payment returns 402."""
        event = {"Records": [{"cf": {"request": {
            "uri": "/mediatech/premium/article.json",
            "headers": {"host": [{"value": "example.com"}]},
        }}}]}
        result = invoke_lambda("x402-paywall", event)
        assert result["status"] == "402"
        body = json.loads(result["body"])
        assert body["x402Version"] == 1
        assert body["accepts"][0]["network"] == "base-sepolia"
        assert body["merchant"]["id"] == "mediatech-daily"

    def test_402_includes_pricing(self):
        """402 response includes price information."""
        event = {"Records": [{"cf": {"request": {
            "uri": "/copperview/articles/test.json",
            "headers": {"host": [{"value": "example.com"}]},
        }}}]}
        result = invoke_lambda("x402-paywall", event)
        body = json.loads(result["body"])
        assert body["pricing"]["currency"] == "USDC"
        assert body["pricing"]["amount"] == 0.001  # copperview standard

    def test_payment_header_passes_through(self):
        """Request with X-PAYMENT header passes through."""
        event = {"Records": [{"cf": {"request": {
            "uri": "/mediatech/premium/article.json",
            "headers": {
                "host": [{"value": "example.com"}],
                "x-payment": [{"value": '{"payload":{"signature":"0xabc"}}'}],
            },
        }}}]}
        result = invoke_lambda("x402-paywall", event)
        assert result.get("uri") == "/mediatech/premium/article.json"


class TestTrustRegistry:
    """Tests for the trust registry Lambda."""

    def test_list_merchants(self):
        """GET /merchants returns all 5 merchants (4 Lambda + 1 WAF-monetized)."""
        event = {"rawPath": "/merchants", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert len(body["merchants"]) == 5

    def test_merchant_reputation(self):
        """GET /merchants/{id}/reputation returns detailed data."""
        event = {"rawPath": "/merchants/mediatech-daily/reputation", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["trustScore"] == 4.8
        assert body["totalTransactions"] == 203

    def test_unknown_merchant_404(self):
        """Unknown merchant returns 404."""
        event = {"rawPath": "/merchants/unknown/reputation", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        assert result["statusCode"] == 404

    def test_copperview_low_trust(self):
        """Copperview has low trust score with warnings."""
        event = {"rawPath": "/merchants/copperview/reputation", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        body = json.loads(result["body"])
        assert body["trustScore"] == 2.1
        assert body["disputeRate"] == 0.15
        assert "high-dispute-rate" in body["warnings"]

    def test_thornwick_null_trust(self):
        """Thornwick Research has null trust score (new merchant)."""
        event = {"rawPath": "/merchants/thornwick/reputation", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        body = json.loads(result["body"])
        assert body["trustScore"] is None
        assert body["totalTransactions"] == 3

    def test_quillrook_edge_settled(self):
        """Quillrook Press (WAF-monetized) is high-trust, on-chain/edge-settled."""
        event = {"rawPath": "/merchants/quillrook-press/reputation", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("trust-registry", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["trustScore"] == 4.9
        assert body["disputeRate"] == 0.0
        assert "edge-settled" in body["badges"]
        assert "on-chain-verified" in body["badges"]


class TestFeedbackService:
    """Tests for the feedback service Lambda."""

    def test_post_feedback(self):
        """POST /feedback records a rating."""
        event = {
            "rawPath": "/feedback",
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({"merchantId": "test", "articleId": "art1", "rating": 4, "reason": "good", "useful": True}),
            "isBase64Encoded": False,
        }
        result = invoke_lambda("feedback-service", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert body["message"] == "Feedback recorded"
        assert body["entry"]["rating"] == 4

    def test_post_feedback_missing_fields(self):
        """POST /feedback with missing required fields returns 400."""
        event = {
            "rawPath": "/feedback",
            "requestContext": {"http": {"method": "POST"}},
            "body": json.dumps({"merchantId": "test"}),
            "isBase64Encoded": False,
        }
        result = invoke_lambda("feedback-service", event)
        assert result["statusCode"] == 400

    def test_get_feedback(self):
        """GET /feedback returns feedback list."""
        event = {"rawPath": "/feedback", "requestContext": {"http": {"method": "GET"}}}
        result = invoke_lambda("feedback-service", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert "feedback" in body
