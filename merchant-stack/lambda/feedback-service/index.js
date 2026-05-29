"use strict";

// In-memory feedback store (resets on cold start — fine for demo)
const feedback = [];

exports.handler = async (event) => {
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };

  // POST /feedback — agent submits quality rating
  if (path === "/feedback" && method === "POST") {
    let body;
    try {
      let rawBody = event.body || "{}";
      // API Gateway base64-encodes body when Content-Type is missing
      if (event.isBase64Encoded) {
        rawBody = Buffer.from(rawBody, "base64").toString("utf-8");
      }
      body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body", hint: "Send Content-Type: application/json" }) };
    }
    const { merchantId, articleId, rating, reason, useful } = body;

    if (!merchantId || !articleId || rating === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Required: merchantId, articleId, rating" }) };
    }

    const entry = {
      id: `fb-${Date.now()}`,
      merchantId,
      articleId,
      rating: Math.min(5, Math.max(1, Number(rating))),
      reason: reason || "",
      useful: Boolean(useful),
      timestamp: new Date().toISOString(),
    };
    feedback.push(entry);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        message: "Feedback recorded",
        entry,
        note: "In production, this updates the trust registry scores",
      }),
    };
  }

  // GET /feedback — list all feedback (for demo visibility)
  if (path === "/feedback" && method === "GET") {
    return { statusCode: 200, headers, body: JSON.stringify({ feedback, count: feedback.length }) };
  }

  // GET /feedback/{merchantId} — feedback for a specific merchant
  const merchantMatch = path.match(/^\/feedback\/([^/]+)$/);
  if (merchantMatch && method === "GET") {
    const merchantFeedback = feedback.filter((f) => f.merchantId === merchantMatch[1]);
    return { statusCode: 200, headers, body: JSON.stringify({ merchantId: merchantMatch[1], feedback: merchantFeedback, count: merchantFeedback.length }) };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found", availableEndpoints: ["POST /feedback", "GET /feedback", "GET /feedback/{merchantId}"] }) };
};
