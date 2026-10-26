import { createFileRoute, Outlet } from "@tanstack/react-router";

// The Daily Collection UI is available without a general app login.
// MCP sign-in and OAuth consent remain protected by their dedicated routes.
export const Route = createFileRoute("/_authenticated")({
  component: () => <Outlet />,
});
