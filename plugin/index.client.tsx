import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PaseoCrewSurface } from "./client/surface.tsx";

export default function contribute(client: PluginClientContext) {
  const surface = client.addSurface("paseo-crew", PaseoCrewSurface);
  const sidebar = client.addSidebarItem({ id: "paseo-crew", title: "Paseo Crew", icon: "Users", surface: "paseo-crew" });
  return () => {
    sidebar();
    surface();
  };
}
