import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

const defaultAgent = new HttpAgent({
  url: `${process.env.AGENT_URL || "http://localhost:8000"}/`,
});

const runtime = new CopilotRuntime({
  agents: { default: defaultAgent },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const GET = handle(app);
export const POST = handle(app);
