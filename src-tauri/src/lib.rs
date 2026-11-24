//! UT Stems desktop shell: a Tauri window around the local server in `ut_stems/server.py`.
//!
//! The shell starts the processing engine (the Python server) with a session token, waits for
//! the port it prints, and opens a window on `http://127.0.0.1:<port>/#<token>`. The page then
//! talks to the engine directly; the shell only adds what a page cannot do itself: file and
//! folder dialogs, the preferences file, dropped file paths, and stopping the engine on exit.
//!
//! The engine is `engine\ut-stems-engine.exe` next to the executable. When it is missing (the
//! first start of the installed app) the window shows `web/setup.html`, which has the shell
//! download and unpack the engine (see `engine.rs`); a debug build without an engine folder
//! falls back to `python -m ut_stems.server` in the repository.

mod engine;

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const RELEASES_URL: &str = "https://github.com/zeberity123/ut_2_stems/releases/latest";

const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What the shell keeps while it runs.
struct Shell {
    engine: Mutex<Option<Child>>,
    token: String,
    /// The engine's origin once it runs; the window may only navigate there or to its own pages.
    origin: Mutex<Option<String>>,
    installing: Mutex<Option<Arc<AtomicBool>>>,
    /// A newer version found on the release page, until it is installed.
    update: Mutex<Option<tauri_plugin_updater::Update>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    /// Running without the installer: the app cannot replace itself, only point at the download.
    portable: bool,
}

fn portable() -> bool {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| !dir.join("uninstall.exe").is_file())).unwrap_or(true)
}

// ---------------------------------------------------------------- updates from the GitHub release
/// Asks the release page for a newer version. `UT_STEMS_UPDATE_URL` points a test at another page.
async fn find_update(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    if let Ok(url) = std::env::var("UT_STEMS_UPDATE_URL") {
        builder = builder.endpoints(vec![url.parse().map_err(|e| format!("{e}"))?]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo { version: update.version.clone(), current: update.current_version.clone(),
                                    notes: update.body.clone(), portable: portable() };
            *app.state::<Shell>().update.lock().unwrap() = Some(update);
            Ok(Some(info))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    find_update(&app).await
}

/// The update found at start, for a page that loaded after the check ran.
#[tauri::command]
fn pending_update(shell: State<Shell>) -> Option<UpdateInfo> {
    shell.update.lock().unwrap().as_ref().map(|update| UpdateInfo {
        version: update.version.clone(), current: update.current_version.clone(),
        notes: update.body.clone(), portable: portable(),
    })
}

/// Downloads the signed installer and runs it; the installer closes this app and starts the new one.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app.state::<Shell>().update.lock().unwrap().clone().ok_or("No update is waiting.")?;
    if portable() { return Err("This copy runs without the installer; download the new version from the release page.".into()); }
    stop_engine(&app.state::<Shell>());
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("The update could not be installed: {e}"))?;
    app.restart();
}

#[tauri::command]
fn open_release_page(app: AppHandle) -> Result<(), String> {
    app.opener().open_url(RELEASES_URL, None::<&str>).map_err(|e| e.to_string())
}

/// A little after the window is up, look for a newer version and tell the page.
fn check_for_update_later(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(4)).await;
        match find_update(&app).await {
            Ok(Some(info)) => { let _ = app.emit("update-available", info); }
            Ok(None) => {}
            Err(e) => engine::app_data_log(&app, &format!("update check: {e}")),
        }
    });
}

async fn tokio_sleep(duration: Duration) {
    let (sender, receiver) = tauri::async_runtime::channel::<()>(1);
    std::thread::spawn(move || { std::thread::sleep(duration); let _ = sender.blocking_send(()); });
    let mut receiver = receiver;
    let _ = receiver.recv().await;
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Preferences {
    stems: Vec<String>,
    output: String,
    model: String,
    overlap: String,
    auto_title: bool,
    keep_original: bool,
    theme: String,
    format: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { stems: vec![], output: String::new(), model: String::new(), overlap: String::new(),
               auto_title: true, keep_original: true, theme: String::new(), format: String::new() }
    }
}

fn preferences_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("preferences.json"))
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[tauri::command]
fn get_preferences(app: AppHandle) -> Preferences {
    preferences_path(&app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Saves the preferences the page sends, after checking every field.
#[tauri::command]
fn set_preferences(app: AppHandle, values: serde_json::Value) -> Result<(), String> {
    let string = |key: &str, max: usize| values.get(key).and_then(|v| v.as_str()).map(|s| truncate(s, max)).unwrap_or_default();
    let flag = |key: &str| values.get(key).and_then(|v| v.as_bool()).unwrap_or(true);
    let theme = string("theme", 8);
    let format = string("format", 4);
    let next = Preferences {
        stems: values.get("stems").and_then(|v| v.as_array()).map(|list| {
            list.iter().filter_map(|v| v.as_str()).map(|s| truncate(s, 40)).take(12).collect()
        }).unwrap_or_default(),
        output: string("output", 1000),
        model: string("model", 60),
        overlap: string("overlap", 4),
        auto_title: flag("autoTitle"),
        keep_original: flag("keepOriginal"),
        theme: if ["dark", "light", "miku"].contains(&theme.as_str()) { theme } else { String::new() },
        format: if ["auto", "mp3", "wav"].contains(&format.as_str()) { format } else { String::new() },
    };
    let path = preferences_path(&app).ok_or("no settings folder")?;
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn choose_files(app: AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file()
            .add_filter("Audio", &AUDIO_EXTENSIONS)
            .add_filter("All files", &["*"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|file| file.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn choose_folder(app: AppHandle, current: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(dir) = current.filter(|dir| Path::new(dir).is_dir()) { dialog = dialog.set_directory(dir); }
        dialog.blocking_pick_folder()
            .and_then(|folder| folder.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    }).await.unwrap_or_default()
}

// ---------------------------------------------------------------- the engine on first start
#[tauri::command]
fn engine_status() -> engine::Status {
    engine::status()
}

#[tauri::command]
async fn choose_engine_file(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().add_filter("Engine archive", &["7z"]).blocking_pick_file()
            .and_then(|file| file.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    }).await.unwrap_or_default()
}

#[tauri::command]
fn cancel_engine_install(shell: State<Shell>) {
    if let Some(flag) = shell.installing.lock().unwrap().as_ref() { flag.store(true, Ordering::Relaxed); }
}

/// Installs the engine, then starts it and takes the window to it.
#[tauri::command]
async fn install_engine(app: AppHandle, edition: String, file: Option<String>) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let shell = app.state::<Shell>();
        let mut installing = shell.installing.lock().unwrap();
        if installing.is_some() { return Err("An installation is already running.".into()); }
        *installing = Some(cancel.clone());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let file = file.filter(|f| !f.is_empty()).map(PathBuf::from);
        engine::install(&handle, &edition, file, cancel)
    }).await.map_err(|e| e.to_string())?;
    *app.state::<Shell>().installing.lock().unwrap() = None;
    match result {
        Ok(manifest) => {
            engine::app_data_log(&app, &format!("installed engine {} {}", manifest.version, manifest.edition));
            let handle = app.clone();
            std::thread::spawn(move || match start_engine(&handle) {
                Ok(_) => {
                    if let Some(window) = handle.get_webview_window("main") { let _ = window.navigate(app_page("index.html")); }
                }
                Err(detail) => fail(&handle, &detail),
            });
            Ok(())
        }
        Err(detail) => { engine::app_data_log(&app, &format!("install failed: {detail}")); Err(detail) }
    }
}

// ---------------------------------------------------------------- the engine process
enum EngineKind { Installed(PathBuf), Source(PathBuf), Missing }

/// Where the engine is: the installed `engine\ut-stems-engine.exe`, or the repository for a debug build.
fn find_engine() -> EngineKind {
    if let Some(dir) = engine::engine_dir() {
        if dir.join("ut-stems-engine.exe").is_file() { return EngineKind::Installed(dir); }
    }
    if cfg!(debug_assertions) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        if root.join("ut_stems").join("server.py").is_file() { return EngineKind::Source(root); }
    }
    EngineKind::Missing
}

/// One of the shell's own pages (`web/`), bundled in the executable.
fn app_page(name: &str) -> tauri::Url {
    let base = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
    format!("{base}{name}").parse().expect("app page url")
}

#[derive(Serialize, Clone)]
struct EngineInfo { url: String, token: String }

/// Where the engine answers; the page streams audio from there.
#[tauri::command]
fn engine_info(shell: State<Shell>) -> Option<EngineInfo> {
    shell.origin.lock().unwrap().as_ref().map(|origin| EngineInfo { url: origin.clone(), token: shell.token.clone() })
}

#[derive(Serialize, Clone)]
struct Relayed { status: u16, body: String }

/// The page's API calls, carried by the shell: the page lives on the shell's origin and the engine
/// on 127.0.0.1, and going through here means any engine works, old or new, with no cross-origin rules.
#[tauri::command]
async fn engine_fetch(app: AppHandle, path: String, method: String, body: Option<String>) -> Result<Relayed, String> {
    let (origin, token) = {
        let shell = app.state::<Shell>();
        let origin = shell.origin.lock().unwrap().clone().ok_or("The engine is not running.")?;
        (origin, shell.token.clone())
    };
    if path.contains("..") || path.starts_with('/') { return Err("Bad path.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::Agent::config_builder().http_status_as_error(false).build().new_agent();
        let url = format!("{origin}/api/{path}");
        let mut response = if method.eq_ignore_ascii_case("POST") {
            agent.post(&url).header("X-Session-Token", &token).header("Content-Type", "application/json")
                .send(body.unwrap_or_default().as_str())
        } else {
            agent.get(&url).header("X-Session-Token", &token).call()
        }.map_err(|e| format!("The engine did not answer: {e}"))?;
        let status = response.status().as_u16();
        let text = response.body_mut().read_to_string().map_err(|e| e.to_string())?;
        Ok(Relayed { status, body: text })
    }).await.map_err(|e| e.to_string())?
}

/// Starts the engine and returns its port once it prints it.
fn start_engine(app: &AppHandle) -> Result<u16, String> {
    let (mut command, packaged) = match find_engine() {
        EngineKind::Installed(dir) => {
            let mut command = Command::new(dir.join("ut-stems-engine.exe"));
            command.current_dir(&dir);
            // yt-dlp needs a JavaScript runtime for YouTube; the engine folder carries one.
            let path = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = vec![dir.clone()];
            paths.extend(std::env::split_paths(&path));
            if let Ok(joined) = std::env::join_paths(paths) { command.env("PATH", joined); }
            (command, true)
        }
        EngineKind::Source(root) => {
            let python = std::env::var("UT_STEMS_PYTHON").unwrap_or_else(|_| "python".into());
            let mut command = Command::new(python);
            command.args(["-m", "ut_stems.server"]).current_dir(root);
            (command, false)
        }
        EngineKind::Missing => return Err("The processing engine is missing. Start UT Stems again to set it up.".into()),
    };
    let shell = app.state::<Shell>();
    command.env("UT_STEMS_TOKEN", &shell.token).env("PYTHONIOENCODING", "utf-8").env("PYTHONUNBUFFERED", "1")
        .env("UT_STEMS_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(CREATE_NO_WINDOW); }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound && !packaged {
            "Python was not found. Install Python 3.10 or newer and follow the setup steps in README.md.".to_string()
        } else { format!("Could not start the processing engine: {e}") }
    })?;

    let stdout = child.stdout.take().ok_or("no engine output")?;
    let stderr = child.stderr.take().ok_or("no engine output")?;
    let (sender, receiver) = mpsc::channel::<u16>();
    let errors = Arc::new(Mutex::new(String::new()));
    let errors_reader = errors.clone();
    let mut log = app.path().app_config_dir().ok().and_then(|dir| {
        fs::create_dir_all(&dir).ok()?;
        fs::File::create(dir.join("engine.log")).ok()
    });
    std::thread::spawn(move || {
        use std::io::Write;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(file) = log.as_mut() { let _ = writeln!(file, "{line}"); }
            let mut text = errors_reader.lock().unwrap();
            text.push_str(&line); text.push('\n');
            if text.len() > 4000 { let cut = text.len() - 4000; text.drain(..cut); }
        }
    });
    std::thread::spawn(move || {
        // Keep reading after the port line: the engine blocks if the pipe fills up.
        let mut announced = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if announced { continue; }
            if let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(port) = message.get("port").and_then(|p| p.as_u64()) {
                    let _ = sender.send(port as u16);
                    announced = true;
                }
            }
        }
    });
    match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok(port) => {
            *shell.engine.lock().unwrap() = Some(child);
            *shell.origin.lock().unwrap() = Some(format!("http://127.0.0.1:{port}"));
            Ok(port)
        }
        Err(_) => {
            let _ = child.kill();
            let text = errors.lock().unwrap().trim().to_string();
            Err(if text.is_empty() { "The processing engine did not start in time.".into() } else { text })
        }
    }
}

fn stop_engine(shell: &State<Shell>) {
    if let Some(mut child) = shell.engine.lock().unwrap().take() {
        #[cfg(windows)]
        {
            // The engine may have ffmpeg running; take the whole tree down.
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill").args(["/pid", &child.id().to_string(), "/t", "/f"])
                .creation_flags(CREATE_NO_WINDOW).stdout(Stdio::null()).stderr(Stdio::null()).status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

// ---------------------------------------------------------------- the window
/// `window.desktop`, the same bridge the page had under Electron, now over Tauri's IPC.
const BRIDGE: &str = r#"
(() => {
  const T = window.__TAURI__;
  if (!T) return;
  const invoke = T.core.invoke;
  const dropListeners = [];
  window.desktop = {
    tauri: true,
    getPreferences: () => invoke('get_preferences'),
    setPreferences: values => invoke('set_preferences', {values}),
    chooseFiles: () => invoke('choose_files'),
    chooseFolder: current => invoke('choose_folder', {current: current || null}),
    pathForFile: () => '',
    onDrop: listener => { dropListeners.push(listener); },
    engineInfo: () => invoke('engine_info'),
    engineFetch: (path, method, body) => invoke('engine_fetch', {path, method, body: body ?? null}),
    pendingUpdate: () => invoke('pending_update'),
    checkUpdate: () => invoke('check_update'),
    installUpdate: () => invoke('install_update'),
    openReleasePage: () => invoke('open_release_page'),
    onUpdate: listener => { T.event.listen('update-available', event => listener(event.payload)); },
  };
  T.webview.getCurrentWebview().onDragDropEvent(event => { for (const listener of dropListeners) listener(event.payload); });
})();
"#;

fn open_window(app: &AppHandle, url: WebviewUrl) -> tauri::Result<()> {
    let theme = get_preferences(app.clone()).theme;
    let background = match theme.as_str() {
        "light" => tauri::window::Color(0xF4, 0xF2, 0xEE, 255),
        "miku" => tauri::window::Color(0x0A, 0x0B, 0x0B, 255),
        _ => tauri::window::Color(0x0B, 0x0C, 0x10, 255),
    };
    let guard = app.clone();
    WebviewWindowBuilder::new(app, "main", url)
        .title("UT Stems")
        .inner_size(1320.0, 860.0)
        .min_inner_size(390.0, 620.0)
        .background_color(background)
        .visible(false)
        .initialization_script(BRIDGE)
        .on_navigation(move |url| {
            // Only the engine's page and the shell's own pages; nothing from the internet.
            let text = url.as_str();
            text.starts_with("tauri://") || text.starts_with("http://tauri.localhost")
                || guard.state::<Shell>().origin.lock().unwrap().as_ref().map(|origin| text.starts_with(origin)).unwrap_or(false)
        })
        .on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished { let _ = window.show(); }
        })
        .build()?;
    Ok(())
}

fn fail(app: &AppHandle, detail: &str) {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    app.dialog().message(detail).title("UT Stems").kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok).blocking_show();
    app.exit(1);
}

pub fn run() {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Shell { engine: Mutex::new(None), token, origin: Mutex::new(None), installing: Mutex::new(None), update: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_preferences, set_preferences, choose_files, choose_folder,
            engine_status, choose_engine_file, cancel_engine_install, install_engine,
            check_update, pending_update, install_update, open_release_page, engine_info, engine_fetch
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // The engine takes a moment to start; the window appears once a page is ready.
            std::thread::spawn(move || {
                let needs_setup = match find_engine() {
                    EngineKind::Missing => true,
                    EngineKind::Installed(dir) => engine::installed(&dir).map(|m| m.version != engine::ENGINE_VERSION).unwrap_or(true),
                    EngineKind::Source(_) => false,
                };
                let page = if needs_setup {
                    Ok(WebviewUrl::App("setup.html".into()))
                } else {
                    start_engine(&handle).map(|_| WebviewUrl::App("index.html".into()))
                };
                match page {
                    Ok(url) => if let Err(e) = open_window(&handle, url) { fail(&handle, &format!("Could not open the window: {e}")); } else { check_for_update_later(handle.clone()); },
                    Err(detail) => fail(&handle, &detail),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building UT Stems")
        .run(|app, event| {
            if let RunEvent::Exit = event { stop_engine(&app.state::<Shell>()); }
        });
}
