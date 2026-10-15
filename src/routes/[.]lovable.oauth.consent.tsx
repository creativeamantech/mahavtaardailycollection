import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
