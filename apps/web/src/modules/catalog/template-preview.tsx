import type { CatalogDocument } from "@Kavero/catalog-engine";

export type TemplateLayout = "editorial" | "grid" | "bold" | "blank";

/** A small, deterministic cover preview shared by the gallery and new-catalog flow. */
export function TemplatePreview({
  theme,
  layout,
  title,
  className = "",
}: {
  theme: CatalogDocument["theme"];
  layout: TemplateLayout;
  title: string;
  className?: string;
}) {
  const colors = theme.colors;
  const background = colors.background ?? "#ffffff";
  const foreground = colors.text ?? "#171717";
  const primary = colors.primary ?? foreground;
  const onPrimary = colors["on-primary"] ?? "#ffffff";
  const accent = colors.accent ?? primary;
  const darkCover = layout === "bold";
  const isBlank = layout === "blank";

  return (
    <div
      aria-hidden="true"
      className={`relative isolate aspect-video overflow-hidden rounded-lg border ${className}`}
      style={{ backgroundColor: darkCover ? primary : background }}
    >
      {isBlank ? (
        <div className="absolute inset-0 grid place-items-center text-2xl font-light text-muted-foreground/70">+</div>
      ) : layout === "grid" ? (
        <div className="absolute inset-[8%] grid grid-cols-[1.1fr_0.9fr] gap-[3%]">
          <div className="relative overflow-hidden rounded-sm" style={{ backgroundColor: accent }}>
            <div className="absolute inset-y-0 start-0 w-[14%]" style={{ backgroundColor: primary }} />
          </div>
          <div className="grid grid-cols-2 grid-rows-2 gap-[5%]">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="rounded-sm" style={{ backgroundColor: item % 2 ? accent : primary, opacity: item % 2 ? 0.6 : 0.32 }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="absolute inset-y-[13%] start-[9%] flex w-[54%] flex-col justify-between">
            <div className="h-[3%] w-[42%] rounded-full" style={{ backgroundColor: accent }} />
            <div className="grid gap-[7%]">
              <div className="h-[7%] w-[88%] rounded-full" style={{ backgroundColor: darkCover ? onPrimary : foreground }} />
              <div className="h-[7%] w-[63%] rounded-full" style={{ backgroundColor: darkCover ? onPrimary : foreground, opacity: 0.75 }} />
            </div>
            <div className="h-[2%] w-[36%] rounded-full" style={{ backgroundColor: darkCover ? onPrimary : foreground, opacity: 0.42 }} />
          </div>
          <div
            className="absolute end-[8%] top-[18%] aspect-square w-[31%] rounded-full"
            style={{ backgroundColor: accent, opacity: 0.92 }}
          />
          <div
            className="absolute end-[12%] bottom-[13%] aspect-square w-[16%] rounded-full"
            style={{ backgroundColor: darkCover ? background : primary, opacity: 0.88 }}
          />
        </>
      )}
      {!isBlank && (
        <span className="sr-only">{title} visual style</span>
      )}
    </div>
  );
}
