import { getCurrentWindow } from "@tauri-apps/api/window";

let forced = false;

/** Close the window bypassing the onCloseRequested guard. */
export async function forceCloseWindow(): Promise<void> {
  forced = true;
  await getCurrentWindow().close();
}

export function isCloseForced(): boolean {
  return forced;
}
