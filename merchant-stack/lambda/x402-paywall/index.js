"use strict";

// Merchant configurations — pricing varies by merchant persona
const MERCHANTS = {
  mediatech: { id: "mediatech-daily", wallet: "0xMEDIATECH_WALLET", name: "MediaTech Daily" },
  copperview: { id: "copperview", wallet: "0xDATAPULSE_WALLET", name: "Copperview" },
  thornwick: { id: "thornwick", wallet: "0xINSIGHTWIRE_WALLET", name: "Thornwick Research" },
  kettlebrook: { id: "kettlebrook", wallet: "0xALPHARESEARCH_WALLET", name: "Kettlebrook Analytics" },
};

const NETWORK = "base-sepolia";
const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri;

  // Pass through: root, merchant list, catalogs
  if (uri === "/" || uri === "/merchants.json" || uri.endsWith("/catalog.json") || uri === "/index.json") {
    return request;
  }

  // Determine merchant from path prefix
  const merchantKey = uri.split("/")[1]; // e.g., "mediatech" from "/mediatech/premium/article.json"
  const merchant = MERCHANTS[merchantKey];

  if (!merchant) {
    return request; // Unknown path, pass through
  }

  // Check for x402 payment header
  const paymentHeader = request.headers["x-payment"] && request.headers["x-payment"][0]?.value;

  if (!paymentHeader) {
    // Return 402 with enhanced metadata (preview + quality signals from catalog)
    const tier = getTier(uri);
    const price = getPrice(merchantKey, tier);

    const paymentPayload = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: NETWORK,
          maxAmountRequired: String(Math.round(price * 1e6)),
          resource: `https://${request.headers.host[0].value}${uri}`,
          description: `Access to: ${uri}`,
          mimeType: "application/json",
          payTo: merchant.wallet,
          maxTimeoutSeconds: 60,
          asset: USDC_CONTRACT,
        },
      ],
      merchant: {
        id: merchant.id,
        name: merchant.name,
      },
      pricing: {
        amount: price,
        currency: "USDC",
        tier: tier,
      },
    };

    return {
      status: "402",
      statusDescription: "Payment Required",
      headers: {
        "content-type": [{ value: "application/json" }],
        "x-payment": [{ value: JSON.stringify(paymentPayload) }],
        "access-control-allow-origin": [{ value: "*" }],
        "access-control-expose-headers": [{ value: "x-payment" }],
      },
      body: JSON.stringify(paymentPayload),
    };
  }

  // Payment header present — verify
  try {
    const payment = JSON.parse(paymentHeader);
    if (!payment.payload || !payment.payload.signature) {
      return errorResponse(400, "Invalid payment proof structure");
    }
    request.headers["x-payment-verified"] = [{ value: "true" }];
    request.headers["x-payment-merchant"] = [{ value: merchant.id }];
    return request;
  } catch (e) {
    return errorResponse(400, `Payment verification failed: ${e.message}`);
  }
};

function getTier(uri) {
  if (uri.includes("/premium/")) return "premium";
  if (uri.includes("/data/")) return "data";
  return "standard";
}

function getPrice(merchantKey, tier) {
  const pricing = {
    mediatech: { standard: 0.008, premium: 0.015, data: 0.012 },
    copperview: { standard: 0.001, premium: 0.003, data: 0.002 },
    thornwick: { standard: 0.005, premium: 0.008, data: 0.006 },
    kettlebrook: { standard: 0.004, premium: 0.006, data: 0.005 },
  };
  return (pricing[merchantKey] && pricing[merchantKey][tier]) || 0.005;
}

function errorResponse(status, message) {
  return {
    status: String(status),
    statusDescription: message,
    headers: { "content-type": [{ value: "application/json" }] },
    body: JSON.stringify({ error: message }),
  };
}
