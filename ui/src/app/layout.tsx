"use client";

import { useEffect } from "react";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core/v2";

function InspectorKiller() {
  useEffect(() => {
    // Remove the CopilotKit inspector widget (diamond button in top-right)
    const interval = setInterval(() => {
      const el = document.querySelector('[class*="inspector"]') ||
        document.querySelector('button[aria-label*="Inspector"]');
      if (el) { el.remove(); clearInterval(interval); }
      // Also try shadow DOM approach
      document.querySelectorAll('*').forEach(node => {
        if (node.shadowRoot) {
          const btn = node.shadowRoot.querySelector('button');
          if (btn?.textContent?.includes('Inspector')) { node.remove(); clearInterval(interval); }
        }
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);
  return null;
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>AgentCore Payments Demo</title>
      </head>
      <body className="antialiased">
        <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={true} enableInspector={false}>
          <InspectorKiller />
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
