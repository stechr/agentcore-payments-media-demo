"use client";

import { useRef, useEffect } from "react";

export interface ActivityEntry {
  id: string;
  timestamp: Date;
  type: "request" | "response" | "payment" | "decision" | "info";
  method?: string;
  path: string;
  status?: number;
  detail?: string;
  groupId?: string; // Links to the tool call card on the left
}

interface ActivityPanelProps {
  entries: ActivityEntry[];
  budget: { spent: number; total: number; articles: number };
  visible: boolean;
  highlightGroupId?: string | null; // Currently visible card's group
}

// Shared color scheme — same values used in tool-cards.tsx
export const COLORS = {
  catalog: { border: "border-l-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  trust: { border: "border-l-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  paywall: { border: "border-l-orange-500", bg: "bg-orange-50", text: "text-orange-700" },
  payment: { border: "border-l-green-600", bg: "bg-green-50", text: "text-green-700" },
  feedback: { border: "border-l-purple-500", bg: "bg-purple-50", text: "text-purple-700" },
  generic: { border: "border-l-slate-300", bg: "bg-slate-50", text: "text-slate-600" },
};

export function getColorForPath(path: string, status?: number): keyof typeof COLORS {
  if (path.includes("catalog")) return "catalog";
  if (path.includes("reputation")) return "trust";
  if (path.includes("feedback")) return "feedback";
  if (status === 402) return "paywall";
  return "generic";
}

export function ActivityPanel({ entries, budget, visible, highlightGroupId }: ActivityPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to highlighted group when it changes
  useEffect(() => {
    if (highlightGroupId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightGroupId]);

  // Also auto-scroll to bottom for new entries when no highlight is active
  useEffect(() => {
    if (!highlightGroupId && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [entries.length, highlightGroupId]);

  if (!visible) return null;

  const pct = budget.total > 0 ? (budget.spent / budget.total) * 100 : 0;

  return (
    <div className="h-full flex flex-col border-l border-slate-200 bg-slate-50">
      {/* Budget gauge */}
      <div className="p-3 border-b border-slate-200 bg-white">
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          <span>💰 Budget</span>
          <span>${budget.spent.toFixed(4)} / ${budget.total.toFixed(2)}</span>
        </div>
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              pct > 80 ? "bg-red-500" : pct > 50 ? "bg-yellow-500" : "bg-green-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>{budget.articles} articles purchased</span>
          <span>${(budget.total - budget.spent).toFixed(4)} remaining</span>
        </div>
      </div>

      {/* Activity log */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-xs" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            Activity will appear here as the agent works...
          </div>
        )}
        {entries.map((entry) => {
          const isHighlighted = highlightGroupId && entry.groupId === highlightGroupId;
          return (
            <div
              key={entry.id}
              ref={isHighlighted ? highlightRef : undefined}
              data-group={entry.groupId}
            >
              <ActivityRow entry={entry} highlighted={!!isHighlighted} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityRow({ entry, highlighted }: { entry: ActivityEntry; highlighted: boolean }) {
  const time = entry.timestamp.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const colorKey = entry.type === "payment" ? "payment" : getColorForPath(entry.path, entry.status);
  const color = COLORS[colorKey];

  return (
    <div className={`flex gap-2 py-0.5 px-1.5 rounded border-l-2 ${color.border} ${
      highlighted ? `${color.bg} ring-1 ring-offset-1 ring-blue-300` : ""
    } ${color.text}`}>
      <span className="text-slate-400 shrink-0">{time}</span>
      <span className="shrink-0">{entry.type === "request" ? "→" : entry.type === "response" ? "←" : "💳"}</span>
      <span className="truncate">
        {entry.method && <span className="font-bold">{entry.method} </span>}
        {entry.path}
        {entry.status && <span className="ml-1 opacity-70">[{entry.status}]</span>}
        {entry.detail && <span className="ml-1 opacity-70">— {entry.detail}</span>}
      </span>
    </div>
  );
}
