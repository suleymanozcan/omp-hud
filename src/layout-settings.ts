// Dock size and placement. Initial values: OMP_HUD_SIZE (small|medium|large, default medium) and
// OMP_HUD_PLACE (above|below, default above); `/hud size` and `/hud place` override them at runtime (not persisted).
import type { DockSize } from "./components/dock-hud.ts";

export const DOCK_SIZES: readonly DockSize[] = ["small", "medium", "large"];
export type DockPlace = "above" | "below";
export const DOCK_PLACES: readonly DockPlace[] = ["above", "below"];

export function parseSize(v: string | undefined): DockSize | undefined {
  return DOCK_SIZES.find((s) => s === v?.trim().toLowerCase());
}

export function parsePlace(v: string | undefined): DockPlace | undefined {
  return DOCK_PLACES.find((p) => p === v?.trim().toLowerCase());
}

let size: DockSize | undefined;
let place: DockPlace | undefined;

export function getSize(): DockSize {
  size ??= parseSize(process.env.OMP_HUD_SIZE) ?? "medium";
  return size;
}

export function setSize(s: DockSize): void {
  size = s;
}

export function getPlace(): DockPlace {
  place ??= parsePlace(process.env.OMP_HUD_PLACE) ?? "above";
  return place;
}

export function setPlace(p: DockPlace): void {
  place = p;
}
