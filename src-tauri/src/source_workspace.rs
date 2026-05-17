use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RESOURCE_SOURCE_DIR: &str = "source";
const SNAPSHOT_ROOT_NAME: &str = "current";
const MANIFEST_NAME: &str = "manifest.json";
const WORKSPACE_DIR_NAME: &str = "source-workspace";
const INSTALLED_MARKER_NAME: &str = ".gatesai-source-workspace.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceManifest {
    schema_version: u32,
    product_name: String,
    package_name: String,
    version: String,
    created_at: String,
    content_hash: String,
    file_count: usize,
    total_bytes: u64,
    source_root_name: String,
    excludes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledSourceMarker {
    schema_version: u32,
    app_managed: bool,
    prepared_at_unix: u64,
    source_manifest: SourceManifest,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceStatus {
    available: bool,
    prepared: bool,
    stale: bool,
    version: Option<String>,
    content_hash: Option<String>,
    file_count: Option<usize>,
    total_bytes: Option<u64>,
    bundled_root: Option<String>,
    workspace_root: String,
    source_root: String,
    prepared_at_unix: Option<u64>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceEntry {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
    mtime: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceList {
    path: String,
    entries: Vec<SourceWorkspaceEntry>,
    truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceRead {
    path: String,
    content: String,
    size: u64,
    truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceWrite {
    path: String,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceStat {
    path: String,
    kind: String,
    size: u64,
    mtime: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceSearchHit {
    path: String,
    line: usize,
    snippet: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkspaceSearch {
    query: String,
    hits: Vec<SourceWorkspaceSearchHit>,
    truncated: bool,
}

#[tauri::command]
pub fn source_workspace_status(app: AppHandle) -> SourceWorkspaceStatus {
    status_for_app(&app)
}

#[tauri::command]
pub fn source_workspace_prepare(app: AppHandle) -> Result<SourceWorkspaceStatus, String> {
    prepare_for_app(&app)?;
    Ok(status_for_app(&app))
}

#[tauri::command]
pub fn source_workspace_open(app: AppHandle) -> Result<(), String> {
    let paths = managed_paths(&app)?;
    if !paths.source_root.exists() {
        return Err("Source workspace has not been prepared yet.".to_string());
    }
    open::that_detached(&paths.source_root)
        .map_err(|err| format!("cannot open {}: {err}", paths.source_root.display()))
}

#[tauri::command]
pub fn source_workspace_list(
    app: AppHandle,
    path: Option<String>,
    recursive: Option<bool>,
) -> Result<SourceWorkspaceList, String> {
    let root = prepared_source_root(&app)?;
    let relative = clean_relative_path(path.as_deref().unwrap_or(""))?;
    let target = root.join(&relative);
    let metadata = fs::metadata(&target).map_err(|err| {
        format!(
            "cannot list source path {}: {err}",
            display_source_path(&relative)
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "source path is not a directory: {}",
            display_source_path(&relative)
        ));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    collect_entries(
        &root,
        &target,
        recursive.unwrap_or(false),
        &mut entries,
        &mut truncated,
    )?;
    Ok(SourceWorkspaceList {
        path: display_source_path(&relative),
        entries,
        truncated,
    })
}

#[tauri::command]
pub fn source_workspace_read(
    app: AppHandle,
    path: String,
    max_chars: Option<usize>,
) -> Result<SourceWorkspaceRead, String> {
    let root = prepared_source_root(&app)?;
    let relative = clean_required_file_path(&path, "read")?;
    let target = root.join(&relative);
    let metadata = fs::metadata(&target).map_err(|err| {
        format!(
            "cannot read source file {}: {err}",
            display_source_path(&relative)
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "source path is not a file: {}",
            display_source_path(&relative)
        ));
    }
    let content = fs::read_to_string(&target).map_err(|err| {
        format!(
            "source file is not readable UTF-8 {}: {err}",
            display_source_path(&relative)
        )
    })?;
    let limit = max_chars.unwrap_or(12_000).max(1);
    let truncated = content.chars().count() > limit;
    let shown = if truncated {
        content.chars().take(limit).collect()
    } else {
        content
    };
    Ok(SourceWorkspaceRead {
        path: display_source_path(&relative),
        content: shown,
        size: metadata.len(),
        truncated,
    })
}

#[tauri::command]
pub fn source_workspace_write(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<SourceWorkspaceWrite, String> {
    let root = prepared_source_root(&app)?;
    let relative = clean_required_file_path(&path, "write")?;
    let target = root.join(&relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "cannot create parent directory for {}: {err}",
                display_source_path(&relative)
            )
        })?;
    }
    fs::write(&target, content.as_bytes()).map_err(|err| {
        format!(
            "cannot write source file {}: {err}",
            display_source_path(&relative)
        )
    })?;
    Ok(SourceWorkspaceWrite {
        path: display_source_path(&relative),
        bytes: content.len() as u64,
    })
}

#[tauri::command]
pub fn source_workspace_stat(app: AppHandle, path: String) -> Result<SourceWorkspaceStat, String> {
    let root = prepared_source_root(&app)?;
    let relative = clean_relative_path(&path)?;
    let target = root.join(&relative);
    let metadata = fs::metadata(&target).map_err(|err| {
        format!(
            "cannot stat source path {}: {err}",
            display_source_path(&relative)
        )
    })?;
    Ok(SourceWorkspaceStat {
        path: display_source_path(&relative),
        kind: if metadata.is_dir() { "dir" } else { "file" }.to_string(),
        size: metadata.len(),
        mtime: modified_unix_ms(&metadata),
    })
}

#[tauri::command]
pub fn source_workspace_search(
    app: AppHandle,
    query: String,
    path: Option<String>,
    max_hits: Option<usize>,
) -> Result<SourceWorkspaceSearch, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("query is required for source workspace search.".to_string());
    }
    let root = prepared_source_root(&app)?;
    let relative = clean_relative_path(path.as_deref().unwrap_or(""))?;
    let target = root.join(&relative);
    let limit = max_hits.unwrap_or(100).clamp(1, 500);
    let mut hits = Vec::new();
    let mut truncated = false;
    search_path(&root, &target, &query, limit, &mut hits, &mut truncated)?;
    Ok(SourceWorkspaceSearch {
        query,
        hits,
        truncated,
    })
}

fn status_for_app(app: &AppHandle) -> SourceWorkspaceStatus {
    let fallback_paths = managed_paths(app).ok();
    let workspace_root = fallback_paths
        .as_ref()
        .map(|paths| path_string(&paths.workspace_root))
        .unwrap_or_default();
    let source_root = fallback_paths
        .as_ref()
        .map(|paths| path_string(&paths.source_root))
        .unwrap_or_default();

    let bundled = match bundled_source(app) {
        Ok(bundle) => bundle,
        Err(err) => {
            return SourceWorkspaceStatus {
                available: false,
                prepared: false,
                stale: false,
                version: None,
                content_hash: None,
                file_count: None,
                total_bytes: None,
                bundled_root: None,
                workspace_root,
                source_root,
                prepared_at_unix: None,
                last_error: Some(err),
            };
        }
    };

    let installed = fallback_paths
        .as_ref()
        .and_then(|paths| read_marker(&paths.marker_path).ok());
    let prepared = fallback_paths
        .as_ref()
        .map(|paths| paths.source_root.exists())
        .unwrap_or(false)
        && installed
            .as_ref()
            .map(|marker| marker.app_managed)
            .unwrap_or(false);
    let stale = prepared
        && installed
            .as_ref()
            .map(|marker| marker.source_manifest.content_hash != bundled.manifest.content_hash)
            .unwrap_or(true);

    SourceWorkspaceStatus {
        available: true,
        prepared,
        stale,
        version: Some(bundled.manifest.version),
        content_hash: Some(bundled.manifest.content_hash),
        file_count: Some(bundled.manifest.file_count),
        total_bytes: Some(bundled.manifest.total_bytes),
        bundled_root: Some(path_string(&bundled.root)),
        workspace_root,
        source_root,
        prepared_at_unix: installed.map(|marker| marker.prepared_at_unix),
        last_error: None,
    }
}

fn prepare_for_app(app: &AppHandle) -> Result<(), String> {
    let bundle = bundled_source(app)?;
    let paths = managed_paths(app)?;

    if paths.source_root.exists() {
        let marker = read_marker(&paths.marker_path).map_err(|err| {
            format!(
                "Refusing to replace unmanaged source workspace at {}: {err}",
                paths.source_root.display()
            )
        })?;
        if !marker.app_managed {
            return Err(format!(
                "Refusing to replace unmanaged source workspace at {}.",
                paths.source_root.display()
            ));
        }
        if marker.source_manifest.content_hash == bundle.manifest.content_hash {
            return Ok(());
        }
        fs::remove_dir_all(&paths.source_root)
            .map_err(|err| format!("cannot replace stale source workspace: {err}"))?;
    }

    fs::create_dir_all(&paths.workspace_root)
        .map_err(|err| format!("cannot create {}: {err}", paths.workspace_root.display()))?;
    copy_dir_recursive(&bundle.snapshot_root, &paths.source_root)?;
    let marker = InstalledSourceMarker {
        schema_version: 1,
        app_managed: true,
        prepared_at_unix: unix_now(),
        source_manifest: bundle.manifest,
    };
    write_marker(&paths.marker_path, &marker)
}

pub(crate) fn prepared_source_root(app: &AppHandle) -> Result<PathBuf, String> {
    let paths = managed_paths(app)?;
    if !paths.source_root.exists() {
        return Err("Source workspace has not been prepared yet.".to_string());
    }
    let marker = read_marker(&paths.marker_path)?;
    if !marker.app_managed {
        return Err("Source workspace marker is not app-managed.".to_string());
    }
    paths
        .source_root
        .canonicalize()
        .map_err(|err| format!("cannot resolve source workspace root: {err}"))
}

#[derive(Debug)]
struct BundledSource {
    root: PathBuf,
    snapshot_root: PathBuf,
    manifest: SourceManifest,
}

#[derive(Debug)]
struct ManagedPaths {
    workspace_root: PathBuf,
    source_root: PathBuf,
    marker_path: PathBuf,
}

fn bundled_source(app: &AppHandle) -> Result<BundledSource, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(RESOURCE_SOURCE_DIR));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_SOURCE_DIR),
    );

    let root = candidates
    .into_iter()
    .find(|path| path.join(MANIFEST_NAME).exists())
    .ok_or_else(|| "Bundled source snapshot is missing. Run `npm run source:snapshot` before building the app.".to_string())?;
    bundled_source_from_root(root)
}

fn bundled_source_from_root(root: PathBuf) -> Result<BundledSource, String> {
    let manifest = read_manifest(&root.join(MANIFEST_NAME))?;
    let snapshot_root = root.join(&manifest.source_root_name);
    if manifest.source_root_name != SNAPSHOT_ROOT_NAME {
        return Err(format!(
            "Unsupported source snapshot root `{}`; expected `{SNAPSHOT_ROOT_NAME}`.",
            manifest.source_root_name
        ));
    }
    if !snapshot_root.is_dir() {
        return Err(format!(
            "Bundled source root is missing: {}",
            snapshot_root.display()
        ));
    }
    Ok(BundledSource {
        root,
        snapshot_root,
        manifest,
    })
}

fn managed_paths(app: &AppHandle) -> Result<ManagedPaths, String> {
    let workspace_root = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join(WORKSPACE_DIR_NAME);
    let source_root = workspace_root.join(SNAPSHOT_ROOT_NAME);
    let marker_path = source_root.join(INSTALLED_MARKER_NAME);
    Ok(ManagedPaths {
        workspace_root,
        source_root,
        marker_path,
    })
}

fn read_manifest(path: &Path) -> Result<SourceManifest, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("cannot read source manifest {}: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("invalid source manifest {}: {err}", path.display()))
}

fn read_marker(path: &Path) -> Result<InstalledSourceMarker, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("missing app-managed marker {}: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("invalid app-managed marker {}: {err}", path.display()))
}

fn write_marker(path: &Path, marker: &InstalledSourceMarker) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(marker).map_err(|err| err.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|err| {
        format!(
            "cannot write source workspace marker {}: {err}",
            path.display()
        )
    })
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|err| format!("cannot create {}: {err}", target.display()))?;
    for entry in
        fs::read_dir(source).map_err(|err| format!("cannot list {}: {err}", source.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "cannot copy {} to {}: {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn collect_entries(
    root: &Path,
    directory: &Path,
    recursive: bool,
    entries: &mut Vec<SourceWorkspaceEntry>,
    truncated: &mut bool,
) -> Result<(), String> {
    if entries.len() >= 500 {
        *truncated = true;
        return Ok(());
    }
    let mut children = fs::read_dir(directory)
        .map_err(|err| {
            format!(
                "cannot list source directory {}: {err}",
                directory.display()
            )
        })?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        if entries.len() >= 500 {
            *truncated = true;
            return Ok(());
        }
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        let relative = path.strip_prefix(root).map_err(|err| err.to_string())?;
        let kind = if metadata.is_dir() { "dir" } else { "file" };
        entries.push(SourceWorkspaceEntry {
            path: display_source_path(relative),
            name: entry.file_name().to_string_lossy().to_string(),
            kind: kind.to_string(),
            size: metadata.is_file().then_some(metadata.len()),
            mtime: modified_unix_ms(&metadata),
        });
        if recursive && metadata.is_dir() {
            collect_entries(root, &path, recursive, entries, truncated)?;
        }
    }
    Ok(())
}

fn search_path(
    root: &Path,
    target: &Path,
    query: &str,
    limit: usize,
    hits: &mut Vec<SourceWorkspaceSearchHit>,
    truncated: &mut bool,
) -> Result<(), String> {
    if hits.len() >= limit {
        *truncated = true;
        return Ok(());
    }
    let metadata = fs::metadata(target)
        .map_err(|err| format!("cannot search source path {}: {err}", target.display()))?;
    if metadata.is_file() {
        search_file(root, target, query, limit, hits, truncated)?;
        return Ok(());
    }
    let mut children = fs::read_dir(target)
        .map_err(|err| format!("cannot search source directory {}: {err}", target.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        if hits.len() >= limit {
            *truncated = true;
            break;
        }
        let path = entry.path();
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            search_path(root, &path, query, limit, hits, truncated)?;
        } else if metadata.is_file() {
            search_file(root, &path, query, limit, hits, truncated)?;
        }
    }
    Ok(())
}

fn search_file(
    root: &Path,
    path: &Path,
    query: &str,
    limit: usize,
    hits: &mut Vec<SourceWorkspaceSearchHit>,
    truncated: &mut bool,
) -> Result<(), String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    for (index, line) in content.lines().enumerate() {
        if hits.len() >= limit {
            *truncated = true;
            return Ok(());
        }
        if line.contains(query) {
            let relative = path.strip_prefix(root).map_err(|err| err.to_string())?;
            hits.push(SourceWorkspaceSearchHit {
                path: display_source_path(relative),
                line: index + 1,
                snippet: compact_snippet(line),
            });
        }
    }
    Ok(())
}

fn clean_required_file_path(path: &str, action: &str) -> Result<PathBuf, String> {
    let relative = clean_relative_path(path)?;
    if relative.as_os_str().is_empty() {
        return Err(format!("path is required for source workspace {action}."));
    }
    Ok(relative)
}

fn clean_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path
        .trim()
        .trim_start_matches("source://")
        .trim_start_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        return Ok(PathBuf::new());
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err("source workspace paths must be relative.".to_string());
    }
    let mut out = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(
                    "source workspace paths cannot escape the managed source root.".to_string(),
                );
            }
        }
    }
    Ok(out)
}

fn display_source_path(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return "source://".to_string();
    }
    format!("source://{}", path.to_string_lossy().replace('\\', "/"))
}

fn compact_snippet(line: &str) -> String {
    const LIMIT: usize = 240;
    if line.chars().count() <= LIMIT {
        return line.to_string();
    }
    format!("{}...", line.chars().take(LIMIT).collect::<String>())
}

fn modified_unix_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn bundled_source_rejects_unexpected_root_name() {
        let root = temp_root("bad-root-name");
        fs::create_dir_all(root.join("snapshot")).expect("create snapshot");
        fs::write(
            root.join(MANIFEST_NAME),
            r#"{
        "schemaVersion": 1,
        "productName": "GatesAI Chat",
        "packageName": "gatesai-chat",
        "version": "3.4.0",
        "createdAt": "2026-05-17T00:00:00.000Z",
        "contentHash": "sha256:test",
        "fileCount": 1,
        "totalBytes": 1,
        "sourceRootName": "snapshot",
        "excludes": []
      }"#,
        )
        .expect("write manifest");

        let err = bundled_source_from_root(root.clone()).expect_err("reject bad root");
        assert!(err.contains("Unsupported source snapshot root"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_dir_recursive_copies_nested_files() {
        let root = temp_root("copy-dir");
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(source.join("nested")).expect("create nested");
        fs::write(source.join("nested").join("file.txt"), "hello").expect("write file");

        copy_dir_recursive(&source, &target).expect("copy");

        assert_eq!(
            fs::read_to_string(target.join("nested").join("file.txt")).expect("read copied"),
            "hello"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clean_relative_path_rejects_escape_attempts() {
        assert!(clean_relative_path("src/App.tsx").is_ok());
        assert!(clean_relative_path("../secret.txt").is_err());
        assert!(clean_relative_path("src/../../secret.txt").is_err());
        assert!(clean_relative_path("C:\\Users\\secret.txt").is_err());
    }

    #[test]
    fn display_source_path_uses_stable_model_prefix() {
        assert_eq!(display_source_path(Path::new("")), "source://");
        assert_eq!(
            display_source_path(Path::new("src").join("App.tsx").as_path()),
            "source://src/App.tsx"
        );
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "gatesai-source-workspace-{name}-{}-{}",
            unix_now(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
