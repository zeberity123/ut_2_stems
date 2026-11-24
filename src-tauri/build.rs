// The pages may call only these commands (see capabilities/default.json).
const COMMANDS: &[&str] = &[
    "get_preferences", "set_preferences", "choose_files", "choose_folder",
    "engine_status", "choose_engine_file", "cancel_engine_install", "install_engine",
    "check_update", "pending_update", "install_update", "open_release_page", "engine_info",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
