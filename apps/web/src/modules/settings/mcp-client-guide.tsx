"use client";

import { useState } from "react";

import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { PageTabs, SectionHeader } from "@/components/page-tabs";
import { surface } from "@/components/surface";

type Client = "codex" | "antigravity" | "copilot" | "claude";

const CLIENTS: { id: Client; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "copilot", label: "Copilot" },
  { id: "claude", label: "Claude Code" },
];

function setup(client: Client, endpoint: string) {
  switch (client) {
    case "codex":
      return {
        title: "Codex MCP server",
        language: "toml",
        file: "~/.codex/config.toml",
        code: `[mcp_servers.kavero]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = "KAVERO_API_KEY"`,
        note: "Set KAVERO_API_KEY in the environment Codex uses, then restart Codex. Codex CLI, desktop, and its IDE extension share this host configuration.",
      };
    case "antigravity":
      return {
        title: "Antigravity MCP config",
        language: "json",
        file: "~/.gemini/config/mcp_config.json",
        code: JSON.stringify({ mcpServers: { kavero: { serverUrl: endpoint, headers: { Authorization: "Bearer YOUR_KAVERO_API_KEY" } } } }, null, 2),
        note: "Replace the placeholder in your personal config. Keep this file private and out of version control.",
      };
    case "copilot":
      return {
        title: "GitHub Copilot CLI MCP config",
        language: "json",
        file: "~/.copilot/mcp-config.json",
        code: JSON.stringify({ mcpServers: { kavero: { type: "http", url: endpoint, headers: { Authorization: "Bearer YOUR_KAVERO_API_KEY" } } } }, null, 2),
        note: "Replace the placeholder with an API key. This user-level config contains the key, so keep it private and out of source control.",
      };
    case "claude":
      return {
        title: "Claude Code MCP config",
        language: "json",
        file: ".mcp.json",
        code: JSON.stringify({ mcpServers: { kavero: { type: "http", url: endpoint, headers: { Authorization: "Bearer ${KAVERO_API_KEY}" } } } }, null, 2),
        note: "Set KAVERO_API_KEY in your shell before starting Claude Code. Claude Code expands environment variables in HTTP header values.",
      };
  }
}

/** Client-specific connection instructions for Kavero's remote Streamable HTTP MCP endpoint. */
export function McpClientGuide() {
  const [client, setClient] = useState<Client>("codex");
  const endpoint = typeof window === "undefined" ? "https://your-kavero-host.example/api/mcp" : new URL("/api/mcp", window.location.origin).toString();
  const example = setup(client, endpoint);

  return (
    <div className="grid gap-4 text-xs">
      <SectionHeader title="Connect an AI client" description="Kavero exposes a remote Streamable HTTP MCP server. Create a separate API key for each client and give it only the permissions it needs." />
      <div className={`grid gap-3 ${surface.panel}`}>
        <PageTabs label="MCP clients" tabs={CLIENTS} value={client} onChange={setClient} />
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{example.file}</p>
            <p className="text-muted-foreground">Endpoint: <code className={surface.code}>{endpoint}</code></p>
          </div>
          <HighlightedCodeBlock title={example.title} language={example.language} code={example.code} />
          <p className="text-muted-foreground">{example.note} Create and revoke keys under <strong className="font-medium text-foreground">Settings → API keys</strong>.</p>
        </div>
      </div>
    </div>
  );
}
