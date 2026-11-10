"use client"

import { HexColorPicker } from "react-colorful"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@Kavero/ui/components/button"
import { Input } from "@Kavero/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@Kavero/ui/components/popover"
import { TooltipHint } from "@Kavero/ui/components/tooltip"
import { cn } from "@Kavero/ui/lib/utils"
import { useEffect, useRef, useState } from "react"

export type ColorSwatch = { label: string; value: string; color?: string }

export function ColorPicker({
  value,
  onValueChange,
  label = "Choose color",
  swatches = [],
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  label?: string
  swatches?: ColorSwatch[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selectedSwatch = swatches.find((swatch) => swatch.value === value)
  const color = /^#[\da-f]{6}$/i.test(value) ? value : selectedSwatch?.color ?? "#000000"
  const [draftColor, setDraftColor] = useState(color)
  const [draft, setDraft] = useState(color.toUpperCase())
  const pendingColor = useRef(color)
  useEffect(() => {
    pendingColor.current = color
    setDraftColor(color)
    setDraft(color.toUpperCase())
  }, [color])

  function preview(next: string) {
    pendingColor.current = next
    setDraftColor(next)
    setDraft(next.toUpperCase())
  }

  function commit() {
    if (pendingColor.current !== color) onValueChange(pendingColor.current)
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { if (!nextOpen) commit(); setOpen(nextOpen) }}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" aria-label={`${label}: ${color}`} className={cn("min-w-0 justify-start gap-2 px-2", className)} />}>
        <span className="size-4 shrink-0 rounded-sm border border-foreground/15 shadow-inner" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase">{color}</span>
        <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold">{label}</p>
            <p className="text-[11px] text-muted-foreground">Pick a shade or enter a hex value.</p>
          </div>
          <span className="size-7 shrink-0 rounded-lg border border-foreground/15 shadow-inner" style={{ backgroundColor: draftColor }} />
        </div>
        <HexColorPicker
          color={draftColor}
          onChange={preview}
          onPointerUp={commit}
          onKeyUp={commit}
          className="!h-40 !w-full"
          aria-label={label}
        />
        <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs">
          <span className="text-muted-foreground">Hex</span>
          <Input
            value={draft}
            onChange={(event) => {
              const typed = event.target.value.toUpperCase()
              setDraft(typed)
              const next = typed.startsWith("#") ? typed : `#${typed}`
              if (/^#[\da-f]{6}$/i.test(next)) {
                pendingColor.current = next.toLowerCase()
                setDraftColor(next.toLowerCase())
                onValueChange(next.toLowerCase())
              }
            }}
            onBlur={(event) => {
              if (!/^#[\da-f]{6}$/i.test(event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`)) {
                setDraft(color.toUpperCase())
              } else {
                commit()
              }
            }}
            className="h-8 rounded-lg font-mono text-xs uppercase"
            aria-label={`${label} hex value`}
            spellCheck={false}
          />
        </label>
        {swatches.length > 0 && (
          <div className="grid grid-cols-7 gap-1 border-t pt-3" aria-label="Theme colors">
            {swatches.map((swatch) => (
              <TooltipHint key={`${swatch.label}:${swatch.value}`} content={swatch.label}>
                <button
                  type="button"
                  aria-label={swatch.label}
                  aria-pressed={value === swatch.value}
                  onClick={() => {
                    pendingColor.current = swatch.value
                    setDraftColor(swatch.color ?? swatch.value)
                    onValueChange(swatch.value)
                  }}
                  className="size-6 rounded-md border border-foreground/15 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-1"
                  style={{ backgroundColor: swatch.color ?? swatch.value }}
                />
              </TooltipHint>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
