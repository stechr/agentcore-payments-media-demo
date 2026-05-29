"""
Media Research Agent — AgentCore Payments PoC

Thin wrapper around core/ — runs the research agent from CLI.
"""

import os
import sys

# Add project root to path so core/ is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import load_config, create_agent


def main():
    config = load_config(env_file=os.path.join(os.path.dirname(__file__), ".env"))

    agent = create_agent(config)

    print(f"\n{'='*70}")
    print(f"  Research Topic: {config.research_topic}")
    print(f"  Budget: $1.00 USDC")
    print(f"  Merchants: MediaTech Daily, Copperview, Thornwick Research, Kettlebrook Analytics")
    print(f"{'='*70}\n")

    result = agent(f"Research the following topic: {config.research_topic}")

    print(f"\n{'='*70}")
    print("  Research Complete")
    print(f"{'='*70}")
    print(result)


if __name__ == "__main__":
    main()
