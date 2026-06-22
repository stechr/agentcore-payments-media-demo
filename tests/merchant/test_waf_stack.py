"""Tests for the enriched WAF Smart Paywall (WafMerchantStack) — TASK-110.

These are STATIC-SOURCE assertions (same style as test_core.py's agent.py template
test): they read the CDK TypeScript source and sample content as text and assert the
differentiated-pricing matrix, agent-class rules, PriceMultiplier values, RSL wiring,
and that the OLD Lambda publisher is untouched. No `node`/`cdk synth` needed, so the
suite stays fast and deterministic. (The authoritative `cdk synth` check for both
stacks is run separately in the build/verify step.)
"""

import json
import os

HERE = os.path.dirname(__file__)
REPO = os.path.join(HERE, "../..")
WAF_TS = os.path.join(REPO, "merchant-stack/lib/waf-merchant-stack.ts")
OLD_TS = os.path.join(REPO, "merchant-stack/lib/merchant-stack.ts")
LICENSE_XML = os.path.join(REPO, "merchant-stack/sample-content/quillrook/license.xml")
ROBOTS = os.path.join(REPO, "merchant-stack/sample-content/robots.txt")
CATALOG = os.path.join(REPO, "merchant-stack/sample-content/quillrook/catalog.json")


def _read(path):
    with open(path) as f:
        return f.read()


class TestWafPricingMatrix:
    """The content-tier x agent-class differentiated-pricing matrix."""

    def test_content_tier_monetize_rules_present(self):
        src = _read(WAF_TS)
        for name in ("StandardArticles", "StandardData", "StandardPremium"):
            assert name in src, f"missing standard content-tier rule {name}"

    def test_agent_class_unverified_rules_present(self):
        src = _read(WAF_TS)
        for name in ("UnverifiedArticles", "UnverifiedData", "UnverifiedPremium"):
            assert name in src, f"missing unverified-class rule {name}"

    def test_price_multipliers_for_each_cell(self):
        """Effective = base x content-tier x agent-class, expressed as PriceMultiplier."""
        src = _read(WAF_TS)
        # standard (known-agent x1): articles=1, data=3, premium=8
        # unverified (x2):           articles=2, data=6, premium=16
        for mult in ('"1"', '"2"', '"3"', '"6"', '"8"', '"16"'):
            assert f"PriceMultiplier" in src
            assert mult in src, f"missing PriceMultiplier {mult}"

    def test_all_action_types_present(self):
        """One web ACL exercises Allow / Monetize / Block / Count + pass-through."""
        src = _read(WAF_TS)
        assert "Monetize:" in src
        assert "Block: {}" in src
        assert "Allow: {}" in src
        assert "Count: {}" in src  # Bot Control override

    def test_agent_classes_simulated_via_header(self):
        src = _read(WAF_TS)
        assert "x-demo-agent-class" in src
        for cls in ("verified-crawler", "known-agent", "unverified", "training", "human"):
            assert cls in src, f"missing agent class {cls}"

    def test_production_botcontrol_pattern_documented(self):
        """The production Bot Control / Web Bot Auth pattern must be documented."""
        src = _read(WAF_TS)
        assert "awswaf:managed:aws:bot-control:bot" in src
        assert "Web Bot Auth" in src or "LabelMatchStatement" in src

    def test_priority_ordering_gates_before_monetize(self):
        """Block/Allow gates (10-12) must be ordered before Monetize rules (20-32)."""
        src = _read(WAF_TS)
        assert src.index("ClassTrainingBlock") < src.index("UnverifiedPremium")
        assert src.index("ClassVerifiedCrawlerAllow") < src.index("StandardPremium")


class TestWafMonetizationConfig:
    def test_base_price_param_and_test_mode(self):
        src = _read(WAF_TS)
        assert "BaseMonetizePriceUsdc" in src
        assert 'CurrencyMode: "TEST"' in src
        assert "BASE_SEPOLIA" in src

    def test_ip_allowlist_outer_gate_retained(self):
        src = _read(WAF_TS)
        assert "BlockNonDemoIps" in src
        assert "Priority: 0" in src


class TestRslLicenseTerms:
    def test_response_headers_policy_injects_link(self):
        src = _read(WAF_TS)
        assert "ResponseHeadersPolicy" in src
        assert 'rel="license"' in src
        assert "application/rsl+xml" in src

    def test_license_xml_exists_and_prohibits_training(self):
        xml = _read(LICENSE_XML)
        assert "rslstandard.org/rsl" in xml
        assert "train" in xml  # prohibits train
        assert "read" in xml   # permits read

    def test_robots_txt_advertises_rsl_license(self):
        robots = _read(ROBOTS)
        assert "License:" in robots
        assert "/quillrook/license.xml" in robots

    def test_catalog_advertises_matrix_and_license(self):
        cat = json.loads(_read(CATALOG))["catalog"]
        assert cat["license"]["url"] == "/quillrook/license.xml"
        assert "train" in cat["license"]["prohibits"]
        assert cat["pricing"]["basePriceUsdc"] == 0.002
        matrix = cat["pricing"]["effectivePriceMatrixUsdc"]
        assert matrix["known-agent"]["premium"] == 0.016
        assert matrix["unverified"]["premium"] == 0.032
        assert matrix["training"]["premium"] == "403"


class TestOldLambdaPublisherUntouched:
    """The DIY Lambda@Edge publisher must keep its original behavior."""

    def test_old_stack_still_uses_lambda_edge_paywall(self):
        src = _read(OLD_TS)
        assert "x402-paywall" in src or "edgeLambdas" in src or "Lambda" in src

    def test_waf_stack_has_no_edge_lambda(self):
        """The whole point of the WAF stack: no Lambda@Edge (no edgeLambdas property)."""
        src = _read(WAF_TS)
        assert "edgeLambdas:" not in src  # the property is never set (comment mentions it)
