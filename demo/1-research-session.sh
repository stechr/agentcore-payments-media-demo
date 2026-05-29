#!/usr/bin/env bash
# 1-research-session.sh — Run the full research agent (primary demo)
#
# Usage:
#   ./demo/1-research-session.sh                          # default topic
#   ./demo/1-research-session.sh "Your custom topic"      # custom topic
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../agent"
PYTHON="$AGENT_DIR/.venv/bin/python"

source "$AGENT_DIR/.env"

if [ -n "${1:-}" ]; then
  export RESEARCH_TOPIC="$1"
fi

TOPIC="${RESEARCH_TOPIC:-How are AI agents changing publisher revenue models, and what role do micropayments play in the transition from ad-supported to agent-paid content?}"

echo "═══════════════════════════════════════════════════════════════════"
echo "  AgentCore Payments PoC — Research Session"
echo "═══════════════════════════════════════════════════════════════════"
echo
echo "  Topic:    $TOPIC"
echo "  Budget:   \$1.00 USDC"
echo "  Merchants: MediaTech Daily, Copperview, Thornwick Research, Kettlebrook Analytics"
echo "  Network:  Base Sepolia (testnet — \$0 cost)"
echo
echo "═══════════════════════════════════════════════════════════════════"
echo

$PYTHON "$AGENT_DIR/research_agent.py"
