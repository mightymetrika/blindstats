import { describe, expect, it } from "vitest";
import { resolveOpenPayablesPilotAccess as access } from "./access";

const managerId = "123e4567-e89b-42d3-a456-426614174001";
const contributorId = "123e4567-e89b-42d3-a456-426614174002";
const outsiderId = "123e4567-e89b-42d3-a456-426614174003";
const config = JSON.stringify({
  projectId: "pilot-project",
  managerUserIds: [managerId],
  contributorUserIds: { [contributorId]: "alice" },
});

describe("OpenPayables pilot authorization", () => {
  it("denies absent configuration, outsiders, invalid identities and malformed records", () => {
    expect(access(managerId, undefined, "preview")).toBeNull();
    expect(access(outsiderId, config, "preview")).toBeNull();
    expect(access("not-a-uuid", config, "preview")).toBeNull();
    expect(access(managerId, "not JSON", "preview")).toBeNull();
    expect(access(managerId, JSON.stringify({ projectId: "x", managerUserIds: [managerId], contributorUserIds: null }), "preview")).toBeNull();
    expect(access(managerId, JSON.stringify({ projectId: "", managerUserIds: [managerId], contributorUserIds: {} }), "preview")).toBeNull();
  });

  it("authorizes only explicitly mapped manager and contributor identities", () => {
    expect(access(managerId, config, "preview")).toEqual({projectId:"pilot-project",manager:true,contributorId:null});
    expect(access(contributorId, config, "preview")).toEqual({projectId:"pilot-project",manager:false,contributorId:"alice"});
    const dual = JSON.stringify({projectId:"pilot-project",managerUserIds:[managerId],contributorUserIds:{[managerId]:"manager-alice"}});
    expect(access(managerId, dual, undefined)).toEqual({projectId:"pilot-project",manager:true,contributorId:"manager-alice"});
  });

  it("denies the pilot in Production even for a mapped user", () => {
    expect(access(managerId, config, "production")).toBeNull();
  });

  it("does not accept inherited mapping properties or email-based identity", () => {
    expect(access(outsiderId, config, "preview")).toBeNull();
    expect(access("test@example.com", config, "preview")).toBeNull();
  });
});
