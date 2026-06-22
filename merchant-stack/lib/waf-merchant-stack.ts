import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import * as path from "path";

/**
 * WafMerchantStack — a SECOND, independently-deployable publisher whose paywall
 * is the managed AWS WAF "AI traffic monetization" feature (announced 2026-06-15)
 * instead of the hand-rolled Lambda@Edge used by {@link MerchantStack}.
 *
 * The whole point: there is NO Lambda@Edge here. WAF returns the x402 402 at the
 * edge, verifies the signed payment authorization, fetches origin, and SETTLES
 * on-chain via the Coinbase x402 facilitator. This is the managed counterpart to
 * the DIY 40-line paywall — and the contrast Part 3 of the blog is written about.
 *
 * ── SMART PAYWALL (TASK-110) ──────────────────────────────────────────────────
 * This stack is enriched into a DIFFERENTIATED-PRICING MATRIX: the effective price
 * for a request is the product of two independent dimensions, both expressed
 * through the managed feature:
 *
 *   effective_price = base_price × content_tier_multiplier × agent_class_multiplier
 *
 *   1. CONTENT TIER (by URI path), via ByteMatch on UriPath:
 *        /articles/  → ×1   (news & briefings)
 *        /data/      → ×3   (structured datasets)
 *        /premium/   → ×8   (verified primary research)
 *   2. AGENT CLASS (separate rules), each mapped to a WAF action:
 *        verified-crawler → Allow (free — referral-driving search crawlers)
 *        known-agent      → Monetize at standard (×1 class multiplier)
 *        unverified       → Monetize at premium (×2 class multiplier)
 *        training         → Block (403 — no training on this content)
 *        human            → pass-through (default Allow, no 402)
 *
 * The matrix is realised as a set of WAF rules. Because the `Monetize` action is
 * TERMINATING (per the WAF pricing doc — when a Monetize rule matches, WAF stops
 * evaluating subsequent rules and returns the 402), rule ORDER encodes precedence:
 * agent-class gates that don't price (Block/Allow/pass-through) are evaluated
 * first; then the priced (Monetize) rules, unverified before standard, so the
 * class multiplier composes with the content-tier multiplier.
 *
 * AGENT-CLASS MATCHING — SIMULATION vs PRODUCTION:
 *   • SIMULATION (the ACTIVE rules below): the agent class is read from a
 *     self-asserted request header `x-demo-agent-class: verified-crawler |
 *     known-agent | unverified | training | human`. This lets a viewer drive the
 *     whole matrix from `curl` without standing up Bot Control. It is a SIMULATION
 *     of the classification Bot Control performs in production — see README.
 *   • PRODUCTION (documented, NOT relied on here): swap each header ByteMatch for a
 *     `LabelMatchStatement` on AWS WAF Bot Control labels
 *     (`awswaf:managed:aws:bot-control:bot` and verified-bot sub-labels) plus
 *     Web Bot Auth signature verification. The production rule shapes are shown in
 *     comments at the relevant rules and in docs/waf-monetization.md.
 *
 * CFN-COVERAGE CAVEAT: the `Monetize` rule action, `PriceMultiplier`, and the
 * `MonetizationConfig` property on AWS::WAFv2::WebACL are days old and almost
 * certainly NOT yet in the CloudFormation resource schema. They are injected here
 * via L1 escape-hatch (`addPropertyOverride`). `cdk synth` succeeds regardless
 * (escape-hatch is raw template injection, not validated at synth). IF a live
 * `cdk deploy` rejects the unknown property, fall back to the post-deploy script
 * `scripts/apply-waf-monetization.sh` (documented in docs/waf-monetization.md).
 */
export class WafMerchantStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // === Demo IP allowlist (outer gate, same as the Lambda stack) ===
    const allowedIps = new cdk.CfnParameter(this, "AllowedIps", {
      type: "CommaDelimitedList",
      default: "92.208.185.77/32",
      description: "CIDR blocks allowed to reach the WAF-monetized merchant (demo safety)",
    });

    // payTo wallet for on-chain settlement (testnet by default).
    const payToWallet = new cdk.CfnParameter(this, "PayToWallet", {
      type: "String",
      default: "0x0000000000000000000000000000000000000000",
      description: "USDC wallet address (Base Sepolia, testnet) that receives x402 settlements",
    });

    // BASE price per monetized request, in USDC (decimal string, <=3 dp, min 0.001).
    // The per-rule PriceMultiplier values below multiply UP from this base, so the
    // effective premium-tier price is base × tier(8) × class. Default 0.002 ⇒
    // standard premium (known-agent) = $0.016, unverified premium = $0.032.
    const basePrice = new cdk.CfnParameter(this, "BaseMonetizePriceUsdc", {
      type: "String",
      default: "0.002",
      description:
        "BASE price per monetized request in USDC (<=3dp, min 0.001). Effective = base x content-tier x agent-class PriceMultiplier.",
    });

    // RSL license reference injected as a CloudFront `Link` header on origin
    // responses (NOT on the 402 — the 402 is served by WAF and carries no Link
    // header, per the WAF license-terms doc). Relative by default so it resolves
    // against the distribution domain without a circular dependency; set an
    // absolute https URL to match the doc's example verbatim.
    const licenseUrl = new cdk.CfnParameter(this, "RslLicenseUrl", {
      type: "String",
      default: "/quillrook/license.xml",
      description:
        "RSL license URL for the Link: rel=license header. Relative (resolves to dist domain) by default; set absolute https URL if preferred.",
    });

    const ipSet = new wafv2.CfnIPSet(this, "AllowedIpSet", {
      scope: "CLOUDFRONT",
      ipAddressVersion: "IPV4",
      addresses: allowedIps.valueAsList,
      name: "agentcore-waf-monetize-allowed-ips",
    });

    // Web ACL: default ALLOW (so free paths — catalog/index/license.xml/robots.txt
    // — and HUMAN traffic are served), BLOCK any source NOT in the demo allowlist,
    // run Bot Control to label AI traffic, then the differentiated Monetize matrix.
    //
    // NOTE: the entire `Rules` array is injected via escape-hatch (below) rather
    // than the typed `rules` prop. This is REQUIRED: the new `Monetize` rule action
    // is `{ Monetize: { PriceMultiplier: "N" } }`, and the typed action union does
    // not yet include Monetize, so it cannot be expressed via typed rules. Equally,
    // CDK's deepMerge prunes empty leaf objects (`{}`) from property overrides
    // UNLESS they sit inside an array, which deepMerge assigns verbatim — so the
    // whole array is supplied as one override to keep every action object intact.
    const webAcl = new wafv2.CfnWebACL(this, "WafMonetizeAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "agentcore-waf-monetize",
        sampledRequestsEnabled: true,
      },
    });

    // ── Helpers for the escape-hatch rule array ────────────────────────────────
    const DEMO_HEADER = "x-demo-agent-class";
    const vis = (name: string) => ({
      CloudWatchMetricsEnabled: true,
      MetricName: name,
      SampledRequestsEnabled: true,
    });
    // Match the self-asserted demo agent-class header EXACTLY (SIMULATION input).
    // PRODUCTION equivalent: replace with a LabelMatchStatement on a Bot Control
    // label — e.g. { LabelMatchStatement: { Scope: "LABEL",
    //   Key: "awswaf:managed:aws:bot-control:bot" } } (+ Web Bot Auth for verified).
    const demoClass = (value: string) => ({
      ByteMatchStatement: {
        SearchString: value,
        FieldToMatch: { SingleHeader: { Name: DEMO_HEADER } },
        PositionalConstraint: "EXACTLY",
        TextTransformations: [{ Priority: 0, Type: "LOWERCASE" }],
      },
    });
    // Match a content tier by URI path prefix.
    const tierPath = (prefix: string) => ({
      ByteMatchStatement: {
        SearchString: prefix,
        FieldToMatch: { UriPath: {} },
        PositionalConstraint: "CONTAINS",
        TextTransformations: [{ Priority: 0, Type: "NONE" }],
      },
    });
    const andStmt = (...statements: object[]) => ({ AndStatement: { Statements: statements } });
    // A Monetize rule for (agent-class? AND content-tier) with an effective
    // PriceMultiplier = content_tier_multiplier × agent_class_multiplier.
    const monetizeRule = (
      name: string,
      priority: number,
      statement: object,
      multiplier: string,
    ) => ({
      Name: name,
      Priority: priority,
      Action: { Monetize: { PriceMultiplier: multiplier } },
      VisibilityConfig: vis(name),
      Statement: statement,
    });

    // === Escape-hatch: the full Rules array (verbatim, action objects preserved) ===
    //
    // PRIORITY SCHEME (lower number = evaluated first; Monetize/Block/Allow all
    // terminate, so precedence is encoded by ordering):
    //    0      outer demo IP gate (Block non-allowlisted sources)
    //    1      Bot Control (Count/label-only — classify without blocking)
    //   10–12   agent-class gates that DON'T price: human pass-through, training
    //           Block, verified-crawler Allow (free)
    //   20–22   UNVERIFIED agent × content tier → Monetize (class ×2)
    //   30–32   STANDARD (known-agent / unclassified bot) × content tier → Monetize
    //
    // The standard (30–32) rules carry NO agent-class condition, so they catch both
    // an explicit `known-agent` header AND a request with no demo header (e.g. the
    // live research agent) — both pay the content-tier price. verified-crawler /
    // training / human / unverified all match EARLIER and terminate first.
    webAcl.addPropertyOverride("Rules", [
      // priority 0 — outer demo gate: block everything NOT in the allowlist.
      {
        Name: "BlockNonDemoIps",
        Priority: 0,
        Action: { Block: {} },
        VisibilityConfig: vis("block-non-demo-ips"),
        Statement: {
          NotStatement: {
            Statement: { IPSetReferenceStatement: { Arn: ipSet.attrArn } },
          },
        },
      },
      // priority 1 — Bot Control managed rule group, label-only (count override) so
      // it CLASSIFIES AI agents (emitting awswaf:managed:aws:bot-control:* labels)
      // without blocking them before the matrix. In PRODUCTION these labels are
      // what the agent-class rules below would match (instead of the demo header).
      {
        Name: "AWSBotControl",
        Priority: 1,
        OverrideAction: { Count: {} },
        VisibilityConfig: vis("bot-control"),
        Statement: {
          ManagedRuleGroupStatement: {
            VendorName: "AWS",
            Name: "AWSManagedRulesBotControlRuleSet",
            ManagedRuleGroupConfigs: [
              { AWSManagedRulesBotControlRuleSet: { InspectionLevel: "COMMON" } },
            ],
          },
        },
      },

      // priority 10 — HUMAN → pass-through (Allow, no 402). SIMULATION: explicit
      // `x-demo-agent-class: human`. PRODUCTION: humans carry NO bot-control:bot
      // label, so they simply never match the monetize rules and fall through to
      // the default Allow — this explicit rule makes the human case demoable.
      {
        Name: "ClassHumanPassThrough",
        Priority: 10,
        Action: { Allow: {} },
        VisibilityConfig: vis("class-human"),
        Statement: demoClass("human"),
      },
      // priority 11 — TRAINING crawler → Block (403). No training on this content.
      {
        Name: "ClassTrainingBlock",
        Priority: 11,
        Action: { Block: {} },
        VisibilityConfig: vis("class-training"),
        Statement: demoClass("training"),
      },
      // priority 12 — VERIFIED CRAWLER → Allow (free). Referral-driving search
      // crawlers under a referral agreement read for free, on any content tier.
      {
        Name: "ClassVerifiedCrawlerAllow",
        Priority: 12,
        Action: { Allow: {} },
        VisibilityConfig: vis("class-verified-crawler"),
        Statement: demoClass("verified-crawler"),
      },

      // priority 20–22 — UNVERIFIED agent × content tier → Monetize at PREMIUM.
      // class multiplier ×2, composed with content-tier (×8/×3/×1) ⇒ ×16/×6/×2.
      monetizeRule(
        "UnverifiedPremium",
        20,
        andStmt(demoClass("unverified"), tierPath("/premium/")),
        "16",
      ),
      monetizeRule(
        "UnverifiedData",
        21,
        andStmt(demoClass("unverified"), tierPath("/data/")),
        "6",
      ),
      monetizeRule(
        "UnverifiedArticles",
        22,
        andStmt(demoClass("unverified"), tierPath("/articles/")),
        "2",
      ),

      // priority 30–32 — STANDARD (known-agent / unclassified bot) × content tier.
      // No agent-class condition: catches the explicit `known-agent` header AND any
      // request with no demo header (the live research agent), at the content-tier
      // price. class multiplier ×1 ⇒ effective ×8/×3/×1.
      monetizeRule("StandardPremium", 30, tierPath("/premium/"), "8"),
      monetizeRule("StandardData", 31, tierPath("/data/"), "3"),
      monetizeRule("StandardArticles", 32, tierPath("/articles/"), "1"),
    ]);

    // === Escape-hatch: MonetizationConfig (Base Sepolia / TEST mode) ===
    // Holds ONLY the base price + payment network. The per-tier/per-class pricing
    // lives in the PriceMultiplier on each Monetize rule above (effective = base ×
    // multiplier). Flip CurrencyMode to REAL and Chain to BASE / SOLANA for go-live.
    webAcl.addPropertyOverride("MonetizationConfig", {
      CurrencyMode: "TEST",
      CryptoConfig: {
        PaymentNetworks: [
          {
            Chain: "BASE_SEPOLIA",
            WalletAddress: payToWallet.valueAsString,
            Prices: [{ Amount: basePrice.valueAsString, Currency: "USDC" }],
          },
        ],
      },
    });

    // === RSL license terms — CloudFront Response Header Policy (Link header) ===
    // "AI traffic monetization tells agents how much to pay but not what they're
    // allowed to do." RSL communicates the usage license. We inject a `Link` header
    // referencing the RSL license.xml on every ORIGIN response (free + monetized);
    // the WAF 402 itself carries no Link header (per the license-terms doc). The
    // license.xml is served from a FREE path (/quillrook/license.xml) so any agent
    // can fetch and parse the terms before deciding to pay.
    const rslPolicy = new cloudfront.ResponseHeadersPolicy(this, "RslLinkHeaderPolicy", {
      responseHeadersPolicyName: "agentcore-waf-rsl-link",
      comment: "Injects RSL Link: rel=license header for AI-agent license discovery",
      customHeadersBehavior: {
        customHeaders: [
          {
            header: "Link",
            value: `<${licenseUrl.valueAsString}>; rel="license"; type="application/rsl+xml"`,
            override: true,
          },
        ],
      },
    });

    // === Content (CloudFront, NO Lambda@Edge — that is the whole point) ===
    const contentBucket = new s3.Bucket(this, "WafContentBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "WafDistribution", {
      webAclId: webAcl.attrArn,
      enableIpv6: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(contentBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // RSL license discovery on origin responses. A single behavior serves all
        // tiers, so the Link header rides every origin 2xx; the WAF 402 does not.
        responseHeadersPolicy: rslPolicy,
        // No edgeLambdas — the WAF Monetize action handles 402 / verify / settle.
      },
      defaultRootObject: "index.json",
    });

    new s3deploy.BucketDeployment(this, "DeployWafContent", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../sample-content"))],
      destinationBucket: contentBucket,
      distribution,
    });

    // === Outputs ===
    new cdk.CfnOutput(this, "WafMerchantUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "WAF-monetized merchant URL (Quillrook Press) — set as WAF_MERCHANT_URL for the agent",
    });

    new cdk.CfnOutput(this, "WafWebAclArn", {
      value: webAcl.attrArn,
      description: "Web ACL ARN — target for scripts/apply-waf-monetization.sh fallback if CFN lacks MonetizationConfig",
    });

    new cdk.CfnOutput(this, "WafContentBucketName", {
      value: contentBucket.bucketName,
    });

    new cdk.CfnOutput(this, "WafLicenseUrl", {
      value: `https://${distribution.distributionDomainName}/quillrook/license.xml`,
      description: "RSL license.xml URL (also referenced relatively by the Link: rel=license header)",
    });
  }
}
