#!/usr/bin/env python3
"""settle_one.py — deterministically settle ONE x402 request against the WAF
(Quillrook Press) publisher, with no LLM in the loop.

Flow: GET <path> -> 402 (x402 v2 `payment-required` header) -> AgentCore Payments
`generate_payment_header` (signs + settles on-chain) -> retry with the returned
PAYMENT-SIGNATURE/X-PAYMENT header -> 200 + `payment-response` header (tx hash).

Emits a single JSON object on stdout describing the full settled transaction —
this is the primitive the Publisher Console UI (/api/settle) and the A4 validation
both call. All HTTP calls are bounded with a hard timeout.

Env required: PAYMENT_MANAGER_ARN, PAYMENT_INSTRUMENT_ID, PAYMENT_SESSION_ID,
WAF_MERCHANT_URL (+ AWS creds in env). USER_ID defaults to researcher001.
"""
import os, sys, json, base64, uuid, argparse, urllib.request, urllib.error

os.environ["PATH"] = "/usr/local/bin:" + os.environ.get("PATH", "")
from bedrock_agentcore.payments.manager import PaymentManager

TIMEOUT = 45
USDC_DECIMALS = 6


def _ensure_session(mgr):
    """Return a usable payment session id — env one if present, else create a fresh
    60-min session (sessions expire; instrument + WalletHub grant persist)."""
    sid = os.environ.get("PAYMENT_SESSION_ID")
    if sid:
        return sid
    r = mgr.create_payment_session(
        user_id=os.environ.get("USER_ID", "researcher001"),
        limits={"maxSpendAmount": {"value": "1.00", "currency": "USD"}},
        expiry_time_in_minutes=60,
    )
    return r["paymentSessionId"] if "paymentSessionId" in r else r["paymentSession"]["paymentSessionId"]


def _new_session(mgr):
    """Always create a fresh 60-min payment session (used for retry)."""
    r = mgr.create_payment_session(
        user_id=os.environ.get("USER_ID", "researcher001"),
        limits={"maxSpendAmount": {"value": "1.00", "currency": "USD"}},
        expiry_time_in_minutes=60,
    )
    return r["paymentSessionId"] if "paymentSessionId" in r else r["paymentSession"]["paymentSessionId"]


def _get(url, headers, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        return resp.getcode(), {k.lower(): v for k, v in resp.getheaders()}, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def _decode_b64_json(s):
    try:
        return json.loads(base64.b64decode(s).decode())
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", required=True, help="content path, e.g. /quillrook/premium/managed-paywall-economics.json")
    ap.add_argument("--agent-class", default=None, help="x-demo-agent-class header value (optional)")
    ap.add_argument("--fresh-session", action="store_true", help="always create a new payment session")
    args = ap.parse_args()
    if args.fresh_session:
        os.environ.pop("PAYMENT_SESSION_ID", None)

    base = os.environ["WAF_MERCHANT_URL"].rstrip("/")
    url = base + args.path
    req_headers = {"Accept": "application/json"}
    if args.agent_class:
        req_headers["x-demo-agent-class"] = args.agent_class

    out = {"path": args.path, "url": url, "agent_class": args.agent_class}

    # 1) trigger the 402
    code, headers, _ = _get(url, req_headers)
    pr_b64 = headers.get("payment-required")
    out["initial_status"] = code
    if code != 402 or not pr_b64:
        out["result"] = "no-payment-required"
        out["link_header"] = headers.get("link")
        print(json.dumps(out)); return
    challenge = _decode_b64_json(pr_b64) or {}
    accept = (challenge.get("accepts") or [{}])[0]
    amount = accept.get("amount")
    out.update({
        "price_usdc": (int(amount) / 10**USDC_DECIMALS) if amount else None,
        "amount_units": amount,
        "payTo": accept.get("payTo"),
        "network": accept.get("network"),
        "asset": accept.get("asset"),
        "x402_version": challenge.get("x402Version"),
        "link_header": headers.get("link"),
    })

    # 2+3) sign + settle on-chain via AgentCore Payments, retry once on a
    # transient facilitator rejection (invalid_payload / non-200) with a fresh
    # session — observed as an occasional same-path replay glitch.
    mgr = PaymentManager(payment_manager_arn=os.environ["PAYMENT_MANAGER_ARN"], region_name="us-east-1")
    code2 = None; headers2 = {}; presp = None; tx = None; session_id = None
    for attempt in (1, 2, 3):
        session_id = _ensure_session(mgr) if (attempt == 1 and os.environ.get("PAYMENT_SESSION_ID")) else _new_session(mgr)
        pay_req = {"statusCode": 402, "headers": headers, "body": challenge}
        hdr = mgr.generate_payment_header(
            payment_instrument_id=os.environ["PAYMENT_INSTRUMENT_ID"],
            payment_session_id=session_id,
            payment_required_request=pay_req,
            user_id=os.environ.get("USER_ID", "researcher001"),
            network_preferences=[accept.get("network", "eip155:84532")],
        )
        out["payment_header_name"] = list(hdr.keys())[0] if hdr else None
        retry_headers = dict(req_headers); retry_headers.update(hdr)
        code2, headers2, _ = _get(url, retry_headers)
        presp_b64 = headers2.get("payment-response") or headers2.get("x-payment-response")
        presp = _decode_b64_json(presp_b64) if presp_b64 else None
        tx = None
        if isinstance(presp, dict):
            tx = presp.get("transaction") or presp.get("txHash") or presp.get("transactionHash")
        if code2 == 200 and tx:
            break
        import time as _t; _t.sleep(2)
    out["payment_session_id"] = session_id
    out["settled_status"] = code2
    presp_b64 = headers2.get("payment-response") or headers2.get("x-payment-response")
    presp = _decode_b64_json(presp_b64) if presp_b64 else None
    out["payment_response"] = presp
    tx = None
    if isinstance(presp, dict):
        tx = presp.get("transaction") or presp.get("txHash") or presp.get("transactionHash") \
             or (presp.get("settlement") or {}).get("transaction")
    out["tx_hash"] = tx
    if tx:
        out["basescan_url"] = f"https://sepolia.basescan.org/tx/{tx}"
    out["result"] = "settled" if (code2 == 200 and tx) else ("paid-no-txhash" if code2 == 200 else "settle-failed")
    print(json.dumps(out))


if __name__ == "__main__":
    main()
