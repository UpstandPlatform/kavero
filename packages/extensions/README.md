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
- Per-catalog install, enable, disable, and uninstall state, with user-confirmed capability grants (see below).
- Semver-aware version handling: catalog state written by any version in the same major line runs as is (in both directions, so an older desktop bundle keeps working with a catalog saved by a newer cloud build). Migrations are optional within a major line and required across majors; downgrades are never migrated.
- Namespaced JSON settings and storage persisted in the catalog document.
- A typed pub/sub bus for catalog, editor, asset, and extension lifecycle events. Subscriptions are automatically removed when an extension is deactivated.
- An ordered asynchronous hook registry for waterfall points explicitly defined by the host. Extensions should only register or run hooks documented by the host. Each handler receives its own copy of the value and runs under a timeout (10 s by default); a handler that throws, times out or returns a value the host rejects is skipped and reported, and the waterfall continues. Priorities must be finite numbers.
- Editor UI contributions: panels and groups of tool-rail actions.
- Extension-owned slide elements and namespaced renderers for editor, preview, publish, and offline playback.
- Optional format exporters, such as the PowerPoint extension-element callback.

## Document data

Extension settings and storage live under `document.extensions[extensionId]` as namespaced JSON. Extension slide elements use the generic `type: "extension"` schema with an `extensionId`, a `kind`, an `elementVersion`, and JSON-only `content` and `style`. Validate each extension's payload before reading it; the shared schema intentionally does not interpret plugin-specific data. Keep old element versions readable or provide a migration when the shape changes.

Do not store executable code, secrets, or large binary media in extension storage. Store asset ids and small JSON records; binary content belongs in the existing asset store.

## Capability grants and consent

`document.extensions[id].grantedCapabilities` lives in the shared catalog document, which every collaborator, importer and sync client can write. It is therefore only a request. `effectiveGrants(manifest, record, confirmed)` is the single place that decides what an extension may use: the capabilities the document requests **and** the current user confirmed (stored per user and catalog outside the document by `createGrantConfirmationStore`: browser storage with an in-memory fallback). Verified first-party bundles marked `defaultEnabled` count as confirmed for their own manifest capabilities. `ExtensionHost` takes a `confirmedGrants` callback and applies this rule in `isEnabled`, `activate` and `grantsFor`; `needsConsent` reports catalogs that enable an extension the user has not approved, so the editor asks instead of activating it silently.

Server-side code (exports, MCP) does not run extension code, so it has no consent source and treats document grants only as a rendering switch for trusted built-in renderers.

## Export and server rendering

Editor-only contributions (`catalog.export.prepare` hooks and `pptxRenderers`) run in the browser editor only. Server and agent exports (the MCP `catalog_export_pdf` / `catalog_export_pptx` tools, `/render` PDF/image/video rendering, published pages) do not load the editor extension host. They render only the trusted, pure renderers registered in the web app's `built-in-renderers.ts` and `built-in-effects.ts` (and the exporter's own product compatibility path). An extension whose output must appear in server exports must store its result as catalog data that those built-in renderers draw, rather than depend on an export hook. None of the bundled extensions registers an export hook or a PowerPoint renderer today.

## Trust boundary

The current host loads code compiled into Kavero and registers only approved bundles. Catalog files can request extension ids, but cannot supply code that the browser evaluates. 

**The capability facade is not a security boundary.** Extensions run in the editor's own JavaScript realm. Capability checks, frozen facades, structured clones, ownership checks on editor commands and host-confirmed integration calls stop mistakes in trusted first-party code and keep an extension from acting for a user who did not consent. They do not contain hostile code: an extension can reach `window`, `fetch`, the DOM, other modules and the user's session, and can render arbitrary React content. Never load downloaded code, remote JavaScript imports or `eval` into this host.

Running third-party code safely would require at least:

- Isolated execution: a cross-origin sandboxed iframe or worker per extension with no access to the editor realm, cookies or storage, talking to the host only over a structured-clone message channel.
- A message-based host API that re-checks every capability on the host side, with per-call validation, quotas and timeouts (the current facade can serve as that API's reference implementation).
- UI contributions rendered by the host from declarative data, or inside the extension's sandboxed frame, never as React elements in the editor tree.
- Signed, content-addressed packages, publisher verification, pinned versions and a revocation list.
- Per-user consent with review on upgrade when requested capabilities grow (the grant model above), and server-side enforcement for every capability that reaches server APIs (network, integrations, AI).
