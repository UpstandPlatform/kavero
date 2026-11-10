import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutGridIcon, PackageAddIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import { PRODUCTS_EXTENSION_ID } from "@Kavero/catalog-engine";
import type { EditorExtension } from "./types";

import { ProductsPanel } from "../products-panel";
import { productsExtensionRenderers } from "./products-renderer";

/** The built-in product feature pack: data library, slide insert tools and product panel. */
export const productsExtension: EditorExtension = {
  manifest: {
    id: PRODUCTS_EXTENSION_ID,
    name: "Products",
    description: "Manage catalog products, import store data, and place product cards or grids on slides.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "kavero", name: "Kavero" },
    capabilities: ["catalog.read", "catalog.write", "catalog.storage", "editor.ui", "editor.render", "assets.read", "assets.write", "network.fetch"],
    defaultEnabled: true,
    categories: ["catalogs", "commerce"],
    license: "MIT",
  },
  contribute: ({ editor, doc, assetUrls, products, insertProduct, insertGrid, importProducts }) => ({
    toolGroups: [
      [
        {
          id: "products.card",
          icon: <HugeiconsIcon icon={Tag01Icon} />,
          label: "Product card",
          description: "Pick a product from this catalog and add its card to the slide.",
          onClick: () => products.pick({
            multiple: false,
            title: "Add a product card",
            confirmLabel: "Add to slide",
            onConfirm: ([productId]) => productId && insertProduct(productId),
          }),
        },
        {
          id: "products.grid",
          icon: <HugeiconsIcon icon={LayoutGridIcon} />,
          label: "Product grid",
          description: "Choose and arrange multiple catalog products in a grid.",
          onClick: () => products.pick({
            multiple: true,
            title: "Add a product grid",
            confirmLabel: "Add grid to slide",
            onConfirm: insertGrid,
          }),
        },
      ],
      [
        {
          id: "products.import",
          icon: <HugeiconsIcon icon={PackageAddIcon} />,
          label: "Import products",
          description: "Bring product data in from a connected store, MCP source, or a pasted list.",
          onClick: importProducts,
        },
      ],
    ],
    panels: [{
      id: "products",
      label: "Products",
      icon: <HugeiconsIcon icon={Tag01Icon} />,
      content: <ProductsPanel editor={editor} doc={doc} assetUrls={assetUrls} ui={products} onInsert={insertProduct} />,
    }],
    renderers: productsExtensionRenderers,
  }),
};
