import { describe, expect, it } from "bun:test";

import { permissionsToScopes, scopesToPermissions } from "./token-service";

describe("API-key permission scopes", () => {
  it("round trips all supported MCP scopes", () => {
    const scopes = ["catalogs:read", "catalogs:write", "catalogs:delete", "publish"] as const;
    expect(permissionsToScopes(scopesToPermissions(scopes))).toEqual([...scopes]);
  });

  it("ignores unsupported permissions and malformed values", () => {
    expect(permissionsToScopes({ catalogs: ["read", "admin"], publication: ["delete"], users: ["read"] })).toEqual(["catalogs:read"]);
    expect(permissionsToScopes("not-json")).toEqual([]);
    expect(permissionsToScopes(null)).toEqual([]);
  });
});
