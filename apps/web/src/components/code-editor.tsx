"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, MagicWand01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@Kavero/ui/components/button";
import { cn } from "@Kavero/ui/lib/utils";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type CodeEditorFormatter = (source: string, language: string) => string | Promise<string>;

export interface CodeEditorProps {
  label: string;
  language: string;
  value: string;
  rows?: number;
  lineNumbers?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  description?: string;
  className?: string;
  editorClassName?: string;
  toolbar?: ReactNode;
  formatter?: CodeEditorFormatter | false;
  onChange?: (value: string) => void;
  /** Called once when focus leaves the editor or when formatting is applied. */
  onCommit?: (value: string) => void;
}

async function formatWithPrettier(source: string, language: string) {
  const normalized = language.toLowerCase();
  if (normalized !== "html" && normalized !== "css") throw new Error(`Formatting is not configured for ${language}.`);
  const [{ format }, html, postcss] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/postcss"),
  ]);
  return format(source, {
    parser: normalized,
    plugins: [html, postcss],
    tabWidth: 2,
    useTabs: false,
    printWidth: 88,
  });
}

/** Reusable, syntax-highlighted code input with indentation, formatting, and commit hooks. */
export function CodeEditor({
  label,
  language,
  value,
  rows = 8,
  lineNumbers = true,
  readOnly = false,
  disabled = false,
  placeholder = "Write code…",
  description,
  className,
  editorClassName,
  toolbar,
  formatter,
  onChange,
  onCommit,
}: CodeEditorProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  const gutterLinesRef = useRef<HTMLDivElement>(null);
  const lastCommitted = useRef(value);
  const [draft, setDraft] = useState(value);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightedLines = useHighlightedCode(draft, language);
  const lines = useMemo(() => draft.split("\n"), [draft]);
  const visibleRows = Math.max(Math.min(rows, 18), Math.min(lines.length, 18), 4);
  const canFormat = formatter !== false && (!!formatter || ["html", "css"].includes(language.toLowerCase()));

  useEffect(() => {
    setDraft(value);
    lastCommitted.current = value;
  }, [value]);

  const updateDraft = useCallback((next: string) => {
    setDraft(next);
    setError(null);
    onChange?.(next);
  }, [onChange]);

  const commit = useCallback(() => {
    if (draft === lastCommitted.current) return;
    lastCommitted.current = draft;
    onCommit?.(draft);
  }, [draft, onCommit]);

  const formatCode = useCallback(async () => {
    if (!canFormat || formatting || disabled || readOnly) return;
    setFormatting(true);
    setError(null);
    try {
      const selection = inputRef.current?.selectionStart ?? draft.length;
      const formatted = await (formatter || formatWithPrettier)(draft, language);
      updateDraft(formatted);
      lastCommitted.current = formatted;
      onCommit?.(formatted);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        const caret = Math.min(selection, formatted.length);
        inputRef.current?.setSelectionRange(caret, caret);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not format this code.");
    } finally {
      setFormatting(false);
    }
  }, [canFormat, disabled, draft, formatter, formatting, language, onCommit, readOnly, updateDraft]);

  function handleScroll() {
    const input = inputRef.current;
    if (!input) return;
    if (codeRef.current) codeRef.current.style.transform = `translate3d(${-input.scrollLeft}px, ${-input.scrollTop}px, 0)`;
    if (gutterLinesRef.current) gutterLinesRef.current.style.transform = `translate3d(0, ${-input.scrollTop}px, 0)`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && !readOnly && !disabled) {
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const source = draft;
      if (start === end && !event.shiftKey) {
        updateDraft(`${source.slice(0, start)}  ${source.slice(end)}`);
        requestAnimationFrame(() => inputRef.current?.setSelectionRange(start + 2, start + 2));
        return;
      }
      const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const lineEnd = source.indexOf("\n", end);
      const rangeEnd = lineEnd < 0 ? source.length : lineEnd;
      const original = source.slice(lineStart, rangeEnd).split("\n");
      const nextLines = event.shiftKey
        ? original.map((line) => line.startsWith("  ") ? line.slice(2) : line.startsWith(" ") ? line.slice(1) : line)
        : original.map((line) => `  ${line}`);
      const replacement = nextLines.join("\n");
      const next = `${source.slice(0, lineStart)}${replacement}${source.slice(rangeEnd)}`;
      updateDraft(next);
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(lineStart, lineStart + replacement.length);
      });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      void formatCode();
    }
  }

  return (
    <div ref={rootRef} className={cn("grid min-w-0 gap-1.5", className)} onBlurCapture={(event) => {
      if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
      commit();
    }}>
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={id} className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{label}</label>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">{language} · {lines.length} lines</span>
        {canFormat && (
          <Button type="button" variant="ghost" size="xs" disabled={disabled || readOnly || formatting} onMouseDown={(event) => event.preventDefault()} onClick={() => void formatCode()} aria-label={`Format ${label} code`} title="Format code (Ctrl+Shift+F)">
            <HugeiconsIcon icon={formatting ? Loading02Icon : MagicWand01Icon} className={formatting ? "animate-spin" : undefined} />
            Format
          </Button>
        )}
        {toolbar}
      </div>
      {description && <p id={descriptionId} className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>}
      <div
        data-code-language={language}
        dir="ltr"
        className={cn("relative min-w-0 overflow-hidden rounded-xl border bg-background/70 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20", disabled && "opacity-60", editorClassName)}
        style={{ height: `${visibleRows * 1.5 + 1.5}rem` }}
      >
        {lineNumbers && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-0 z-[1] w-10 overflow-hidden border-e bg-muted/45 text-end font-mono text-[11px] leading-6 text-muted-foreground/70">
            <div ref={gutterLinesRef} className="px-2 py-3 will-change-transform">
              {Array.from({ length: Math.max(visibleRows, lines.length) }, (_, index) => <div key={index} className="h-6">{index + 1}</div>)}
            </div>
          </div>
        )}
        <pre aria-hidden="true" className={cn("pointer-events-none absolute inset-0 m-0 min-w-max overflow-visible py-3 font-mono text-xs leading-6 text-start", lineNumbers ? "ps-12 pe-3" : "px-3")}>
          <code ref={codeRef} className="block min-w-max will-change-transform">
            {lines.map((line, index) => (
              <span key={index} className="block min-h-6 whitespace-pre">{highlightedLines[index] ?? line}</span>
            ))}
          </code>
        </pre>
        {!draft && <span aria-hidden="true" className={cn("pointer-events-none absolute top-3 text-xs text-muted-foreground/65", lineNumbers ? "start-12" : "start-3")}>{placeholder}</span>}
        <textarea
          ref={inputRef}
          id={id}
          dir="ltr"
          aria-label={label}
          aria-describedby={description ? descriptionId : undefined}
          value={draft}
          onChange={(event) => updateDraft(event.currentTarget.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          className={cn(
            "absolute inset-0 z-[2] m-0 block h-full min-h-0 w-full resize-none overflow-auto rounded-xl border-0 bg-transparent py-3 font-mono text-xs leading-6 text-transparent caret-foreground outline-none selection:bg-primary/25 focus-visible:ring-0 disabled:cursor-not-allowed read-only:cursor-text",
            lineNumbers ? "ps-12 pe-3" : "px-3",
          )}
          style={{ tabSize: 2, WebkitTextFillColor: "transparent" }}
        />
      </div>
      {error && <p role="status" className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
