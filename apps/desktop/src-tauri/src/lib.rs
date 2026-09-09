// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod import;
mod instance;
mod launch;
mod modules;
mod platform;
mod relaunch;
mod secrets;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else, while this is still one thread with no children: the URL this was
    // started with, and the credential for it out of the environment. Everything the builder
    // starts — threads, webview helpers, later a shell in a terminal tab — inherits what is left.
    let opening = launch::Opening::from_process();
    // And, in the same breath and for the same reason, whether this copy was started by the copy it
    // is replacing — T106. Read and removed here: left in the environment it would be inherited by
    // every child this process ever starts, the next relaunch's included. `remember` goes with it,
    // because after an update `/proc/self/exe` names the file that was renamed out of the way rather
    // than the one that replaced it — so the only safe moment to ask is before an update can have
    // happened.
    let taking_over = relaunch::taking_over();
    relaunch::remember();
    let context = tauri::generate_context!();

    if taking_over {
        // The predecessor is still winding down, and handing it this start would be handing a start
        // to a window that is closing. Wait for its endpoint instead, then carry on as the only copy
        // — `relaunch::wait_for_predecessor` says what happens when it does not let go.
        relaunch::wait_for_predecessor(&context.config().identifier);
    } else if launch::forward(&context.config().identifier, &opening) {
        // A copy already running takes it and opens the tab. This process is then done, and exiting
        // 0 is what tells the program that started it that the connection was handed on.
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

    // **No updater plugin and no process plugin** — T106. MixEngine's updater is the only one:
    // `update.status | check | decide | apply` on the daemon, one signed feed, one key, one payload.
    // What the process plugin was here for — restarting this window — is `crate::relaunch`, which has
    // to know rather more than that plugin did about which executable is the right one to start.
    #[cfg(desktop)]
    let builder = builder
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
            /* Before anything else: a MixDB user's stores, copied while nothing else can touch
               the directory. `setup` runs inside `build()`, before the event loop that would
               deliver the webview's first `Store.load` — which is the only moment in which that
               copy is race-free. The credentials follow on a thread of their own; the module's
               own documentation is where both halves are argued. */
            import::on_first_launch(app.handle());

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
