"use client";

import { useState, useCallback, useId, useRef } from "react";
import { CopilotChat, useRenderTool } from "@copilotkit/react-core/v2";
import { HttpRequestCard } from "@/components/tool-cards";
import { ActivityPanel, ActivityEntry } from "@/components/activity-panel";

export default function HomePage() {
  const [stepMode, setStepMode] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [budget, setBudget] = useState({ spent: 0, total: 1.0, articles: 0 });
  const [highlightGroup, setHighlightGroup] = useState<string | null>(null);
  const toolCallCounter = useRef(0);

  // Track tool calls for the activity panel
  const addActivity = useCallback((entry: Omit<ActivityEntry, "id" | "timestamp">) => {
    setActivities((prev) => [...prev, { ...entry, id: crypto.randomUUID(), timestamp: new Date() }]);
  }, []);

  // Render http_request tool calls as inline cards
  useRenderTool({
    name: "http_request",
    render: ({ args, result, status }) => {
      const url = args?.url || "";
      const path = extractPath(url);
      const groupId = `tool-${url}-${toolCallCounter.current}`;

      // Add to activity panel on completion
      if (status === "complete" && result) {
        toolCallCounter.current++;
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        const statusCode = resultStr.includes("402") || resultStr.includes("PAYMENT_REQUIRED") ? 402 : 200;

        setTimeout(() => {
          addActivity({ type: "request", method: args?.method || "GET", path, groupId });
          addActivity({
            type: "response",
            path,
            status: statusCode,
            detail: statusCode === 402 ? "Payment Required" : path.endsWith("catalog.json") ? "catalog" : "OK",
            groupId,
          });

          if (statusCode === 200 && (args?.headers?.["X-PAYMENT"] || args?.headers?.["x-payment"])) {
            const price = extractPrice(resultStr);
            if (price > 0) {
              setBudget((b) => ({ ...b, spent: b.spent + price, articles: b.articles + 1 }));
              addActivity({ type: "payment", path, detail: `$${price.toFixed(4)} USDC`, groupId });
            }
          }

          // Highlight this group in the activity panel
          setHighlightGroup(groupId);
        }, 0);
      }

      return (
        <HttpRequestCard
          args={args || {}}
          result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
          status={status === "complete" ? "complete" : "running"}
        />
      );
    },
  }, [addActivity]);

  const systemInstructions = stepMode
    ? "IMPORTANT: You are in STEP-BY-STEP mode. After each phase, STOP and ask the user to confirm before proceeding. The phases are: 1) Discovery (fetch catalogs), 2) Trust evaluation, 3) Decision framework analysis, 4) Purchase execution, 5) Synthesis, 6) Feedback. After completing each phase, say 'Ready to proceed to [next phase]?' and WAIT for the user to say 'Continue'."
    : "";

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b bg-slate-900 text-white flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">
            🔐 AgentCore Payments — Media Research Demo
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            x402 micropayments • $1.00 USDC budget • 4 merchants • Base Sepolia
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Budget mini-gauge */}
          <div className="text-xs text-slate-300 text-right">
            <div>${(budget.total - budget.spent).toFixed(4)} left</div>
            <div className="text-slate-500">{budget.articles} purchased</div>
          </div>
          {/* Step mode toggle */}
          <button
            onClick={() => setStepMode(!stepMode)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              stepMode
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {stepMode ? "👣 Step-by-Step" : "🔍 Auto"}
          </button>
          {/* Panel toggle */}
          <button
            onClick={() => setShowPanel(!showPanel)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              showPanel
                ? "bg-blue-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {showPanel ? "◀ Hide Panel" : "▶ Show Panel"}
          </button>
        </div>
      </header>

      {/* Main content: chat + activity panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat */}
        <div className={`flex-1 overflow-hidden ${showPanel ? "max-w-[60%]" : ""}`}>
          <CopilotChat
            className="h-full"
            instructions={systemInstructions}
            labels={{
              title: "Research Agent",
              initial: stepMode
                ? "**Step-by-Step mode active.** I'll pause between each phase for your approval.\n\nClick a suggestion to begin:"
                : "I'm a media research agent with a **$1.00 USDC** budget. I evaluate content from 4 publishers using trust, quality, and cost-benefit analysis.\n\nClick a suggestion or type your own research topic:",
            }}
            suggestions={[
              { title: "🔍 Full Research", message: "Research how AI agents are changing publisher revenue models" },
              { title: "⭐ Trust Scores", message: "What merchants are available and what are their trust scores?" },
              { title: "📊 Streaming Data", message: "Find the latest streaming platform metrics and subscriber trends" },
            ]}
          />
        </div>

        {/* Activity Panel */}
        {showPanel && (
          <div className="w-[40%] min-w-[320px]">
            <ActivityPanel entries={activities} budget={budget} visible={true} highlightGroupId={highlightGroup} />
          </div>
        )}
      </div>
    </div>
  );
}

function extractPath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function extractPrice(result: string): number {
  // Try to find price from the 402 payload that was paid
  const match = result.match(/"amount":\s*([\d.]+)/);
  if (match) return parseFloat(match[1]);
  const priceMatch = result.match(/"price_usdc":\s*([\d.]+)/);
  if (priceMatch) return parseFloat(priceMatch[1]);
  return 0;
}
