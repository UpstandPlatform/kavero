# Kavero extension runtime

`@Kavero/extensions` is the shared host layer for editor extensions. It is framework independent; the web app supplies the editor context and UI contributions.

## Extension package shape

Each extension exports a manifest and a definition. Keep its id stable and reverse-domain scoped. The manifest declares its API version and required capabilities so the host can show the access it needs before enabling it.

```ts
const extension = {
  manifest: {
    id: "com.example.extension",
    name: "Example",
    description: "Adds an example editor feature.",
    version: "1.0.0",
    apiVersion: "1.0.0",
    publisher: { id: "example", name: "Example Inc." },
    capabilities: ["catalog.read", "catalog.storage", "editor.ui"],
  },
  contribute(context) {
    return { panels: [], toolGroups: [] };
  },
  activate({ context, services }) {
    const off = services.events.on("editor.selectionChanged", (event) => {
      // React to editor state without owning the editor's event loop.
    });
    return off;
  },
};
```

The editor host provides:

- A manifest registry with API compatibility and capability checks.
- Per-catalog install, enable, disable, and uninstall state.
- Namespaced JSON settings and storage persisted in the catalog document.
- A typed pub/sub bus for catalog, editor, asset, and extension lifecycle events. Subscriptions are automatically removed when an extension is deactivated.
- An ordered asynchronous hook registry for waterfall points explicitly defined by the host. Extensions should only register or run hooks documented by the host.
- Editor UI contributions: panels and groups of tool-rail actions.
- Extension-owned slide elements and namespaced renderers for editor, preview, publish, and offline playback.
- Optional format exporters, such as the PowerPoint extension-element callback.

## Document data

Extension settings and storage live under `document.extensions[extensionId]` as namespaced JSON. Extension slide elements use the generic `type: "extension"` schema with an `extensionId`, a `kind`, an `elementVersion`, and JSON-only `content` and `style`. Validate each extension's payload before reading it; the shared schema intentionally does not interpret plugin-specific data. Keep old element versions readable or provide a migration when the shape changes.

Do not store executable code, secrets, or large binary media in extension storage. Store asset ids and small JSON records; binary content belongs in the existing asset store.

## Trust boundary

The current host loads code compiled into Kavero and registers only approved bundles. Catalog files can request extension ids, but cannot supply code that the browser evaluates. The web editor context currently exposes trusted first-party editor APIs; capability metadata is not a sandbox around that context. Do not pass it to downloaded code or change this to remote JavaScript imports or `eval`. A public third-party marketplace needs a restricted host facade, isolated execution, signed packages, publisher verification, capability consent, revocation, and version pinning before it can safely load external code.
