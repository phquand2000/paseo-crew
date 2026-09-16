import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SeatworksSurface } from "./client/surface.tsx";

export default function contribute(client: PluginClientContext) {
  const surface = client.addSurface("seatworks", SeatworksSurface);
  const sidebar = client.addSidebarItem({ id: "seatworks", title: "Seatworks", icon: "Users", surface: "seatworks" });
  return () => {
    sidebar();
    surface();
  };
}
