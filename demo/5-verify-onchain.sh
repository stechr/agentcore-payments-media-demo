#!/usr/bin/env bash
# 5-verify-onchain.sh — Verify payments on-chain via Base Sepolia block explorer
set -euo pipefail

WALLET="<YOUR_WALLET_ADDRESS>"
EXPLORER="https://sepolia.basescan.org/address/$WALLET"

echo "═══════════════════════════════════════════════════════════════════"
echo "  On-Chain Payment Verification"
echo "═══════════════════════════════════════════════════════════════════"
echo
echo "  Agent Wallet: $WALLET"
echo "  Network:      Base Sepolia (L2 testnet)"
echo "  Token:        USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)"
echo
echo "  Opening block explorer..."
echo "  $EXPLORER"
echo
echo "  Look for:"
echo "  • ERC-20 Token Transfers (USDC)"
echo "  • Each transfer = one article purchase"
echo "  • Amount matches article price (in micro-USDC, 6 decimals)"
echo "  • Recipient = merchant wallet address"
echo
echo "═══════════════════════════════════════════════════════════════════"

open "$EXPLORER"
