import {
  productCardStyleSchema,
  productGridStyleSchema,
  PRODUCTS_EXTENSION_ID,
  type ExtensionElement,
  type Product,
} from "@Kavero/catalog-engine";
import { ProductCard, type ExtensionRendererContext } from "@Kavero/renderer";

function productId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function productIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("productId" in item)) return [];
    const id = productId(item.productId);
    return id ? [id] : [];
  });
}

function Unavailable({ mode, label }: { mode: ExtensionRendererContext["mode"]; label: string }) {
  if (mode === "present") return null;
  return <div className="grid size-full place-items-center border-2 border-dashed bg-muted/40 p-2 text-center text-sm text-muted-foreground">{label}</div>;
}

/** Renderer contributed by the Products extension for its versioned slide elements. */
export function ProductsElementRenderer({ element, context }: { element: ExtensionElement; context: ExtensionRendererContext }) {
  const { doc, resolveAsset, mode } = context;
  if (element.elementVersion !== 1) return <Unavailable mode={mode} label={`Unsupported Products element version ${element.elementVersion}`} />;
  if (element.kind === "card") {
    const id = productId(element.content.productId);
    if (!id) return <Unavailable mode={mode} label="Invalid product card" />;
    const style = productCardStyleSchema.safeParse(element.style);
    return <ProductCard product={doc.products.find((product) => product.id === id)} style={style.success ? style.data : productCardStyleSchema.parse({})} doc={doc} resolveAsset={resolveAsset} mode={mode} />;
  }
  if (element.kind === "grid") {
    const ids = productIds(element.content.products);
    const columnsValue = element.content.columns;
    const columns = typeof columnsValue === "number" && Number.isInteger(columnsValue) ? Math.min(8, Math.max(1, columnsValue)) : 3;
    const style = productGridStyleSchema.safeParse(element.style);
    const gridStyle = style.success ? style.data : productGridStyleSchema.parse({});
    const items: (Product | undefined)[] = ids.length
      ? ids.map((id) => doc.products.find((product) => product.id === id))
      : mode === "edit" ? Array.from({ length: columns }, () => undefined) : [];
    return (
      <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(items.length / columns))}, minmax(0, 1fr))`, gap: gridStyle.gap }}>
        {items.map((product, index) => <ProductCard key={index} product={product} style={gridStyle} doc={doc} resolveAsset={resolveAsset} mode={mode} />)}
      </div>
    );
  }
  return <Unavailable mode={mode} label={`Unsupported Products element: ${element.kind}`} />;
}

export const productsExtensionRenderers = { [PRODUCTS_EXTENSION_ID]: ProductsElementRenderer };

