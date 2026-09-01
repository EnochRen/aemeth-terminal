import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

/**
 * Ask the user for a file path and write `content` to it as UTF-8 text.
 * Returns the chosen path, or null when the dialog was cancelled.
 */
export async function saveTextFile(
  content: string,
  defaultName: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Text", extensions: ["txt", "log"] }],
  });
  if (!path) return null;
  await invoke("write_text_file", { path, content });
  return path;
}
