import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REPO_ROOT = path.resolve(process.cwd(), "..");
const PYTHON = path.join(REPO_ROOT, "agent", ".venv", "bin", "python");
const SETTLE = path.join(REPO_ROOT, "scripts", "settle_one.py");

/**
 * Drives a real, deterministic on-chain x402 settlement against the live Quillrook
 * WAF publisher by invoking scripts/settle_one.py (AgentCore Payments — no LLM).
 * Returns the settled transaction (tx hash, payer, payTo, BaseScan URL).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const contentPath: string = body.path || "/quillrook/premium/managed-paywall-economics.json";
  const agentClass: string | undefined = body.agentClass;

  const args = [SETTLE, "--path", contentPath, "--fresh-session"];
  if (agentClass) args.push("--agent-class", agentClass);

  return await new Promise<NextResponse>((resolve) => {
    const child = spawn(PYTHON, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: "/usr/local/bin:" + (process.env.PATH || "") },
    });
    let out = "", err = "";
    const killer = setTimeout(() => child.kill("SIGKILL"), 110000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(killer);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try {
        resolve(NextResponse.json(JSON.parse(line)));
      } catch {
        resolve(NextResponse.json({ result: "error", exit: code, stderr: err.slice(-800), stdout: out.slice(-400) }, { status: 200 }));
      }
    });
  });
}
