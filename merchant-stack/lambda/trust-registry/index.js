"use strict";

// Synthetic reputation data — pre-seeded to show clear patterns
const MERCHANTS = {
  "mediatech-daily": {
    merchantId: "mediatech-daily",
    name: "MediaTech Daily",
    trustScore: 4.8,
    totalTransactions: 203,
    disputeRate: 0.01,
    avgRating: 4.7,
    ratingBreakdown: { "5": 142, "4": 48, "3": 10, "2": 2, "1": 1 },
    recentRatings: [5, 5, 4, 5, 5, 4, 5, 5, 5, 4],
    badges: ["verified-publisher", "consistent-quality", "primary-research"],
    summary: "Established premium publisher with consistently high-quality primary research. Very low dispute rate. Recommended for high-value research tasks.",
  },
  copperview: {
    merchantId: "copperview",
    name: "Copperview",
    trustScore: 2.1,
    totalTransactions: 156,
    disputeRate: 0.15,
    avgRating: 2.3,
    ratingBreakdown: { "5": 12, "4": 20, "3": 35, "2": 52, "1": 37 },
    recentRatings: [2, 1, 3, 2, 2, 1, 3, 2, 1, 2],
    badges: [],
    warnings: ["high-dispute-rate", "stale-data-reports", "unverified-publisher"],
    summary: "Budget aggregator with high dispute rate. Content often stale or thin. Use only when no alternative exists and price justifies risk.",
  },
  thornwick: {
    merchantId: "thornwick",
    name: "Thornwick Research",
    trustScore: null,
    totalTransactions: 3,
    disputeRate: 0.0,
    avgRating: 4.3,
    ratingBreakdown: { "5": 1, "4": 2, "3": 0, "2": 0, "1": 0 },
    recentRatings: [4, 5, 4],
    badges: ["verified-publisher"],
    warnings: ["insufficient-history"],
    summary: "New entrant with verified credentials but insufficient transaction history for reliable trust assessment. Early ratings are positive. Recommend limited trial purchases.",
  },
  kettlebrook: {
    merchantId: "kettlebrook",
    name: "Kettlebrook Analytics",
    trustScore: 3.5,
    totalTransactions: 82,
    disputeRate: 0.06,
    avgRating: 3.4,
    ratingBreakdown: { "5": 18, "4": 25, "3": 22, "2": 12, "1": 5 },
    recentRatings: [3, 4, 4, 3, 2, 4, 3, 5, 3, 4],
    badges: ["verified-publisher"],
    warnings: ["occasional-stale-data"],
    summary: "Mid-tier research provider. Generally reliable but occasionally delivers outdated content. Good value at price point when freshness is not critical.",
  },
  "quillrook-press": {
    merchantId: "quillrook-press",
    name: "Quillrook Press",
    trustScore: 4.9,
    totalTransactions: 64,
    disputeRate: 0.0,
    avgRating: 4.9,
    ratingBreakdown: { "5": 58, "4": 5, "3": 1, "2": 0, "1": 0 },
    recentRatings: [5, 5, 5, 4, 5, 5, 5, 5, 5, 5],
    badges: ["verified-publisher", "edge-settled", "on-chain-verified", "consistent-quality"],
    summary: "Premium publisher whose payments are verified and settled on-chain at the edge (AWS WAF AI traffic monetization) rather than via a structural header check. Zero disputes — every served response corresponds to a confirmed on-chain settlement. Recommended for high-value tasks where payment integrity matters.",
  },
};

exports.handler = async (event) => {
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";

  // CORS headers
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };

  // GET /merchants — list all
  if (path === "/merchants" && method === "GET") {
    const summary = Object.values(MERCHANTS).map((m) => ({
      merchantId: m.merchantId,
      name: m.name,
      trustScore: m.trustScore,
      totalTransactions: m.totalTransactions,
      disputeRate: m.disputeRate,
      badges: m.badges,
      warnings: m.warnings,
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ merchants: summary }) };
  }

  // GET /merchants/{id}/reputation — detailed
  const reputationMatch = path.match(/^\/merchants\/([^/]+)\/reputation$/);
  if (reputationMatch && method === "GET") {
    const merchant = MERCHANTS[reputationMatch[1]];
    if (!merchant) return { statusCode: 404, headers, body: JSON.stringify({ error: "Merchant not found" }) };
    return { statusCode: 200, headers, body: JSON.stringify(merchant) };
  }

  // GET /merchants/{id}/history — recent transactions
  const historyMatch = path.match(/^\/merchants\/([^/]+)\/history$/);
  if (historyMatch && method === "GET") {
    const merchant = MERCHANTS[historyMatch[1]];
    if (!merchant) return { statusCode: 404, headers, body: JSON.stringify({ error: "Merchant not found" }) };
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        merchantId: merchant.merchantId,
        recentRatings: merchant.recentRatings,
        totalTransactions: merchant.totalTransactions,
        disputeRate: merchant.disputeRate,
      }),
    };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found", availableEndpoints: ["/merchants", "/merchants/{id}/reputation", "/merchants/{id}/history"] }) };
};
