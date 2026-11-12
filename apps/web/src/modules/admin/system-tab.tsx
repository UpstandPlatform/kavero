"use client";

import { Badge } from "@Kavero/ui/components/badge";
import { Button } from "@Kavero/ui/components/button";
import { Input } from "@Kavero/ui/components/input";
import { SimpleSelect } from "@Kavero/ui/components/simple-select";
import { Switch } from "@Kavero/ui/components/switch";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { surface } from "@/components/surface";
import { makeTRPCClient } from "@/utils/trpc";

let client: ReturnType<typeof makeTRPCClient> | null = null;
const api = () => (client ??= makeTRPCClient());

type Config = Awaited<ReturnType<ReturnType<typeof api>["system"]["config"]["get"]["query"]>>;
type Section = Config["sections"][number];
type Field = Section["fields"][number];
type Value = string | number | boolean | null;

const EDITION_LABEL: Record<string, string> = { desktop: "Desktop app", "self-hosted": "Self-hosted", cloud: "Cloud" };

/**
 * Admin → System: runtime settings stored encrypted in the database, so the
 * server can be configured without editing environment variables. Fields set
 * by an environment variable are shown locked.
 */
export function SystemTab() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api().system.config.get.query().then(setConfig, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className={surface.danger + " text-sm"}>{error}</p>;
  if (!config) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid max-w-2xl gap-6">
      <p className="text-sm text-muted-foreground">
        <Badge variant="outline" className="me-2">{EDITION_LABEL[config.edition] ?? config.edition}</Badge>
        Settings saved here are encrypted where they hold credentials and apply within a few seconds on every server, without a restart.
        Values set with environment variables are locked.
      </p>
      {config.sections.map((s) => (
        <SectionForm key={s.id} section={s} onSaved={(next) => setConfig((c) => c && { ...c, sections: c.sections.map((x) => (x.id === next.id ? next : x)) })} />
      ))}
    </div>
  );
}

function SectionForm({ section, onSaved }: { section: Section; onSaved: (s: Section) => void }) {
  const initial = useMemo(() => Object.fromEntries(section.fields.map((f) => [f.key, f.type === "secret" ? "" : f.value])) as Record<string, Value>, [section]);
  const [draft, setDraft] = useState(initial);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    setDraft(initial);
    setCleared(new Set());
  }, [initial]);

  const changed = section.fields.filter((f) => !f.locked && (cleared.has(f.key) || (f.type === "secret" ? draft[f.key] !== "" : draft[f.key] !== initial[f.key])));
  const visible = (f: Field) => !f.when || f.when.in.includes(draft[f.when.field] as string | boolean);

  const save = async () => {
    setSaving(true);
    try {
      const values = Object.fromEntries(changed.map((f) => [f.key, cleared.has(f.key) ? null : (draft[f.key] === "" && f.type !== "secret" ? null : draft[f.key])]));
      const next = await api().system.config.update.mutate({ section: section.id, values });
      onSaved(next);
      toast.success(`${section.title} saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api().system.config.testStorage.mutate();
      if (r.ok) toast.success(`Storage works (${r.driver === "s3" ? "S3 bucket" : "server disk"})`);
      else toast.error(`Storage check failed: ${r.message ?? "unknown error"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={surface.panel + " grid gap-4"} aria-labelledby={`sys-${section.id}`}>
      <header>
        <h2 id={`sys-${section.id}`} className="text-sm font-semibold">{section.title}</h2>
        <p className="text-xs text-muted-foreground">{section.description}</p>
      </header>
      {section.fields.filter(visible).map((f) => (
        <FieldRow
          key={f.key}
          sectionId={section.id}
          field={f}
          value={draft[f.key] ?? null}
          cleared={cleared.has(f.key)}
          onChange={(v) => {
            setDraft((d) => ({ ...d, [f.key]: v }));
            setCleared((c) => {
              const n = new Set(c);
              n.delete(f.key);
              return n;
            });
          }}
          onClear={() => setCleared((c) => new Set(c).add(f.key))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" disabled={!changed.length || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        {changed.length > 0 && <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft(initial); setCleared(new Set()); }}>Discard</Button>}
        {section.id === "storage" && (
          <Button size="sm" variant="outline" className="ms-auto" disabled={testing || changed.length > 0} title={changed.length ? "Save first, then test" : "Write, read and delete a small test file"} onClick={test}>
            {testing ? "Testing…" : "Test storage"}
          </Button>
        )}
      </div>
    </section>
  );
}

function FieldRow({ sectionId, field: f, value, cleared, onChange, onClear }: {
  sectionId: string;
  field: Field;
  value: Value;
  cleared: boolean;
  onChange: (v: Value) => void;
  onClear: () => void;
}) {
  const id = `sys-${sectionId}-${f.key}`;
  const meta = (
    <span className="flex flex-wrap items-center gap-1.5">
      {f.locked && <Badge variant="secondary" title="Remove the environment variable to manage this here">Set by {f.env}</Badge>}
      {!f.locked && f.source === "default" && f.type !== "secret" && f.value !== null && <span className="text-[11px] text-muted-foreground">default</span>}
      {f.unreadable && <Badge variant="destructive">Can&apos;t decrypt: enter it again</Badge>}
    </span>
  );

  if (f.type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={id} className="grid gap-0.5 text-sm">
          <span className="flex items-center gap-2 font-medium">{f.label} {meta}</span>
          {f.description && <span className="text-xs text-muted-foreground">{f.description}</span>}
        </label>
        <Switch id={id} checked={value === true} disabled={f.locked} onCheckedChange={(v) => onChange(v)} />
      </div>
    );
  }

  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="flex items-center gap-2 font-medium">{f.label} {meta}</label>
      {f.type === "enum" ? (
        <SimpleSelect id={id} disabled={f.locked} value={(value as string) ?? null} onValueChange={(v) => onChange(v)} options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))} aria-label={f.label} />
      ) : f.type === "secret" ? (
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            disabled={f.locked}
            value={(value as string) ?? ""}
            placeholder={cleared ? "Will be removed when you save" : f.hasValue ? "Saved (hidden). Type to replace." : "Not set"}
            onChange={(e) => onChange(e.target.value)}
          />
          {f.hasValue && !f.locked && !cleared && <Button size="sm" variant="outline" onClick={onClear}>Remove</Button>}
        </div>
      ) : (
        <Input
          id={id}
          type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
          min={f.min}
          max={f.max}
          disabled={f.locked}
          placeholder={f.placeholder}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
        />
      )}
      {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
    </div>
  );
}
