import { describe, expect, it } from "bun:test";

import { permissionsToScopes, scopesToPermissions } from "./audit-service";

describe("API-key permission scopes", () => {
  it("round trips every supported MCP scope", () => {
    const scopes = ["catalogs:read", "catalogs:write", "catalogs:delete", "assets:write", "exports:read", "ai:generate", "workspaces:write", "publish"] as const;
    expect(permissionsToScopes(scopesToPermissions(scopes))).toEqual([...scopes]);
  });

  it("ignores unsupported permissions and malformed values", () => {
    expect(permissionsToScopes({ catalogs: ["read", "admin"], publication: ["delete"], users: ["read"] })).toEqual(["catalogs:read"]);
    expect(permissionsToScopes("not-json")).toEqual([]);
    expect(permissionsToScopes(null)).toEqual([]);
  });
});
