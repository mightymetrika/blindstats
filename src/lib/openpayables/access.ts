/** Explicit, server-configured OpenPayables pilot authorization.
 * Do NOT infer compensation roles from a BlindStats Study role or an email.
 * The configuration is server-only and grants access to exactly one project.
 */
export type PilotAccess = {
  projectId: string;
  manager: boolean;
  contributorId: string | null;
};

type PilotConfig = {
  projectId: string;
  managerUserIds: string[];
  contributorUserIds: Record<string, string>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validConfig(value: unknown): value is PilotConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  if (typeof config.projectId !== "string" || !config.projectId.trim() ||
      config.projectId.trim() !== config.projectId || config.projectId.length > 200) return false;
  if (!Array.isArray(config.managerUserIds) ||
      !config.managerUserIds.every((id: unknown) => typeof id === "string" && uuid.test(id))) return false;
  const ids = config.contributorUserIds;
  if (!ids || typeof ids !== "object" || Array.isArray(ids)) return false;
  return Object.entries(ids).every(([id, contributor]) =>
    uuid.test(id) && typeof contributor === "string" && contributor.trim() === contributor &&
    contributor.length > 0 && contributor.length <= 200);
}

export function resolveOpenPayablesPilotAccess(
  authenticatedUserId: string,
  configuration: string | undefined,
  vercelEnvironment: string | undefined,
): PilotAccess | null {
  // This pilot is intentionally unavailable from Vercel Production.
  if (vercelEnvironment === "production" || !uuid.test(authenticatedUserId) || !configuration) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(configuration); } catch { return null; }
  if (!validConfig(parsed)) return null;
  const manager = parsed.managerUserIds.includes(authenticatedUserId);
  const contributorId = Object.prototype.hasOwnProperty.call(parsed.contributorUserIds, authenticatedUserId)
    ? parsed.contributorUserIds[authenticatedUserId] : null;
  if (!manager && !contributorId) return null;
  return { projectId: parsed.projectId, manager, contributorId };
}
