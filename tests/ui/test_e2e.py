"""E2E test for the web UI — requires both backend and frontend running.

Run: pytest tests/ui/ (after starting servers on ports 8000 and 3000)
Skipped if localhost:3000 is not reachable.
"""

import pytest
import httpx


def is_ui_running():
    try:
        return httpx.get("http://localhost:3000", timeout=3).status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not is_ui_running(),
    reason="UI not running on localhost:3000 — start with `npm run dev` in ui/"
)


class TestUILoads:
    """Basic UI rendering tests."""

    def test_page_loads_200(self):
        """Frontend returns 200."""
        resp = httpx.get("http://localhost:3000", timeout=10)
        assert resp.status_code == 200

    def test_page_has_title(self):
        """Page contains the demo title."""
        resp = httpx.get("http://localhost:3000", timeout=10)
        assert "AgentCore Payments" in resp.text

    def test_copilotkit_runtime_info(self):
        """CopilotKit runtime returns agent info."""
        resp = httpx.post(
            "http://localhost:3000/api/copilotkit",
            json={"method": "info"},
            timeout=10,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "agents" in data
        assert "default" in data["agents"]


class TestBackendAGUI:
    """Backend AG-UI endpoint tests."""

    def test_ping(self):
        """Backend health check passes."""
        resp = httpx.get("http://localhost:8000/ping", timeout=5)
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"

    def test_ag_ui_endpoint_accepts_post(self):
        """AG-UI endpoint accepts a properly formatted request."""
        resp = httpx.post(
            "http://localhost:8000/",
            json={
                "threadId": "test-thread",
                "runId": "test-run",
                "state": {},
                "messages": [{"id": "1", "role": "user", "content": "hello"}],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            },
            timeout=60,
            headers={"Accept": "text/event-stream"},
        )
        # Should return 200 with SSE stream
        assert resp.status_code == 200
