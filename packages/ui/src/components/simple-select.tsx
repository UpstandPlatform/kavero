"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@Kavero/ui/components/select"
import { cn } from "@Kavero/ui/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@Kavero/ui/components/tooltip"

export type SimpleSelectOption<T extends string = string> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

// Base UI treats "" as "no value", so an option whose value is "" is stored under this key.
const EMPTY = "__empty__"
const toInner = (v: string | undefined) => (v === undefined ? undefined : v === "" ? EMPTY : v)
const toOuter = (v: string) => (v === EMPTY ? "" : v)

/**
 * The shadcn Select (Base UI) for a flat list of string options, sized like <Input />.
 * `className` styles the trigger (full width by default); `size="sm"` is the compact
 * h-7 / text-xs variant for dense panels such as the editor inspector.
 */
function SimpleSelect<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  id,
  disabled,
  required,
  placeholder,
  size = "default",
  className,
  contentClassName,
  title,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  options: ReadonlyArray<SimpleSelectOption<T>>
  /** `null` shows the placeholder. */
  value?: T | null
  defaultValue?: T
  onValueChange?: (value: T) => void
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  placeholder?: React.ReactNode
  size?: "sm" | "default"
  className?: string
  contentClassName?: string
  title?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
}) {
  // Inside a modal <dialog> (top layer) the popup must be portalled into the dialog, or it renders behind it.
  const [dialog, setDialog] = React.useState<HTMLDialogElement | null>(null)
  const triggerRef = React.useCallback((el: HTMLElement | null) => {
    setDialog(el?.closest("dialog") ?? null)
  }, [])
  const items = React.useMemo(
    () => options.map((o) => ({ value: toInner(o.value)!, label: o.label })),
    [options]
  )
  return (
    <Select
      items={items}
      value={value === null ? null : toInner(value)}
      defaultValue={toInner(defaultValue)}
      onValueChange={(v) => {
        if (v !== null) onValueChange?.(toOuter(v as string) as T)
      }}
      name={name}
      disabled={disabled}
      required={required}
    >
      {title ? (
        <Tooltip>
          <TooltipTrigger render={<SelectTrigger
            ref={triggerRef}
            id={id}
            size={size}
            aria-label={ariaLabel ?? title}
            aria-invalid={ariaInvalid}
            className={cn(
              "w-full min-w-0",
              size === "sm" && "gap-1 pr-1.5 pl-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
              className
            )}
          />}>
            <SelectValue placeholder={placeholder} className="min-w-0 truncate" />
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
      ) : (
        <SelectTrigger
          ref={triggerRef}
          id={id}
          size={size}
          aria-label={ariaLabel ?? title}
          aria-invalid={ariaInvalid}
          className={cn(
            "w-full min-w-0",
            size === "sm" && "gap-1 pr-1.5 pl-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
            className
          )}
        >
          <SelectValue placeholder={placeholder} className="min-w-0 truncate" />
        </SelectTrigger>
      )}
      <SelectContent
        container={dialog ?? undefined}
        positionMethod={dialog ? "fixed" : undefined}
        className={cn(size === "sm" && "**:data-[slot=select-item]:text-xs", contentClassName)}>
        {items.map((o, i) => (
          <SelectItem key={o.value} value={o.value} disabled={options[i]!.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { SimpleSelect }
