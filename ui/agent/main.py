"""AgentCore Payments Research Agent — AG-UI Integration.

Exposes the media research agent via AG-UI protocol for the CopilotKit frontend.
Run: cd ui/agent && .venv/bin/uvicorn main:app --port 8000
"""

import os
import sys
from pathlib import Path

# Add project root to path for core/ imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Load environment
_project_root = Path(__file__).parent.parent
load_dotenv(_project_root / "agent" / ".env")
load_dotenv(_project_root / ".env")

# Ensure AWS credential tooling is in PATH
os.environ["PATH"] = "/usr/local/bin:" + os.environ.get("PATH", "")

from ag_ui_strands import StrandsAgent, create_strands_app
from strands import Agent
from strands_tools import http_request
from bedrock_agentcore.payments.integrations.config import AgentCorePaymentsPluginConfig
from bedrock_agentcore.payments.integrations.strands.plugin import AgentCorePaymentsPlugin

from core.config import load_config
from core.agent import SYSTEM_PROMPT_TEMPLATE

# Load payment config
_config = load_config(env_file=_project_root / "agent" / ".env")

# Build the Strands agent
_plugin_config = AgentCorePaymentsPluginConfig(
    payment_manager_arn=_config.payment_manager_arn,
    user_id=_config.user_id,
    payment_instrument_id=_config.payment_instrument_id,
    payment_session_id=_config.payment_session_id,
    payment_connector_id=_config.payment_connector_id,
    region=_config.region,
)
_plugin = AgentCorePaymentsPlugin(_plugin_config)

_system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
    merchant_url=_config.merchant_url,
    trust_registry_url=_config.trust_registry_url,
    feedback_url=_config.feedback_url,
)

_agent = Agent(
    system_prompt=_system_prompt,
    tools=[http_request],
    plugins=[_plugin],
)

# Wrap in AG-UI StrandsAgent
_strands_agent = StrandsAgent(
    agent=_agent,
    name="research-agent",
    description="Media research agent with autonomous x402 micropayments.",
)

# Create the FastAPI/Starlette app
app = create_strands_app(agent=_strands_agent)
