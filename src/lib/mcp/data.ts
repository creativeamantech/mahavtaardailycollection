// Lazy loaders shared by MCP tools. Same rules as the app: Already Paid excluded from totals.
export async function loadCollections() {
  const { getCollections } = await import("../mahavtaar.functions");
  return await getCollections();
}

export async function loadPending() {
  const { getPending } = await import("../mahavtaar.functions");
  return await getPending();
}

export const normId = (s: string) => s.replace(/^['`\u2018\u2019]+/, "").trim();
