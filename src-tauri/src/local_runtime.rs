use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Native open-file dialog for LibraryStore.pickAndAdd (via localRuntimeService.pickFile).
/// Returns None when the person cancels.
#[tauri::command]
pub fn pick_file(app: AppHandle) -> Result<Option<String>, String> {
  Ok(app
    .dialog()
    .file()
    .blocking_pick_file()
    .map(|path| path.to_string()))
}
