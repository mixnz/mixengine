// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod instance;
mod launch;
mod modules;
mod platform;
mod secrets;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else, while this is still one thread with no children: the URL this was
    // started with, and the credential for it out of the environment. Everything the builder
    // starts — threads, webview helpers, later a shell in a terminal tab — inherits what is left.
    let opening = launch::Opening::from_process();
    let context = tauri::generate_context!();

    // A copy already running takes it and opens the tab. This process is then done, and exiting 0
    // is what tells the program that started it that the connection was handed on.
    if launch::forward(&context.config().identifier, &opening) {
        return;
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                // The plugin's default is 40_000 bytes — too small to hold a session with a real
                // bug in it. 5MB holds a lot of lines before it ever needs to rotate.
                .max_file_size(5_000_000)
                .build(),
        );

    // Self-update: fetching the release, checking its minisign signature and running the installer
    // all happen here, in Rust, which is why the front end needs no network permission for it.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Only the maximized flag is persisted: leave the window maximized and it comes back
        // maximized, restore it down and the next launch uses the default size from the config.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::MAXIMIZED)
                .build(),
        )
        // Registers `mixdb://` with the OS through the installers, and on macOS delivers the URLs
        // the OS opens the app with — see `launch::start` for which systems listen to it.
        .plugin(tauri_plugin_deep_link::init());

    // Each module puts its own state in; the list of commands they add up to is
    // `modules::handler`.
    let builder = launch::register(builder);
    let builder = modules::db::register(builder);
    let builder = modules::mixengine::register(builder);
    let builder = modules::rest::register(builder);
    let builder = modules::terminal::register(builder);

    builder
        .setup(move |app| {
            launch::start(app.handle(), opening);

            /* Housekeeping rather than startup work. A tool download that the app never came back
               from — a crash, a power cut, a force quit — leaves an unpacked server distribution
               in the tools directory, and this is the only thing that ever collects it. On a
               thread of its own and with its answer ignored: the window must not wait behind a
               directory walk and a delete of several hundred megabytes. */
            let handle = app.handle().clone();
            std::thread::spawn(move || modules::db::sweep_downloads(&handle));
            Ok(())
        })
        .invoke_handler(modules::handler())
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                launch::stop(app);
            }
        });
}
