use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RESOURCE_SOURCE_DIR: &str = "source";
const SNAPSHOT_ROOT_NAME: &str = "current";
const MANIFEST_NAME: &str = "manifest.json";
const WORKSPACE_DIR_NAME: &str = "source-workspace";
const ARCHIVE_DIR_NAME: &str = "archive";
const INSTALLED_MARKER_NAME: &str = ".gatesai-source-workspace.json";
const MAX_DIFF_PREVIEW_BYTES: u64 = 200 * 1024;

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
pub struct SourceChangedFile {
    path: String,
    change: String,
    original_size: Option<u64>,
    current_size: Option<u64>,
    preview_available: bool,
    original_content: Option<String>,
    current_content: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChangedFiles {
    files: Vec<SourceChangedFile>,
    latest_change_at_unix: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRevertResult {
    path: String,
    change: String,
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
    let root = prepared_source_root(&app)?;
    open::that_detached(&root).map_err(|err| format!("cannot open {}: {err}", root.display()))
}

#[tauri::command]
pub fn source_workspace_list(
    app: AppHandle,
    path: Option<String>,
    recursive: Option<bool>,
) -> Result<SourceWorkspaceList, String> {
    let root = prepared_source_root(&app)?;
    let relative = clean_relative_path(path.as_deref().unwrap_or(""))?;
    let target = resolve_existing_source_path(&root, &relative)?;
    let metadata = fs::symlink_metadata(&target).map_err(|err| {
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
    let target = resolve_existing_source_path(&root, &relative)?;
    let metadata = fs::symlink_metadata(&target).map_err(|err| {
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
    let target = resolve_source_write_path(&root, &relative)?;
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
    let target = resolve_existing_source_path(&root, &relative)?;
    let metadata = fs::symlink_metadata(&target).map_err(|err| {
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
    let target = resolve_existing_source_path(&root, &relative)?;
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

#[tauri::command]
pub fn source_changed_files(app: AppHandle) -> Result<SourceChangedFiles, String> {
    let root = prepared_source_root(&app)?;
    let bundle = bundled_source(&app)?;
    changed_files_for_roots(&bundle.snapshot_root, &root)
}

#[tauri::command]
pub fn source_revert_file(app: AppHandle, path: String) -> Result<SourceRevertResult, String> {
    let root = prepared_source_root(&app)?;
    let bundle = bundled_source(&app)?;
    revert_file_for_roots(&bundle.snapshot_root, &root, &path)
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

    let installed = fallback_paths.as_ref().and_then(|paths| {
        let metadata = fs::symlink_metadata(&paths.source_root).ok()?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return None;
        }
        read_marker(&paths.marker_path).ok()
    });
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

    match fs::symlink_metadata(&paths.source_root) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(format!(
                    "Refusing non-directory or symlinked source workspace at {}.",
                    paths.source_root.display()
                ));
            }
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
            archive_source_workspace(
                &paths.workspace_root,
                &paths.source_root,
                marker.prepared_at_unix,
            )?;
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(format!(
                "cannot inspect source workspace {}: {err}",
                paths.source_root.display()
            ));
        }
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

fn archive_source_workspace(
    workspace_root: &Path,
    source_root: &Path,
    prepared_at_unix: u64,
) -> Result<PathBuf, String> {
    let archive_root = prepare_archive_root(workspace_root)?;

    for suffix in 0..1_000_u32 {
        let name = if suffix == 0 {
            format!("{SNAPSHOT_ROOT_NAME}-{prepared_at_unix}")
        } else {
            format!("{SNAPSHOT_ROOT_NAME}-{prepared_at_unix}-{suffix}")
        };
        let archived = archive_root.join(name);
        if fs::symlink_metadata(&archived).is_ok() {
            continue;
        }
        fs::rename(source_root, &archived).map_err(|err| {
            format!(
                "cannot archive stale source workspace {} to {}: {err}",
                source_root.display(),
                archived.display()
            )
        })?;
        return Ok(archived);
    }

    Err("cannot archive stale source workspace: archive name limit exhausted".to_string())
}

fn prepare_archive_root(workspace_root: &Path) -> Result<PathBuf, String> {
    let canonical_workspace = workspace_root
        .canonicalize()
        .map_err(|err| format!("cannot resolve managed source workspace: {err}"))?;
    let archive_root = workspace_root.join(ARCHIVE_DIR_NAME);

    match fs::symlink_metadata(&archive_root) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("refusing symlinked source workspace archive".to_string());
            }
            if !metadata.is_dir() {
                return Err("source workspace archive path is not a directory".to_string());
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&archive_root)
                .map_err(|err| format!("cannot create source workspace archive: {err}"))?;
        }
        Err(err) => return Err(format!("cannot inspect source workspace archive: {err}")),
    }

    let canonical_archive = archive_root
        .canonicalize()
        .map_err(|err| format!("cannot resolve source workspace archive: {err}"))?;
    if canonical_archive.parent() != Some(canonical_workspace.as_path()) {
        return Err("source workspace archive escapes the managed workspace".to_string());
    }
    Ok(canonical_archive)
}

pub(crate) fn prepared_source_root(app: &AppHandle) -> Result<PathBuf, String> {
    let paths = managed_paths(app)?;
    let metadata = fs::symlink_metadata(&paths.source_root)
        .map_err(|_| "Source workspace has not been prepared yet.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Source workspace root must be a real directory.".to_string());
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
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("missing app-managed marker {}: {err}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "app-managed marker must be a real file: {}",
            path.display()
        ));
    }
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
        let metadata = fs::symlink_metadata(&path).map_err(|err| err.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "source workspace symlinks are not allowed: {}",
                path.display()
            ));
        }
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
    let metadata = fs::symlink_metadata(target)
        .map_err(|err| format!("cannot search source path {}: {err}", target.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "source workspace symlinks are not allowed: {}",
            target.display()
        ));
    }
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
        let metadata = fs::symlink_metadata(&path).map_err(|err| err.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "source workspace symlinks are not allowed: {}",
                path.display()
            ));
        }
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

fn changed_files_for_roots(
    snapshot_root: &Path,
    source_root: &Path,
) -> Result<SourceChangedFiles, String> {
    let mut paths = BTreeSet::new();
    collect_file_paths(snapshot_root, snapshot_root, &mut paths)?;
    collect_file_paths(source_root, source_root, &mut paths)?;

    let mut files = Vec::new();
    let mut latest_change_at_unix = None;
    for relative in paths {
        if is_internal_marker(&relative) {
            continue;
        }
        if let Some(file) = changed_file_for_path(snapshot_root, source_root, &relative)? {
            latest_change_at_unix =
                latest_change_at_unix.max(changed_file_mtime_unix(source_root, &relative));
            files.push(file);
        }
    }
    Ok(SourceChangedFiles {
        files,
        latest_change_at_unix,
    })
}

fn changed_file_for_path(
    snapshot_root: &Path,
    source_root: &Path,
    relative: &Path,
) -> Result<Option<SourceChangedFile>, String> {
    let original = snapshot_root.join(relative);
    let current = source_root.join(relative);
    let original_meta = fs::metadata(&original).ok().filter(|meta| meta.is_file());
    let current_meta = fs::metadata(&current).ok().filter(|meta| meta.is_file());
    let path = display_source_path(relative);

    match (original_meta, current_meta) {
        (None, None) => Ok(None),
        (None, Some(current_meta)) => {
            let current_content = preview_content(&current, current_meta.len());
            Ok(Some(SourceChangedFile {
                path,
                change: "added".to_string(),
                original_size: None,
                current_size: Some(current_meta.len()),
                preview_available: current_content.is_some(),
                original_content: None,
                current_content,
            }))
        }
        (Some(original_meta), None) => {
            let original_content = preview_content(&original, original_meta.len());
            Ok(Some(SourceChangedFile {
                path,
                change: "deleted".to_string(),
                original_size: Some(original_meta.len()),
                current_size: None,
                preview_available: original_content.is_some(),
                original_content,
                current_content: None,
            }))
        }
        (Some(original_meta), Some(current_meta)) => {
            if original_meta.len() == current_meta.len() && files_equal(&original, &current)? {
                return Ok(None);
            }
            let original_content = preview_content(&original, original_meta.len());
            let current_content = preview_content(&current, current_meta.len());
            Ok(Some(SourceChangedFile {
                path,
                change: "modified".to_string(),
                original_size: Some(original_meta.len()),
                current_size: Some(current_meta.len()),
                preview_available: original_content.is_some() && current_content.is_some(),
                original_content,
                current_content,
            }))
        }
    }
}

fn revert_file_for_roots(
    snapshot_root: &Path,
    source_root: &Path,
    path: &str,
) -> Result<SourceRevertResult, String> {
    let relative = clean_required_file_path(path, "revert")?;
    if is_internal_marker(&relative) {
        return Err("cannot revert the source workspace marker.".to_string());
    }
    let original = resolve_optional_source_path(snapshot_root, &relative)?
        .unwrap_or_else(|| snapshot_root.join(&relative));
    let current = resolve_optional_source_path(source_root, &relative)?
        .unwrap_or_else(|| source_root.join(&relative));
    let original_file = fs::symlink_metadata(&original)
        .ok()
        .filter(|meta| meta.is_file())
        .is_some();
    let current_file = fs::symlink_metadata(&current)
        .ok()
        .filter(|meta| meta.is_file())
        .is_some();

    if original_file {
        if current_file {
            archive_reverted_source_file(source_root, &current, &relative, unix_now())?;
        }
        let restore_target = resolve_source_write_path(source_root, &relative)?;
        fs::copy(&original, &restore_target).map_err(|err| {
            format!(
                "cannot restore {} from bundled snapshot: {err}",
                display_source_path(&relative)
            )
        })?;
        return Ok(SourceRevertResult {
            path: display_source_path(&relative),
            change: if current_file {
                "modified".to_string()
            } else {
                "deleted".to_string()
            },
        });
    }

    if current_file {
        archive_reverted_source_file(source_root, &current, &relative, unix_now())?;
        return Ok(SourceRevertResult {
            path: display_source_path(&relative),
            change: "added".to_string(),
        });
    }

    Err(format!(
        "source file has no bundled or current file to revert: {}",
        display_source_path(&relative)
    ))
}

fn archive_reverted_source_file(
    source_root: &Path,
    current: &Path,
    relative: &Path,
    archived_at_unix: u64,
) -> Result<PathBuf, String> {
    let workspace_root = source_root
        .parent()
        .ok_or_else(|| "source workspace root has no managed parent".to_string())?;
    let archive_root = prepare_archive_root(workspace_root)?;

    for suffix in 0..1_000_u32 {
        let name = if suffix == 0 {
            format!("reverted-{archived_at_unix}")
        } else {
            format!("reverted-{archived_at_unix}-{suffix}")
        };
        let batch_root = archive_root.join(name);
        match fs::create_dir(&batch_root) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("cannot create source revert archive: {err}")),
        }
        let archived = batch_root.join(relative);
        if let Some(parent) = archived.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("cannot create source revert archive: {err}"))?;
        }
        fs::rename(current, &archived).map_err(|err| {
            format!(
                "cannot archive reverted source file {} to {}: {err}",
                display_source_path(relative),
                archived.display()
            )
        })?;
        return Ok(archived);
    }

    Err("cannot archive reverted source file: archive name limit exhausted".to_string())
}

fn collect_file_paths(
    root: &Path,
    directory: &Path,
    out: &mut BTreeSet<PathBuf>,
) -> Result<(), String> {
    if !directory.exists() {
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
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|err| err.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "source workspace symlinks are not allowed: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_file_paths(root, &path, out)?;
        } else if metadata.is_file() {
            let relative = path.strip_prefix(root).map_err(|err| err.to_string())?;
            out.insert(relative.to_path_buf());
        }
    }
    Ok(())
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_bytes =
        fs::read(left).map_err(|err| format!("cannot read {}: {err}", left.display()))?;
    let right_bytes =
        fs::read(right).map_err(|err| format!("cannot read {}: {err}", right.display()))?;
    Ok(left_bytes == right_bytes)
}

fn changed_file_mtime_unix(source_root: &Path, relative: &Path) -> Option<u64> {
    let current = source_root.join(relative);
    fs::metadata(&current)
        .or_else(|_| fs::metadata(current.parent().unwrap_or(source_root)))
        .ok()
        .map(|metadata| modified_unix_ms(&metadata) / 1000)
}

fn preview_content(path: &Path, size: u64) -> Option<String> {
    if size > MAX_DIFF_PREVIEW_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn is_internal_marker(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == INSTALLED_MARKER_NAME)
        .unwrap_or(false)
}

fn resolve_existing_source_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    resolve_optional_source_path(root, relative)?.ok_or_else(|| {
        format!(
            "source workspace path does not exist: {}",
            display_source_path(relative)
        )
    })
}

fn resolve_optional_source_path(root: &Path, relative: &Path) -> Result<Option<PathBuf>, String> {
    let mut current = root.to_path_buf();
    let root_metadata = fs::symlink_metadata(&current)
        .map_err(|err| format!("cannot inspect source workspace root: {err}"))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("source workspace root must be a real directory".to_string());
    }

    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("source workspace path contains an invalid component".to_string());
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!(
                        "source workspace symlinks are not allowed: {}",
                        display_source_path(relative)
                    ));
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(format!(
                    "cannot inspect source workspace path {}: {err}",
                    display_source_path(relative)
                ));
            }
        }
    }
    Ok(Some(current))
}

fn resolve_source_write_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let mut current = root.to_path_buf();
    let root_metadata = fs::symlink_metadata(&current)
        .map_err(|err| format!("cannot inspect source workspace root: {err}"))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("source workspace root must be a real directory".to_string());
    }

    for component in parent.components() {
        let Component::Normal(part) = component else {
            return Err("source workspace path contains an invalid component".to_string());
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!(
                        "source workspace symlinks are not allowed: {}",
                        display_source_path(relative)
                    ));
                }
                if !metadata.is_dir() {
                    return Err(format!(
                        "source workspace parent is not a directory: {}",
                        display_source_path(relative)
                    ));
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|err| {
                    format!(
                        "cannot create parent directory for {}: {err}",
                        display_source_path(relative)
                    )
                })?;
            }
            Err(err) => {
                return Err(format!(
                    "cannot inspect source workspace path {}: {err}",
                    display_source_path(relative)
                ));
            }
        }
    }

    let target = root.join(relative);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "source workspace symlinks are not allowed: {}",
                display_source_path(relative)
            ));
        }
    }
    Ok(target)
}

fn clean_required_file_path(path: &str, action: &str) -> Result<PathBuf, String> {
    let relative = clean_relative_path(path)?;
    if relative.as_os_str().is_empty() {
        return Err(format!("path is required for source workspace {action}."));
    }
    Ok(relative)
}

fn clean_relative_path(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim();
    let trimmed = raw.strip_prefix("source://").unwrap_or(raw);
    if trimmed.is_empty() || trimmed == "." {
        return Ok(PathBuf::new());
    }
    // Model-facing source paths are portable POSIX-style relative paths.
    // Path::components() on Unix treats Windows separators and drive prefixes
    // as ordinary filename bytes, so reject them explicitly before joining.
    if trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.contains('\\')
        || (trimmed.as_bytes().get(1) == Some(&b':') && trimmed.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err("source workspace paths must be portable relative paths.".to_string());
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
    fn archive_source_workspace_preserves_stale_tree() {
        let root = temp_root("archive-stale");
        let workspace = root.join("source-workspace");
        let source = workspace.join(SNAPSHOT_ROOT_NAME);
        fs::create_dir_all(source.join("src")).expect("create stale source");
        fs::write(source.join("src").join("App.tsx"), "stale edit").expect("write stale edit");

        let archived = archive_source_workspace(&workspace, &source, 1234).expect("archive");

        assert_eq!(
            archived,
            workspace.join(ARCHIVE_DIR_NAME).join("current-1234")
        );
        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(archived.join("src").join("App.tsx")).expect("read archived edit"),
            "stale edit"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn archive_source_workspace_uses_collision_safe_name() {
        let root = temp_root("archive-collision");
        let workspace = root.join("source-workspace");
        let source = workspace.join(SNAPSHOT_ROOT_NAME);
        let occupied = workspace.join(ARCHIVE_DIR_NAME).join("current-1234");
        fs::create_dir_all(&source).expect("create stale source");
        fs::create_dir_all(&occupied).expect("create occupied archive");
        fs::write(source.join("keep.txt"), "keep").expect("write stale file");

        let archived = archive_source_workspace(&workspace, &source, 1234).expect("archive");

        assert_eq!(
            archived,
            workspace.join(ARCHIVE_DIR_NAME).join("current-1234-1")
        );
        assert!(occupied.exists());
        assert_eq!(
            fs::read_to_string(archived.join("keep.txt")).expect("read archived file"),
            "keep"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn archive_source_workspace_rejects_symlinked_archive_root() {
        use std::os::unix::fs::symlink;

        let root = temp_root("archive-symlink-workspace");
        let workspace = root.join("source-workspace");
        let source = workspace.join(SNAPSHOT_ROOT_NAME);
        let outside = root.join("outside");
        fs::create_dir_all(&source).expect("create stale source");
        fs::create_dir_all(&outside).expect("create outside");
        symlink(&outside, workspace.join(ARCHIVE_DIR_NAME)).expect("link archive outside");

        let err = archive_source_workspace(&workspace, &source, 1234)
            .expect_err("reject symlinked archive");

        assert!(err.contains("refusing symlinked source workspace archive"));
        assert!(source.exists());
        assert!(fs::read_dir(&outside)
            .expect("list outside")
            .next()
            .is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clean_relative_path_rejects_escape_attempts() {
        assert!(clean_relative_path("src/App.tsx").is_ok());
        assert!(clean_relative_path("../secret.txt").is_err());
        assert!(clean_relative_path("src/../../secret.txt").is_err());
        assert!(clean_relative_path("C:\\Users\\secret.txt").is_err());
        assert!(clean_relative_path("..\\secret.txt").is_err());
        assert!(clean_relative_path("\\\\server\\share\\secret.txt").is_err());
        assert!(clean_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn changed_files_reports_added_modified_deleted_and_skips_marker() {
        let root = temp_root("changed-files");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        fs::create_dir_all(snapshot.join("src")).expect("create snapshot");
        fs::create_dir_all(source.join("src")).expect("create source");
        fs::write(snapshot.join("src").join("same.txt"), "same").expect("write same snapshot");
        fs::write(source.join("src").join("same.txt"), "same").expect("write same source");
        fs::write(snapshot.join("src").join("mod.txt"), "old").expect("write mod snapshot");
        fs::write(source.join("src").join("mod.txt"), "new").expect("write mod source");
        fs::write(snapshot.join("src").join("gone.txt"), "gone").expect("write deleted snapshot");
        fs::write(source.join("src").join("add.txt"), "add").expect("write added source");
        fs::write(source.join(INSTALLED_MARKER_NAME), "{}").expect("write marker");

        let files = changed_files_for_roots(&snapshot, &source)
            .expect("changed files")
            .files;
        let paths = files
            .iter()
            .map(|file| (file.path.as_str(), file.change.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            vec![
                ("source://src/add.txt", "added"),
                ("source://src/gone.txt", "deleted"),
                ("source://src/mod.txt", "modified"),
            ]
        );
        assert!(files.iter().all(|file| file.preview_available));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn changed_files_reports_latest_source_change_time() {
        let root = temp_root("changed-files-mtime");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        fs::create_dir_all(&snapshot).expect("create snapshot");
        fs::create_dir_all(&source).expect("create source");
        fs::write(snapshot.join("app.txt"), "old").expect("write snapshot");
        fs::write(source.join("app.txt"), "new").expect("write source");

        let files = changed_files_for_roots(&snapshot, &source).expect("changed files");

        assert_eq!(files.files.len(), 1);
        assert!(files.latest_change_at_unix.is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revert_file_rejects_escape_attempts() {
        let root = temp_root("revert-escape");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        fs::create_dir_all(&snapshot).expect("create snapshot");
        fs::create_dir_all(&source).expect("create source");

        assert!(revert_file_for_roots(&snapshot, &source, "../secret.txt").is_err());
        assert!(revert_file_for_roots(&snapshot, &source, "C:\\Users\\secret.txt").is_err());
        assert!(revert_file_for_roots(&snapshot, &source, INSTALLED_MARKER_NAME).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revert_file_restores_deleted_and_archives_added_files() {
        let root = temp_root("revert-files");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        fs::create_dir_all(snapshot.join("src")).expect("create snapshot");
        fs::create_dir_all(source.join("src")).expect("create source");
        fs::write(snapshot.join("src").join("restore.txt"), "original").expect("write snapshot");
        fs::write(source.join("src").join("added.txt"), "new").expect("write added");

        let restored =
            revert_file_for_roots(&snapshot, &source, "src/restore.txt").expect("restore");
        let removed = revert_file_for_roots(&snapshot, &source, "src/added.txt").expect("remove");

        assert_eq!(restored.change, "deleted");
        assert_eq!(removed.change, "added");
        assert_eq!(
            fs::read_to_string(source.join("src").join("restore.txt")).expect("read restored"),
            "original"
        );
        assert!(!source.join("src").join("added.txt").exists());
        let archive = root.join(ARCHIVE_DIR_NAME);
        let archived = fs::read_dir(&archive)
            .expect("list archive")
            .next()
            .expect("archive entry")
            .expect("read archive entry")
            .path()
            .join("src")
            .join("added.txt");
        assert_eq!(
            fs::read_to_string(archived).expect("read archived added file"),
            "new"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revert_file_archives_modified_content_before_restore() {
        let root = temp_root("revert-modified");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        fs::create_dir_all(snapshot.join("src")).expect("create snapshot");
        fs::create_dir_all(source.join("src")).expect("create source");
        fs::write(snapshot.join("src").join("App.tsx"), "original").expect("write snapshot");
        fs::write(source.join("src").join("App.tsx"), "edited").expect("write edit");

        let reverted = revert_file_for_roots(&snapshot, &source, "src/App.tsx").expect("revert");

        assert_eq!(reverted.change, "modified");
        assert_eq!(
            fs::read_to_string(source.join("src").join("App.tsx")).expect("read restored source"),
            "original"
        );
        let archive = root.join(ARCHIVE_DIR_NAME);
        let archived = fs::read_dir(&archive)
            .expect("list archive")
            .next()
            .expect("archive entry")
            .expect("read archive entry")
            .path()
            .join("src")
            .join("App.tsx");
        assert_eq!(
            fs::read_to_string(archived).expect("read archived edit"),
            "edited"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn revert_file_rejects_symlinked_archive_root() {
        use std::os::unix::fs::symlink;

        let root = temp_root("archive-symlink-revert");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        let outside = root.join("outside");
        fs::create_dir_all(&snapshot).expect("create snapshot");
        fs::create_dir_all(&source).expect("create source");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(source.join("added.txt"), "keep").expect("write added file");
        symlink(&outside, root.join(ARCHIVE_DIR_NAME)).expect("link archive outside");

        let err = revert_file_for_roots(&snapshot, &source, "added.txt")
            .expect_err("reject symlinked archive");

        assert!(err.contains("refusing symlinked source workspace archive"));
        assert_eq!(
            fs::read_to_string(source.join("added.txt")).expect("read preserved source"),
            "keep"
        );
        assert!(fs::read_dir(&outside)
            .expect("list outside")
            .next()
            .is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn source_path_resolution_rejects_intermediate_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_root("source-path-symlink");
        let source = root.join("source");
        let source_link = root.join("source-link");
        let outside = root.join("outside");
        fs::create_dir_all(&source).expect("create source");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(outside.join("secret.txt"), "secret").expect("write outside file");
        symlink(&outside, source.join("link")).expect("link source outside");
        symlink(&source, &source_link).expect("link source root");
        let relative = Path::new("link/secret.txt");

        let read_err = resolve_existing_source_path(&source, relative)
            .expect_err("reject symlinked read path");
        let write_err =
            resolve_source_write_path(&source, relative).expect_err("reject symlinked write path");
        let root_err = resolve_existing_source_path(&source_link, relative)
            .expect_err("reject symlinked source root");

        assert!(read_err.contains("source workspace symlinks are not allowed"));
        assert!(write_err.contains("source workspace symlinks are not allowed"));
        assert!(root_err.contains("source workspace root must be a real directory"));
        assert_eq!(
            fs::read_to_string(outside.join("secret.txt")).expect("read outside file"),
            "secret"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn read_marker_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_root("marker-symlink");
        fs::create_dir_all(&root).expect("create root");
        let outside = root.join("outside.json");
        let marker = root.join(INSTALLED_MARKER_NAME);
        fs::write(&outside, "{}").expect("write outside marker");
        symlink(&outside, &marker).expect("link marker");

        let err = read_marker(&marker).expect_err("reject symlinked marker");

        assert!(err.contains("app-managed marker must be a real file"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn revert_file_rejects_intermediate_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_root("revert-path-symlink");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        let outside = root.join("outside");
        fs::create_dir_all(&snapshot).expect("create snapshot");
        fs::create_dir_all(&source).expect("create source");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(outside.join("host.txt"), "host content").expect("write outside file");
        symlink(&outside, source.join("link")).expect("link source outside");

        let err = revert_file_for_roots(&snapshot, &source, "link/host.txt")
            .expect_err("reject symlinked revert path");

        assert!(err.contains("source workspace symlinks are not allowed"));
        assert_eq!(
            fs::read_to_string(outside.join("host.txt")).expect("read outside file"),
            "host content"
        );
        assert!(!root.join(ARCHIVE_DIR_NAME).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn recursive_source_walks_reject_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_root("recursive-symlink");
        let snapshot = root.join("snapshot");
        let source = root.join("source");
        let outside = root.join("outside");
        fs::create_dir_all(&snapshot).expect("create snapshot");
        fs::create_dir_all(&source).expect("create source");
        fs::create_dir_all(&outside).expect("create outside");
        fs::write(outside.join("secret.txt"), "needle").expect("write outside file");
        symlink(&outside, source.join("link")).expect("link source outside");

        let mut entries = Vec::new();
        let mut list_truncated = false;
        let list_err = collect_entries(&source, &source, true, &mut entries, &mut list_truncated)
            .expect_err("reject symlinked list");
        let mut hits = Vec::new();
        let mut search_truncated = false;
        let search_err = search_path(
            &source,
            &source,
            "needle",
            10,
            &mut hits,
            &mut search_truncated,
        )
        .expect_err("reject symlinked search");
        let changed_err =
            changed_files_for_roots(&snapshot, &source).expect_err("reject symlinked diff walk");

        assert!(list_err.contains("source workspace symlinks are not allowed"));
        assert!(search_err.contains("source workspace symlinks are not allowed"));
        assert!(changed_err.contains("source workspace symlinks are not allowed"));
        assert!(entries.is_empty());
        assert!(hits.is_empty());
        let _ = fs::remove_dir_all(root);
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
