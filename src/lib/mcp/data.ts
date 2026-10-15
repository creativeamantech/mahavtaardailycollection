// Lazy loaders shared by MCP tools. Same rules as the app: Already Paid excluded from totals.
export async function loadCollections() {
  const { readCollections } = await import("../mahavtaar.functions");
  return await readCollections();
}

export async function loadPending() {
  const { readPending } = await import("../mahavtaar.functions");
  return await readPending();
}

export const normId = (s: string) => s.replace(/^['`\u2018\u2019]+/, "").trim();
