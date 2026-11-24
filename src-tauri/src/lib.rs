//! UT Stems desktop shell: a Tauri window around the local server in `ut_stems/server.py`.
//!
//! The shell starts the processing engine (the Python server) with a session token, waits for
//! the port it prints, and opens a window on `http://127.0.0.1:<port>/#<token>`. The page then
//! talks to the engine directly; the shell only adds what a page cannot do itself: file and
//! folder dialogs, the preferences file, dropped file paths, and stopping the engine on exit.
//!
//! From a source checkout (a debug build) the engine is `python -m ut_stems.server` in the
//! repository; in the installed app it is `engine\ut-stems-engine.exe` next to the executable.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The running engine, killed when the app exits.
struct Engine(Mutex<Option<Child>>);

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
}

impl Default for Preferences {
    fn default() -> Self {
        Self { stems: vec![], output: String::new(), model: String::new(), overlap: String::new(),
               auto_title: true, keep_original: true, theme: String::new() }
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

/// Saves the preferences the page sends, after checking every field, the way the Electron shell did.
#[tauri::command]
fn set_preferences(app: AppHandle, values: serde_json::Value) -> Result<(), String> {
    let string = |key: &str, max: usize| values.get(key).and_then(|v| v.as_str()).map(|s| truncate(s, max)).unwrap_or_default();
    let flag = |key: &str| values.get(key).and_then(|v| v.as_bool()).unwrap_or(true);
    let theme = string("theme", 8);
    let next = Preferences {
        stems: values.get("stems").and_then(|v| v.as_array()).map(|list| {
            list.iter().filter_map(|v| v.as_str()).map(|s| truncate(s, 40)).take(12).collect()
        }).unwrap_or_default(),
        output: string("output", 1000),
        model: string("model", 60),
        overlap: string("overlap", 4),
        auto_title: flag("autoTitle"),
        keep_original: flag("keepOriginal"),
        theme: if theme == "dark" || theme == "light" { theme } else { String::new() },
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

/// Where the engine is: the installed `engine\ut-stems-engine.exe`, or the repository for a debug build.
fn engine_command(app: &AppHandle) -> Result<(Command, bool), String> {
    let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    let mut candidates = vec![];
    if let Some(dir) = &exe_dir { candidates.push(dir.join("engine").join("ut-stems-engine.exe")); }
    if let Ok(dir) = app.path().resource_dir() { candidates.push(dir.join("engine").join("ut-stems-engine.exe")); }
    if let Some(engine) = candidates.into_iter().find(|path| path.is_file()) {
        let mut command = Command::new(&engine);
        command.current_dir(engine.parent().unwrap());
        return Ok((command, true));
    }
    if cfg!(debug_assertions) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        if root.join("ut_stems").join("server.py").is_file() {
            let python = std::env::var("UT_STEMS_PYTHON").unwrap_or_else(|_| "python".into());
            let mut command = Command::new(python);
            command.args(["-m", "ut_stems.server"]).current_dir(root);
            return Ok((command, false));
        }
    }
    Err("The processing engine is missing (engine\\ut-stems-engine.exe). Reinstall UT Stems.".into())
}

/// Starts the engine and returns its port once it prints it.
fn start_engine(app: &AppHandle, token: &str) -> Result<(Child, u16), String> {
    let (mut command, packaged) = engine_command(app)?;
    command.env("UT_STEMS_TOKEN", token).env("PYTHONIOENCODING", "utf-8").env("PYTHONUNBUFFERED", "1")
        .env("UT_STEMS_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if packaged {
        // yt-dlp needs a JavaScript runtime for YouTube; the installed app carries one in the engine folder.
        if let Some(dir) = command.get_current_dir().map(Path::to_path_buf) {
            let path = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = vec![dir];
            paths.extend(std::env::split_paths(&path));
            if let Ok(joined) = std::env::join_paths(paths) { command.env("PATH", joined); }
        }
    }
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; command.creation_flags(CREATE_NO_WINDOW); }
    let mut child = command.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound && !packaged {
            "Python was not found. Install Python 3.10 or newer and follow the setup steps in README.md.".to_string()
        } else { format!("Could not start the processing engine: {e}") }
    })?;

    let stdout = child.stdout.take().ok_or("no engine output")?;
    let stderr = child.stderr.take().ok_or("no engine output")?;
    let (sender, receiver) = mpsc::channel::<Result<u16, String>>();
    let errors = std::sync::Arc::new(Mutex::new(String::new()));
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
                    let _ = sender.send(Ok(port as u16));
                    announced = true;
                }
            }
        }
    });
    match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(port)) => Ok((child, port)),
        _ => {
            let _ = child.kill();
            let text = errors.lock().unwrap().trim().to_string();
            Err(if text.is_empty() { "The processing engine did not start in time.".into() } else { text })
        }
    }
}

fn stop_engine(engine: &State<Engine>) {
    if let Some(mut child) = engine.0.lock().unwrap().take() {
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
  };
  T.webview.getCurrentWebview().onDragDropEvent(event => { for (const listener of dropListeners) listener(event.payload); });
})();
"#;

fn open_window(app: &AppHandle, port: u16, token: &str) -> tauri::Result<()> {
    let url: tauri::Url = format!("http://127.0.0.1:{port}/#{token}").parse().expect("engine url");
    let origin = format!("http://127.0.0.1:{port}");
    let theme = get_preferences(app.clone()).theme;
    let background = if theme == "light" { tauri::window::Color(0xF4, 0xF2, 0xEE, 255) } else { tauri::window::Color(0x0B, 0x0C, 0x10, 255) };
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("UT Stems")
        .inner_size(1320.0, 860.0)
        .min_inner_size(390.0, 620.0)
        .background_color(background)
        .visible(false)
        .initialization_script(BRIDGE)
        .on_navigation(move |url| url.as_str().starts_with(&origin))
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Engine(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_preferences, set_preferences, choose_files, choose_folder])
        .setup(|app| {
            let handle = app.handle().clone();
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            // The engine takes a moment to start; the window appears once it is ready.
            std::thread::spawn(move || match start_engine(&handle, &token) {
                Ok((child, port)) => {
                    *handle.state::<Engine>().0.lock().unwrap() = Some(child);
                    if let Err(e) = open_window(&handle, port, &token) { fail(&handle, &format!("Could not open the window: {e}")); }
                }
                Err(detail) => fail(&handle, &detail),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building UT Stems")
        .run(|app, event| {
            if let RunEvent::Exit = event { stop_engine(&app.state::<Engine>()); }
        });
}
