# AgentCore Payments — AG-UI Demo App

Web frontend for the media research agent, built with [CopilotKit](https://copilotkit.ai) + [Strands](https://strandsagents.com) via the AG-UI protocol.

## Prerequisites

- Node.js 20+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- AWS credentials configured (the agent uses Amazon Bedrock, not OpenAI)

## Getting Started

1. Install dependencies:

```bash
npm install
```

> **Note:** This also installs the agent's Python dependencies via the `install:agent` script.

2. Ensure your AWS credentials and agent `.env` are configured (see `../agent/.env.example`).

3. Start the development server:

```bash
npm run dev
```

This starts both the UI (Next.js) and agent (Strands + AG-UI) servers concurrently.

## Available Scripts

- `dev` — Start both UI and agent servers
- `dev:ui` — Start only the Next.js UI
- `dev:agent` — Start only the Strands agent server
- `build` — Build for production
- `install:agent` — Install Python dependencies

## Architecture

```
Browser → Next.js (CopilotKit) → AG-UI protocol → Strands Agent → Bedrock + AgentCore Payments
```

The agent uses Amazon Bedrock for LLM inference and AgentCore Payments for x402 micropayment execution. No OpenAI dependency.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools":

1. Verify the agent is running on port 8000
2. Check AWS credentials are valid (`aws sts get-caller-identity`)
3. Ensure `../agent/.env` has all required payment resource IDs

### Python Dependencies

```bash
cd agent && uv sync
```

## License

MIT — see the LICENSE file.
