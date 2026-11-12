"use client";

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@Kavero/ui/components/card";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Textarea } from "@Kavero/ui/components/textarea";
import { toast } from "sonner";

import { ExtensionCallCancelledError, type EditorExtensionContext } from "./types";

type IntegrationsApi = EditorExtensionContext["integrations"];
type Connection = Awaited<ReturnType<IntegrationsApi["listConnections"]>>[number];

function parseArguments(raw: string): Record<string, import("@Kavero/extensions").JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Enter valid JSON arguments.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be a JSON object.");
  const stack: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let size = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > 24) throw new Error("Tool arguments are nested too deeply.");
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Tool arguments must use finite numbers.");
      continue;
    }
    if (typeof value === "string") {
      size += value.length;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 500) throw new Error("Tool arguments contain too many items.");
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (typeof value !== "object") throw new Error("Tool arguments must contain JSON values only.");
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 500) throw new Error("Tool arguments contain too many fields.");
    for (const [key, item] of entries) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Tool arguments contain a reserved field name.");
      size += key.length;
      stack.push({ value: item, depth: depth + 1 });
    }
  }
  if (size > 64_000) throw new Error("Tool arguments are too large (64 KB maximum).");
  return parsed as Record<string, import("@Kavero/extensions").JsonValue>;
}

function stringifyResult(value: unknown) {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) return "No result returned.";
    return json.length > 20_000 ? `${json.slice(0, 20_000)}\n… Result truncated in the editor.` : json;
  } catch {
    return "The tool returned a value that cannot be displayed as JSON.";
  }
}

function ConnectedToolsPanel({ integrations }: { integrations: IntegrationsApi }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedConnection = connections.find((connection) => connection.id === connectionId);
  const selectedTool = selectedConnection?.tools.find((tool) => tool.name === toolName);

  async function refreshConnections() {
    setLoading(true);
    try {
      const next = await integrations.listConnections();
      setConnections(next);
      if (!next.some((connection) => connection.id === connectionId)) {
        setConnectionId(next[0]?.id ?? null);
        setToolName(null);
      }
      setResult(null);
    } catch (error) {
      toast.error((error as Error).message || "Could not load connected services.");
    } finally {
      setLoading(false);
    }
  }

  async function runTool() {
    if (!selectedConnection || !selectedTool) return;
    let args: Record<string, import("@Kavero/extensions").JsonValue>;
    try {
      args = parseArguments(argsText);
    } catch (error) {
      toast.error((error as Error).message);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      // The editor host asks the user to confirm every call before it runs.
      const output = await integrations.callTool(selectedConnection.id, selectedTool.name, args);
      setResult(stringifyResult(output));
    } catch (error) {
      if (error instanceof ExtensionCallCancelledError) return;
      const message = (error as Error).message || "The connected tool failed.";
      setResult(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3 p-3">
      <Card size="sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle>Connected tools</CardTitle>
              <CardDescription>Run tools from MCP services you connected in settings. Credentials stay on the server.</CardDescription>
            </div>
            <Button variant="outline" size="icon-sm" aria-label="Refresh connected services" title="Refresh connected services" disabled={loading} onClick={() => void refreshConnections()}>
              <HugeiconsIcon icon={Refresh01Icon} className={loading ? "animate-spin" : undefined} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
              {connections.length ? (
            <>
              <div className="grid gap-2">
                <label className="text-xs font-medium" htmlFor="connected-tools-connection">Connected service</label>
                <SimpleSelect id="connected-tools-connection" aria-label="Connected service" value={connectionId} onValueChange={(value) => { setConnectionId(value); setToolName(null); setResult(null); }} placeholder="Choose a service" options={connections.map((connection) => ({ value: connection.id, label: connection.name }))} />
              </div>
              {selectedConnection && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedConnection.status === "ok" ? "secondary" : "outline"}>{selectedConnection.status === "ok" ? "Connected" : selectedConnection.status === "error" ? "Needs attention" : "Not checked"}</Badge>
                  <span className="text-xs text-muted-foreground">{selectedConnection.tools.length} available {selectedConnection.tools.length === 1 ? "tool" : "tools"}</span>
                </div>
              )}
              {selectedConnection?.tools.length ? (
                <div className="grid gap-2">
                  <label className="text-xs font-medium" htmlFor="connected-tools-tool">Tool</label>
                  <SimpleSelect id="connected-tools-tool" aria-label="Connected tool" value={toolName} onValueChange={(value) => { setToolName(value); setResult(null); }} placeholder="Choose a tool" options={selectedConnection.tools.map((tool) => ({ value: tool.name, label: tool.title ? `${tool.title} · ${tool.name}` : tool.name }))} />
                  {selectedTool?.description && <p className="text-xs leading-relaxed text-muted-foreground">{selectedTool.description}</p>}
                </div>
              ) : <p className="text-xs text-muted-foreground">This service has no available tools. Refresh its connection in Settings to update its tool list.</p>}
              <div className="grid gap-2">
                <label className="text-xs font-medium" htmlFor="connected-tools-args">Arguments (JSON)</label>
                <Textarea id="connected-tools-args" value={argsText} onChange={(event) => setArgsText(event.target.value)} className="min-h-28 rounded-xl font-mono text-xs" spellCheck={false} aria-describedby="connected-tools-args-help" />
                <p id="connected-tools-args-help" className="text-[11px] text-muted-foreground">Enter an object such as <code>{"{\"query\":\"…\"}"}</code>. Calls require your confirmation.</p>
              </div>
              <Button disabled={loading || !selectedTool} onClick={() => void runTool()}>
                <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
                {loading ? "Working…" : "Run tool"}
              </Button>
              {result !== null && <pre aria-live="polite" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-[11px] leading-relaxed">{result}</pre>}
            </>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">Connect an MCP service to make its tools available here.</p>
              <div><Link href="/settings#connections"><Button variant="outline" size="sm">Manage connections</Button></Link></div>
              <Button variant="secondary" disabled={loading} onClick={() => void refreshConnections()}>
                <HugeiconsIcon icon={Refresh01Icon} data-icon="inline-start" />
                {loading ? "Loading…" : "Load connections"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const connectedToolsExtension = {
  manifest: {
    id: "com.kavero.connected-tools",
    name: "Connected tools",
    description: "Run tools from services you connect to Kavero through MCP.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["editor.ui", "integrations.call"] as const,
    types: ["integration", "plugin"] as const,
    categories: ["Integrations", "Productivity"],
    license: "MIT",
  },
  contribute: (context: EditorExtensionContext) => ({
    panels: [{
      id: "connected-tools",
      label: "Connected tools",
      icon: <HugeiconsIcon icon={PlayIcon} />,
      content: <ConnectedToolsPanel integrations={context.integrations} />,
    }],
  }),
} satisfies import("./types").EditorExtension;
