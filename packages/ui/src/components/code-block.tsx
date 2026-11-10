"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@Kavero/ui/components/button"
import { cn } from "@Kavero/ui/lib/utils"

function useCopy(text: string) {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])
  return { copied, copy }
}

/** Multi-line code / config snippet: rounded-xl panel, monospace, copy button pinned top-right. */
function CodeBlock({
  code,
  copyable = true,
  copyLabel = "Copy",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  code: string
  copyable?: boolean
  copyLabel?: string
}) {
  const { copied, copy } = useCopy(code)
  return (
    <div
      data-slot="code-block"
      className={cn("group/code-block relative min-w-0 rounded-xl border bg-muted/40 dark:bg-input/20", className)}
      {...props}
    >
      <pre className={cn("overflow-x-auto p-3 font-mono text-xs leading-relaxed", copyable && "pr-12")}>
        <code>{code}</code>
      </pre>
      {copyable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm"
          onClick={copy}
          aria-label={copied ? "Copied" : copyLabel}
          title={copied ? "Copied" : copyLabel}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      )}
    </div>
  )
}

/** Single-line value to copy (token, link): input-sized monospace field with a copy button. */
function CopyField({
  value,
  copyLabel = "Copy",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: string
  copyLabel?: string
  /** Extra actions rendered after the copy button (e.g. an "Open" link). */
  children?: React.ReactNode
}) {
  const { copied, copy } = useCopy(value)
  return (
    <div data-slot="copy-field" className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
      <code className="flex h-8 min-w-0 flex-1 items-center truncate rounded-lg border bg-muted/40 px-2.5 font-mono text-xs dark:bg-input/20">
        <span className="truncate">{value}</span>
      </code>
      <Button type="button" variant="outline" onClick={copy}>
        {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : copyLabel}
      </Button>
      {children}
    </div>
  )
}

export { CodeBlock, CopyField }
