# Editor extension development

The Products editor experience is the first bundled extension. It contributes its Products panel, product-card/grid/import rail tools, and a renderer for the extension-owned slide elements `card` and `grid`.

## Add a bundled extension

1. Add a definition under this directory with a stable reverse-domain manifest id and the smallest required capability list.
2. Add its definition to `createEditorExtensionHost()` in `registry.ts`. Only code explicitly registered there is available to the catalog-scoped extension store.
3. Return tool groups and panels from `contribute()`. The host namespaces contribution ids with the extension id.
4. Declare `plugin`, `widget`, `integration`, `shader-effect`, or `shader-fill` in `manifest.types` to place the extension in the matching store filters. Integrations use the capability-scoped MCP connection API; each remote call requires a user confirmation and never receives stored credentials.
5. Shader effects and fills store only a bounded JSON reference on each element. Contribute a renderer in `effects` and register the trusted renderer in `built-in-effects.ts` so editor, published, export, and standalone views render the same result.
6. For slide elements, store only JSON data and register a React renderer. Add a compatible renderer for public pages, server image/PDF/video rendering, and standalone player builds in `built-in-renderers.ts`.
7. Keep persisted element `kind`, effect data, and formats backward compatible. Validate unknown data at the extension boundary and provide an edit-mode fallback for missing/unsupported renderers.
8. Add format-specific export handlers when needed. PowerPoint renderers are separate from React renderers: contribute them through `pptxRenderers`, which the editor passes to `PptxOptions.extensionRenderers`. The Products element has a compatibility path in the exporter.

Extensions must list the host hooks they register in `manifest.hooks`. The editor host maps hooks to required capabilities; `catalog.export.prepare` requires both catalog read and write access. Use `extension.messaging` when publishing or subscribing to another extension's topics.

`ExtensionStoreDialog` searches and filters the registered tools, shows requested capabilities before install, and offers type-specific actions. Its listing is intentionally curated: there is no remote package downloader or third-party JavaScript execution in this release.
