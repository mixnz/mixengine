use std::path::PathBuf;

use super::models::LocalShell;

/// Danh sách shell mở được trên máy này, thứ tự là thứ tự gợi ý — cái đầu tiên là mặc định.
pub fn detect() -> Vec<LocalShell> {
    let mut found = Vec::new();
    #[cfg(windows)]
    detect_windows(&mut found);
    #[cfg(not(windows))]
    detect_unix(&mut found);
    found
}

/// Shell mặc định của máy, cho một `TerminalTarget::Local { shell: None, .. }` — kèm tham số của
/// nó, vì `--login` thuộc về "shell mặc định" chẳng kém gì đường dẫn.
fn default_shell() -> (String, Vec<String>) {
    detect()
        .into_iter()
        .next()
        .map(|shell| (shell.path, shell.args))
        .unwrap_or_else(|| {
            let path = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
            (path.to_string(), Vec::new())
        })
}

/// Thêm một mục nếu file có thật và đường dẫn đó chưa nằm trong danh sách.
fn push_if_present(found: &mut Vec<LocalShell>, name: &str, path: PathBuf, args: Vec<String>) {
    if !path.is_file() {
        return;
    }
    let path = path.display().to_string();
    if found.iter().any(|shell| shell.path == path) {
        return;
    }
    found.push(LocalShell {
        name: name.to_string(),
        path,
        args,
    });
}

/// Tham số để shell mở ra là một *login* shell.
///
/// Đây là chỗ `.bash_profile`, `.zprofile`, `.profile` được đọc — và chỉ ở đó. Một bash chạy trên
/// pty là interactive nhưng không login, nên PATH, alias và biến người dùng đặt trong những file
/// ấy đơn giản là không tồn tại trong phiên; `ssh-add -l` không thấy agent nào là triệu chứng hay
/// gặp nhất. Mọi terminal thật đều mở login shell: shortcut "Git Bash" chạy `bash --login -i`,
/// Terminal.app trên macOS cũng vậy.
///
/// Theo tên chứ không cho tất: `-l` là cờ của bash, zsh và fish, còn `sh` trên Linux thường là
/// dash và không nhận nó. `-i` thì không cần — có pty thật, shell tự biết mình là interactive.
fn login_args(name: &str) -> Vec<String> {
    match name {
        "bash" | "git-bash" | "zsh" | "fish" => vec!["-l".to_string()],
        _ => Vec::new(),
    }
}

/// Tìm một chương trình trong `PATH`. Dùng cho `pwsh` và `wsl.exe`, hai thứ không có đường dẫn
/// cố định.
#[cfg(windows)]
fn on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn detect_windows(found: &mut Vec<LocalShell>) {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let system32 = PathBuf::from(&system_root).join("System32");

    push_if_present(
        found,
        "powershell",
        system32
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe"),
        Vec::new(),
    );
    if let Some(pwsh) = on_path("pwsh.exe") {
        push_if_present(found, "pwsh", pwsh, Vec::new());
    }
    push_if_present(found, "cmd", system32.join("cmd.exe"), Vec::new());

    for base in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
        if let Ok(dir) = std::env::var(base) {
            let git_bash = PathBuf::from(&dir).join("Git").join("bin").join("bash.exe");
            push_if_present(found, "git-bash", git_bash, login_args("git-bash"));
        }
    }

    if let Some(wsl) = on_path("wsl.exe") {
        for distro in wsl_distros() {
            found.push(LocalShell {
                name: format!("wsl:{distro}"),
                path: wsl.display().to_string(),
                args: vec!["-d".to_string(), distro],
            });
        }
    }
}

/// Các bản phân phối WSL đã cài. Máy không có WSL thì `wsl.exe` thất bại và danh sách rỗng —
/// không phải lỗi để báo cho ai.
#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    /* Không có cửa sổ console loé lên — `crate::platform::hide_console` giải thích tại sao, và là
       nơi duy nhất cả app đặt cờ đó. */
    let mut command = std::process::Command::new("wsl.exe");
    command.args(["-l", "-q"]);
    let output = match crate::platform::hide_console(&mut command).output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    parse_wsl_list(&output.stdout)
}

/// `wsl.exe -l -q` in UTF-16LE, có BOM, xuống dòng CRLF, và khi không có bản nào thì in một câu
/// tiếng Anh thay vì in rỗng.
///
/// Không gắn `#[cfg(windows)]` để test của nó chạy được ở mọi nơi — cái nó đọc là byte, không
/// phải là hệ điều hành.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_wsl_list(bytes: &[u8]) -> Vec<String> {
    // `as_chunks` thay cho `chunks_exact(2)`: cùng một việc, cùng một phần dư bị bỏ, nhưng kích
    // thước nằm trong kiểu nên mỗi phần tử đã là `[u8; 2]` — không phải cắt lát rồi đánh chỉ số
    // lại. clippy 1.98 yêu cầu dạng này (`chunks_exact_to_as_chunks`).
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|line| {
            line.trim_matches(|c: char| c == '\u{feff}' || c.is_whitespace())
                .to_string()
        })
        .filter(|line| !line.is_empty() && !line.starts_with("Windows Subsystem for Linux"))
        .collect()
}

#[cfg(not(windows))]
fn detect_unix(found: &mut Vec<LocalShell>) {
    if let Ok(shell) = std::env::var("SHELL") {
        let path = PathBuf::from(&shell);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh")
            .to_string();
        push_if_present(found, &name, path, login_args(&name));
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let path = PathBuf::from(candidate);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh")
            .to_string();
        push_if_present(found, &name, path, login_args(&name));
    }
}

use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::models::{Output, OutputSink, TerminalSize};
use super::state::Session;
use super::stream::{coalesce, QUEUE_DEPTH};
use crate::error::AppError;

/// Đệm đọc một lần từ pty. Nhỏ hơn khung IPC nhiều — bộ gom lô mới là chỗ quyết định khung to
/// bằng nào.
const READ_BUFFER: usize = 8 * 1024;

/// Đợi bao lâu cho byte cuối cùng ra khỏi pty sau khi tiến trình con đã chết, trước khi buông
/// master. Đầu đọc đang rút liên tục nên đây là chỗ nghỉ, không phải chỗ chờ.
const EXIT_DRAIN: Duration = Duration::from_millis(100);

/// Trần cho việc đợi đầu đọc thấy EOF. `ClosePseudoConsole` của Windows có tiếng là thỉnh thoảng
/// không trả về, và cái tệ nhất nó được phép làm là nuốt vài byte cuối — không phải là giấu luôn
/// việc phiên đã kết thúc.
const EXIT_TIMEOUT: Duration = Duration::from_secs(2);

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Mở một shell trên máy này và trả về tay cầm của nó.
///
/// Ba luồng chạy song song sau khi hàm này trả về: một thread đọc pty, một thread ghi vào pty, một
/// thread đợi tiến trình con. Đường ra chỉ có một, và thứ tự trên đó là thứ tự thật — xem chỗ
/// `exit_rx` được await bên dưới.
pub fn spawn(
    shell: Option<String>,
    args: Vec<String>,
    cwd: Option<String>,
    size: TerminalSize,
    out: OutputSink,
) -> Result<Session, AppError> {
    /* Không có shell nào được chọn thì lấy cả mục mặc định, đường dẫn lẫn tham số — `args` đi vào
       đây là của một shell mà lời gọi không nêu tên, nên nó rỗng. */
    let (program, args) = match shell {
        Some(path) => (path, args),
        None => default_shell(),
    };

    /* Một đường dẫn tuyệt đối không còn tồn tại — Git bị gỡ, bản WSL bị xoá — đáng được nói thẳng
       thay vì để pty trả về một lỗi hệ điều hành không ai đọc. Tên trần như `cmd.exe` thì bỏ qua:
       nó được tra trong `PATH`, không phải trên đĩa. */
    if (program.contains('/') || program.contains('\\')) && !Path::new(&program).is_file() {
        return Err(err!("error.terminalShellNotFound", path = program));
    }

    let pair = native_pty_system()
        .openpty(pty_size(size))
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;

    let mut command = CommandBuilder::new(&program);
    for arg in &args {
        command.arg(arg);
    }
    if let Some(dir) = cwd.as_deref().filter(|dir| Path::new(dir).is_dir()) {
        command.cwd(dir);
    }
    // Cái xterm.js vẽ được. Không đặt thì shell trên Unix coi như terminal câm và tắt cả màu.
    command.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    // Đầu slave phải buông ngay, nếu không đầu đọc sẽ không bao giờ thấy EOF.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    /* `Option` chứ không phải chính nó: kết thúc phiên là *buông* master, mà buông một thứ nằm
       trong `Arc` thì phải nhấc nó ra khỏi đó. Xem chỗ `take()` bên dưới. */
    let master = Arc::new(StdMutex::new(Some(pair.master)));
    let killer = child.clone_killer();

    let (raw_tx, raw_rx) = mpsc::channel::<Vec<u8>>(QUEUE_DEPTH);
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<TerminalSize>();
    let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
    let kill = CancellationToken::new();

    // Đọc pty. Đây là chỗ duy nhất giữ `raw_tx`, nên thread này kết thúc là bộ gom lô biết hết
    // byte — và chỉ khi đó `Exit` mới được phát.
    std::thread::spawn(move || {
        let mut buffer = vec![0u8; READ_BUFFER];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if raw_tx.blocking_send(buffer[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Ghi cái người dùng gõ. Kết thúc khi `Session` bị bỏ, vì lúc đó `input_tx` không còn ai giữ.
    std::thread::spawn(move || {
        while let Some(bytes) = input_rx.blocking_recv() {
            if writer.write_all(&bytes).is_err() || writer.flush().is_err() {
                break;
            }
        }
    });

    // Đổi kích thước. Phiên đã kết thúc thì `master` là `None` và không còn gì để đổi.
    std::thread::spawn({
        let master = master.clone();
        move || {
            while let Some(size) = resize_rx.blocking_recv() {
                if let Some(master) = master.lock().unwrap().as_ref() {
                    let _ = master.resize(pty_size(size));
                }
            }
        }
    });

    // Đợi tiến trình con, rồi đưa mã thoát cho đường ra — không tự phát, vì lúc này đệm có thể
    // còn byte chưa đẩy.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        let _ = exit_tx.send(code);
    });

    // Đóng tab, hoặc app thoát.
    tokio::spawn({
        let kill = kill.clone();
        async move {
            kill.cancelled().await;
            let mut killer = killer;
            let _ = killer.kill();
        }
    });

    /* Một đường ra, một thứ tự: hết byte → hết đệm → mới tới `Exit`.

       Đầu đọc không tự thấy EOF khi shell chết. Trên Windows, ống ra là của ConPTY và ConPTY sống
       chừng nào master còn sống — mà master thì phiên giữ để còn đổi kích thước. Nên tiến trình
       con chết mà không ai buông master là đầu đọc nằm im mãi, `coalesce` không bao giờ trả về, và
       `Exit` không bao giờ được phát: người dùng gõ `exit` rồi nhìn một màn hình đứng im mà không
       ai nói cho biết. (Trên Unix thì đọc master sau khi con chết trả về EIO nên chuyện này không
       lộ ra, và buông master ở đó cũng vô hại: đầu đọc cầm một bản `dup` của riêng nó.)

       Vậy nên: đợi con chết → nghỉ một nhịp cho byte cuối ra khỏi ống → buông master → giờ mới hết
       byte, hết đệm, rồi tới `Exit`. */
    tokio::spawn({
        let out = out.clone();
        let data = out.clone();
        async move {
            let mut drain = tokio::spawn(coalesce(raw_rx, move |chunk| data(Output::Data(chunk))));
            let code = exit_rx.await.ok().flatten();
            tokio::time::sleep(EXIT_DRAIN).await;
            // Trên thread blocking: đóng ConPTY là một lời gọi hệ điều hành có thể nằm lại một lúc.
            let _ = tokio::task::spawn_blocking(move || {
                master.lock().unwrap().take();
            })
            .await;
            if tokio::time::timeout(EXIT_TIMEOUT, &mut drain).await.is_err() {
                drain.abort();
            }
            out(Output::Exit { code, message: None });
        }
    });

    Ok(Session {
        input: input_tx,
        resize: resize_tx,
        kill,
    })
}

#[cfg(test)]
mod tests {
    use super::login_args;
    use super::parse_wsl_list;
    use super::spawn;
    use crate::modules::terminal::models::{Output, OutputSink, TerminalSize};
    use std::sync::{Arc, Mutex};

    /// Cái đắt nhất mà một phiên không-login đánh mất là `.bash_profile`, và cùng với nó là
    /// `GIT_SSH`, PATH và alias người dùng đặt ở đó.
    #[test]
    fn opens_bash_as_a_login_shell() {
        assert_eq!(login_args("bash"), vec!["-l".to_string()]);
        assert_eq!(login_args("git-bash"), vec!["-l".to_string()]);
    }

    /// `.zprofile` là chỗ macOS đặt PATH, và Terminal.app đọc nó vì nó mở login shell.
    #[test]
    fn opens_zsh_as_a_login_shell() {
        assert_eq!(login_args("zsh"), vec!["-l".to_string()]);
    }

    /// `sh` trên Linux thường là dash, và dash không có `-l` — mở kiểu ấy là phiên chết ngay từ
    /// dòng đầu. `cmd` với `powershell` thì không có khái niệm login shell.
    #[test]
    fn leaves_alone_a_shell_that_has_no_such_flag() {
        assert!(login_args("sh").is_empty());
        assert!(login_args("cmd").is_empty());
        assert!(login_args("powershell").is_empty());
    }

    /// `wsl.exe -l -q` in ra UTF-16LE với CRLF — dựng lại đúng thế để test.
    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect()
    }

    #[test]
    fn reads_one_name_per_line() {
        let bytes = utf16le("Ubuntu\r\nDebian\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string(), "Debian".to_string()]);
    }

    /// Tên có khoảng trắng là chuyện thường — `Ubuntu 22.04` không được cắt làm đôi.
    #[test]
    fn keeps_a_name_with_a_space_in_it() {
        let bytes = utf16le("Ubuntu 22.04\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu 22.04".to_string()]);
    }

    #[test]
    fn drops_the_bom_and_the_blank_lines() {
        let bytes = utf16le("\u{feff}Ubuntu\r\n\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string()]);
    }

    /// Máy không có bản phân phối nào thì `wsl.exe` in một câu tiếng Anh chứ không in danh sách
    /// rỗng. Câu đó không phải tên distro.
    #[test]
    fn is_not_fooled_by_the_no_distributions_message() {
        let bytes = utf16le("Windows Subsystem for Linux has no installed distributions.\r\n");
        assert!(parse_wsl_list(&bytes).is_empty());
    }

    /// Đường mà máy chủ của bảng "phiên đã kết thúc" đi: shell tự thoát, không ai giết nó.
    ///
    /// Chạy `exit 3` thay vì gõ `exit` vào một shell tương tác — PowerShell hỏi vị trí con trỏ
    /// bằng `ESC[6n` rồi đợi trả lời, mà ở đây không có xterm nào để trả lời. Cái đang được thử
    /// là "tiến trình con chết thì có `Exit` không", không phải dấu nhắc của một shell cụ thể.
    #[tokio::test]
    async fn a_shell_that_ends_by_itself_says_so() {
        let seen: Arc<Mutex<Vec<Output>>> = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        let sink: OutputSink = Arc::new(move |output| handle.lock().unwrap().push(output));

        let (shell, args) = if cfg!(windows) {
            ("cmd.exe", vec!["/c".to_string(), "exit".to_string(), "3".to_string()])
        } else {
            ("/bin/sh", vec!["-c".to_string(), "exit 3".to_string()])
        };
        let session = spawn(
            Some(shell.to_string()),
            args,
            None,
            TerminalSize { cols: 80, rows: 24 },
            sink,
        )
        .expect("shell phải mở được");

        /* ConPTY mở ra bằng cách hỏi vị trí con trỏ (`ESC[6n`) và *đợi* câu trả lời trước khi cho
           tiến trình con chạy — trong app thì xterm trả lời, ở đây thì không ai. Trả lời hộ nó. */
        session.input.send(b"\x1b[1;1R".to_vec()).unwrap();

        /* Có hạn, và hạn ngắn hơn `EXIT_TIMEOUT`: cái lưới an toàn ấy vẫn phát `Exit` kể cả khi
           đầu đọc không bao giờ thấy EOF, nên một test chỉ hỏi "cuối cùng có `Exit` không" sẽ
           xanh ngay cả khi lỗi quay lại. Điều đang được giữ là phiên báo *ngay*. */
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        loop {
            if matches!(
                seen.lock().unwrap().last(),
                Some(Output::Exit { code: Some(3), .. })
            ) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "hết hạn mà chưa có Exit(3), thấy: {:?}",
                seen.lock().unwrap(),
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        // Tay cầm vẫn còn — không có ai giết nó, và nó vẫn phải báo.
        drop(session);
    }

    /// Mở shell mặc định của máy rồi bỏ tay cầm. Phiên phải chết và phải báo `Exit` — đây là
    /// đường mà "đóng tab" đi, nên nó không được im lặng.
    #[tokio::test]
    async fn dropping_the_session_ends_it_and_says_so() {
        let seen: Arc<Mutex<Vec<Output>>> = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        let sink: OutputSink = Arc::new(move |output| handle.lock().unwrap().push(output));

        let session = spawn(None, Vec::new(), None, TerminalSize { cols: 80, rows: 24 }, sink)
            .expect("shell mặc định phải mở được");
        drop(session);

        // Giết tiến trình, đọc hết pty, đẩy nốt đệm rồi mới phát Exit — vài trăm ms là dư.
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

        let seen = seen.lock().unwrap();
        assert!(
            matches!(seen.last(), Some(Output::Exit { .. })),
            "khung cuối cùng phải là Exit, thấy: {seen:?}",
        );
    }
}
