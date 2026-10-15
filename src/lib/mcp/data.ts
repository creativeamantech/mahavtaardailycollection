// Lazy loaders & shared helpers for MCP tools.
export async function loadCollections() {
  const { readCollections } = await import("../mahavtaar.functions");
  return await readCollections();
}

export async function loadPending() {
  const { readPending } = await import("../mahavtaar.functions");
  return await readPending();
}

export async function loadEcs() {
  const { getEcsEntries } = await import("../ecs.functions");
  return await getEcsEntries();
}

export async function loadConfig() {
  const { getAppConfig } = await import("../app-config.functions");
  return await getAppConfig();
}

export const normId = (s: string) => s.replace(/^['`\u2018\u2019]+/, "").trim();
