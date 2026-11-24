//! Getting the processing engine onto this PC.
//!
//! The installer carries only the window. The engine (Python, PyTorch, the models' code and
//! ffmpeg, 4 GB unpacked) comes as one 7z archive per edition from the GitHub release:
//! `UT-Stems-<version>-engine-<edition>.7z` with a `.sha256` file next to it. The edition
//! follows the graphics adapter: `cuda` for NVIDIA, `xpu` for Intel Arc, `cpu` otherwise.
//! A matching archive next to the executable or in Downloads is used instead of downloading.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const EDITIONS: [&str; 3] = ["cuda", "xpu", "cpu"];
const DEFAULT_BASE: &str = "https://github.com/zeberity123/ut_2_stems/releases/download/v{version}/";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Manifest {
    pub version: String,
    pub edition: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: Option<Manifest>,
    pub needs_update: bool,
    pub app_version: String,
    pub graphics: Vec<String>,
    pub suggested: String,
    pub folder: String,
    pub nearby: Option<String>,
    pub base_url: String,
    /// Bytes free on the drive the engine goes to, and what each edition needs there
    /// (its archive while unpacking plus the unpacked engine, with some room).
    pub free_bytes: u64,
    pub needed_bytes: std::collections::BTreeMap<String, u64>,
}

/// Rough sizes per edition: the archive, and the engine once unpacked.
fn sizes(edition: &str) -> (u64, u64) {
    match edition {
        "cuda" => (1_750_000_000, 4_400_000_000),
        "xpu" => (1_250_000_000, 3_600_000_000),
        _ => (250_000_000, 800_000_000),
    }
}

fn needed(edition: &str, downloading: bool) -> u64 {
    let (archive, unpacked) = sizes(edition);
    unpacked + if downloading { archive } else { 0 } + 500_000_000
}

/// Free space on the drive that holds `path`.
pub fn free_space(path: &Path) -> Option<u64> {
    let drive = path.components().next()?.as_os_str().to_string_lossy().into_owned();
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-Command", &format!("[System.IO.DriveInfo]::new('{drive}\\').AvailableFreeSpace")]);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(CREATE_NO_WINDOW); }
    String::from_utf8_lossy(&command.output().ok()?.stdout).trim().parse().ok()
}

fn gb(bytes: u64) -> String { format!("{:.1} GB", bytes as f64 / 1e9) }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: &'static str, // download, verify, unpack
    pub done: u64,
    pub total: u64,
    pub rate: u64, // bytes per second, downloads only
}

pub fn archive_name(edition: &str) -> String {
    format!("UT-Stems-{VERSION}-engine-{edition}.7z")
}

pub fn base_url() -> String {
    std::env::var("UT_STEMS_ENGINE_BASE").unwrap_or_else(|_| DEFAULT_BASE.replace("{version}", VERSION))
}

/// `engine\` next to the executable, which is where the installer's uninstaller looks for it.
pub fn engine_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|dir| dir.join("engine"))
}

pub fn installed(dir: &Path) -> Option<Manifest> {
    if !dir.join("ut-stems-engine.exe").is_file() {
        return None;
    }
    fs::read_to_string(dir.join("engine.json")).ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .or(Some(Manifest { version: String::new(), edition: String::new() }))
}

/// Names of the graphics adapters, from Windows' own list.
pub fn graphics() -> Vec<String> {
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-Command",
        "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join \"`n\""]);
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(CREATE_NO_WINDOW); }
    let output = command.output().ok();
    let text = output.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    let mut names: Vec<String> = text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    if names.is_empty() {
        // Without the adapter list, the NVIDIA driver's own library still tells us about an NVIDIA GPU.
        if Path::new(r"C:\Windows\System32\nvcuda.dll").is_file() { names.push("NVIDIA GPU".into()); }
    }
    names
}

pub fn suggest(graphics: &[String]) -> &'static str {
    let joined = graphics.join(" ").to_lowercase();
    if joined.contains("nvidia") || joined.contains("geforce") || joined.contains("rtx") { "cuda" }
    else if joined.contains("intel") && (joined.contains("arc") || joined.contains("core ultra")) { "xpu" }
    else { "cpu" }
}

/// An archive for this edition that is already on this PC.
pub fn nearby(edition: &str) -> Option<PathBuf> {
    let name = archive_name(edition);
    let mut folders = vec![];
    if let Some(exe) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        folders.push(exe.clone());
        if let Some(parent) = exe.parent() { folders.push(parent.to_path_buf()); }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") { folders.push(PathBuf::from(home).join("Downloads")); }
    folders.into_iter().map(|dir| dir.join(&name)).find(|path| path.is_file())
}

pub fn status() -> Status {
    let dir = engine_dir().unwrap_or_default();
    let installed = installed(&dir);
    let graphics = graphics();
    let suggested = installed.as_ref().filter(|m| EDITIONS.contains(&m.edition.as_str()))
        .map(|m| m.edition.clone()).unwrap_or_else(|| suggest(&graphics).to_string());
    Status {
        needs_update: installed.as_ref().map(|m| m.version != VERSION).unwrap_or(false),
        installed,
        app_version: VERSION.into(),
        nearby: nearby(&suggested).map(|p| p.to_string_lossy().into_owned()),
        suggested,
        graphics,
        free_bytes: free_space(&dir).unwrap_or(u64::MAX),
        needed_bytes: EDITIONS.iter().map(|e| (e.to_string(), needed(e, true))).collect(),
        folder: dir.to_string_lossy().into_owned(),
        base_url: base_url(),
    }
}

fn emit(app: &AppHandle, progress: Progress) {
    let _ = app.emit("engine-progress", progress);
}

fn cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) { Err("Cancelled.".into()) } else { Ok(()) }
}

/// The expected SHA-256 from the `.sha256` file next to the archive (online or on disk).
fn expected_hash(source: &str) -> Option<String> {
    let text = if source.starts_with("http") {
        ureq::get(format!("{source}.sha256")).call().ok()?.body_mut().read_to_string().ok()?
    } else {
        fs::read_to_string(format!("{source}.sha256")).ok()?
    };
    let hash = text.split_whitespace().next()?.to_lowercase();
    (hash.len() == 64).then_some(hash)
}

fn download(app: &AppHandle, url: &str, target: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut response = ureq::get(url).call().map_err(|e| match e {
        ureq::Error::StatusCode(404) => format!("The engine archive is not published yet ({url})."),
        other => format!("Download failed: {other}"),
    })?;
    let total = response.body().content_length().unwrap_or(0);
    let mut reader = response.body_mut().with_config().limit(u64::MAX).reader();
    let mut file = fs::File::create(target).map_err(|e| format!("Cannot write {}: {e}", target.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let (mut done, started, mut last) = (0u64, Instant::now(), Instant::now());
    loop {
        cancelled(cancel)?;
        let n = reader.read(&mut buffer).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 { break; }
        file.write_all(&buffer[..n]).map_err(|e| format!("Cannot write {}: {e}", target.display()))?;
        hasher.update(&buffer[..n]);
        done += n as u64;
        if last.elapsed().as_millis() >= 300 {
            last = Instant::now();
            let rate = (done as f64 / started.elapsed().as_secs_f64().max(0.001)) as u64;
            emit(app, Progress { phase: "download", done, total, rate });
        }
    }
    if total > 0 && done != total { return Err("The download stopped before the end. Try again.".into()); }
    emit(app, Progress { phase: "download", done, total: total.max(done), rate: 0 });
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn hash_file(app: &AppHandle, path: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let (mut done, mut last) = (0u64, Instant::now());
    loop {
        cancelled(cancel)?;
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
        done += n as u64;
        if last.elapsed().as_millis() >= 300 { last = Instant::now(); emit(app, Progress { phase: "verify", done, total, rate: 0 }); }
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn unpack(app: &AppHandle, archive: &Path, dest: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("Cannot open {}: {e}", archive.display()))?;
    let mut reader = sevenz_rust2::ArchiveReader::new(file, sevenz_rust2::Password::empty())
        .map_err(|e| format!("Not a usable archive: {e}"))?;
    // One decoding thread: the parallel decoder keeps gigabytes of decoded data in memory,
    // which a laptop with 8 GB cannot spare. Single-threaded, the unpacking streams to disk.
    reader.set_thread_count(1);
    let total: u64 = reader.archive().files.iter().map(|entry| entry.size()).sum();
    let (mut done, mut last) = (0u64, Instant::now());
    emit(app, Progress { phase: "unpack", done, total, rate: 0 });
    reader.for_each_entries(|entry, stream| {
        if cancel.load(Ordering::Relaxed) { return Err(sevenz_rust2::Error::Other("Cancelled.".into())); }
        let path = dest.join(entry.name());
        let kept = sevenz_rust2::default_entry_extract_fn(entry, stream, &path)?;
        done += entry.size();
        if last.elapsed().as_millis() >= 300 { last = Instant::now(); emit(app, Progress { phase: "unpack", done, total, rate: 0 }); }
        Ok(kept)
    }).map_err(|e| if e.to_string().contains("Cancelled") { "Cancelled.".to_string() } else { format!("Unpacking failed: {e}") })?;
    emit(app, Progress { phase: "unpack", done: total, total, rate: 0 });
    Ok(())
}

/// Downloads (or takes the given file), verifies, unpacks and installs the engine of one edition.
pub fn install(app: &AppHandle, edition: &str, file: Option<PathBuf>, cancel: Arc<AtomicBool>) -> Result<Manifest, String> {
    if !EDITIONS.contains(&edition) { return Err(format!("Unknown edition {edition}.")); }
    let dir = engine_dir().ok_or("Cannot tell where the app is installed.")?;
    let parent = dir.parent().ok_or("Cannot tell where the app is installed.")?.to_path_buf();
    fs::create_dir_all(&parent).map_err(|e| format!("Cannot write to {}: {e}", parent.display()))?;
    let staging = parent.join("engine.new");
    let _ = fs::remove_dir_all(&staging);
    // Running out of disk half-way is the worst way to find out; check first.
    let need = needed(edition, file.is_none());
    if let Some(free) = free_space(&parent) {
        if free < need {
            return Err(format!("Not enough space on this drive: the {edition} engine needs about {} free while it is installed, and {} is free. Make room and try again.", gb(need), gb(free)));
        }
    }

    let (archive, downloaded, expected, actual) = match file {
        Some(path) => {
            let source = path.to_string_lossy().into_owned();
            let expected = expected_hash(&source);
            let actual = hash_file(app, &path, &cancel)?;
            (path, false, expected, actual)
        }
        None => {
            let url = format!("{}{}", base_url(), archive_name(edition));
            let expected = expected_hash(&url).ok_or("The checksum for this engine is not published; cannot verify the download.")?;
            let target = parent.join(format!("{}.part", archive_name(edition)));
            let actual = download(app, &url, &target, &cancel).inspect_err(|_| { let _ = fs::remove_file(&target); })?;
            (target, true, Some(expected), actual)
        }
    };
    if let Some(expected) = expected {
        if expected != actual {
            if downloaded { let _ = fs::remove_file(&archive); }
            return Err("The archive is damaged (its checksum does not match). Download it again.".into());
        }
    }

    let result = unpack(app, &archive, &staging, &cancel);
    if downloaded { let _ = fs::remove_file(&archive); }
    result.inspect_err(|_| { let _ = fs::remove_dir_all(&staging); })?;

    // The archive holds the engine folder's contents; some tools put them one folder deeper.
    let root = if staging.join("ut-stems-engine.exe").is_file() { staging.clone() } else {
        fs::read_dir(&staging).ok().into_iter().flatten().filter_map(Result::ok).map(|e| e.path())
            .find(|p| p.join("ut-stems-engine.exe").is_file())
            .ok_or("The archive does not contain the engine (ut-stems-engine.exe).")?
    };
    let manifest = Manifest { version: VERSION.into(), edition: edition.into() };
    fs::write(root.join("engine.json"), serde_json::to_vec_pretty(&manifest).unwrap()).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&root, &dir).map_err(|e| format!("Cannot move the engine into place: {e}"))?;
    let _ = fs::remove_dir_all(&staging);
    Ok(manifest)
}

pub fn app_data_log(app: &AppHandle, line: &str) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(dir.join("setup.log")) {
            let _ = writeln!(file, "{line}");
        }
    }
}
