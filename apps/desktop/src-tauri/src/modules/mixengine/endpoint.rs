//! Địa chỉ endpoint của một home MixEngine.
//!
//! Thuần: không đọc đĩa, không mở gì. `MIXENGINE_HOME` nếu có, không thì mặc định của hệ điều
//! hành; từ đó ra `<root>/run`, và từ đó ra đường socket hoặc tên pipe.
//!
//! **`fingerprint` là thứ đi mượn.** Nó không nằm trong `bindings/` — nó là chi tiết nội bộ của
//! `mixengine-platform` (`crates/mixengine-platform/src/windows/ipc.rs`), chép lại ở đây vì chờ
//! MixEngine publish địa chỉ endpoint sẽ chặn cả module này vì hai chục dòng. Test bên dưới ghim
//! giá trị để một lần bên kia đổi cách đặt tên là một test đỏ, không phải một daemon biến mất.

use std::path::{Path, PathBuf};

/// Mọi thứ đứng trước phần nhận dạng daemon nào.
///
/// `any(windows, test)` chứ không phải `windows` trần: chỉ `address()` của Windows đọc nó, nhưng
/// test đọc nó ở cả hai nhánh để ghim hình dạng tên pipe. Thiếu `test` thì bản lib trên Linux mang
/// một hằng số không ai dùng và `clippy -D warnings` của CI đổ vì nó — thứ chỉ CI thấy, vì trên
/// Windows `address()` dùng nó nên nó không bao giờ là dead code ở đây.
#[cfg(any(windows, test))]
pub const PIPE_PREFIX: &str = r"\\.\pipe\mixengine.";

/// Thư mục gốc của MixEngine trên máy này.
pub fn home() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("MIXENGINE_HOME") {
        if !value.is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    default_home()
}

#[cfg(windows)]
fn default_home() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("MixEngine"))
}

#[cfg(target_os = "macos")]
fn default_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|base| PathBuf::from(base).join("Library/Application Support/MixEngine"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn default_home() -> Option<PathBuf> {
    if let Some(base) = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(base).join("mixengine"));
    }
    std::env::var_os("HOME").map(|base| PathBuf::from(base).join(".local/share/mixengine"))
}

/// `<root>/run` — thư mục endpoint sống trong đó, và thứ fingerprint được tính trên.
pub fn run_dir(home: &Path) -> PathBuf {
    home.join("run")
}

/// `<root>/config.toml` — file cấu hình của MixEngine, viết một lần lúc chạy đầu.
pub fn config_file(home: &Path) -> PathBuf {
    home.join("config.toml")
}

/// `[daemon] ipc_path` trong `config.toml` của MixEngine, khi có.
///
/// **Địa chỉ suy ra không phải lúc nào cũng là địa chỉ đúng.** Khoá này để người dùng chuyển daemon
/// sang một endpoint khác — chính file cấu hình của MixEngine nói *"Left unset it picks a socket
/// under run/ … which is the right answer unless that filesystem cannot host one"*. Một máy có đặt
/// nó mà MixDB vẫn dial chỗ suy ra sẽ báo "không có daemon nào trả lời" trong khi daemon đang chạy
/// ngay đó.
///
/// Thuần: nhận nội dung file, không đọc đĩa. Việc đọc là của `transport`.
pub fn ipc_path_in(config: &str) -> Option<String> {
    // `toml::from_str`, không phải `config.parse()`: `FromStr for Value` trong toml 1.x đọc một
    // *giá trị* TOML, còn đây là một *document*, và `[daemon]` không phải một giá trị.
    let parsed: toml::Value = toml::from_str(config).ok()?;
    let path = parsed.get("daemon")?.get("ipc_path")?.as_str()?;
    (!path.is_empty()).then(|| path.to_string())
}

/// Chỗ đứng thay cho một home, ngắn và ổn định.
///
/// FNV-1a, viết ra chứ không kéo thêm crate: đây là một cái tên, không phải một lớp phòng thủ.
/// Nó chỉ cần khác nhau giữa hai home và giống nhau qua hai lần khởi động của cùng một home.
///
/// `any(windows, test)` vì lý do ở [`PIPE_PREFIX`]: unix không có fingerprint nào để tính, nhưng
/// test ghim giá trị của nó trên mọi nền tảng.
#[cfg(any(windows, test))]
pub fn fingerprint(run: &Path) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    run.to_string_lossy()
        .to_lowercase()
        .bytes()
        .fold(OFFSET, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(PRIME)
        })
}

/// Địa chỉ để dial. `sid` chỉ có nghĩa trên Windows.
#[cfg(windows)]
pub fn address(run: &Path, sid: &str) -> String {
    format!("{PIPE_PREFIX}{sid}.{:016x}", fingerprint(run))
}

/// Trên unix socket là một file trong `run/`, và `sid` không có nghĩa gì.
#[cfg(not(windows))]
pub fn address(run: &Path, _sid: &str) -> String {
    run.join("mixengined.sock").to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// FNV-1a 64-bit. Hai giá trị ghim, để một lần đổi thuật toán là một test đỏ chứ không phải
    /// một daemon "không tìm thấy".
    #[test]
    fn the_fingerprint_is_fnv1a_over_the_lowercased_path() {
        assert_eq!(fingerprint(&PathBuf::from("a")), 0xaf63dc4c8601ec8c);
        assert_eq!(fingerprint(&PathBuf::from("")), 0xcbf29ce484222325);
    }

    /// Đường dẫn Windows không phân biệt hoa thường, nên hai cách viết một thư mục phải tới một
    /// daemon. Đây là lý do `to_lowercase` có mặt, và là thứ dễ bị "dọn dẹp" mất nhất.
    #[test]
    fn case_does_not_change_the_fingerprint() {
        let upper = fingerprint(&PathBuf::from(r"C:\Dev\Sandbox\run"));
        let lower = fingerprint(&PathBuf::from(r"c:\dev\sandbox\run"));
        assert_eq!(upper, lower);
    }

    /// Hai home khác nhau phải ra hai pipe khác nhau — đó là toàn bộ việc của nó.
    #[test]
    fn two_homes_do_not_collide() {
        assert_ne!(
            fingerprint(&PathBuf::from("/one/run")),
            fingerprint(&PathBuf::from("/two/run"))
        );
    }

    #[test]
    fn run_dir_hangs_off_the_home() {
        let run = run_dir(&PathBuf::from("/home/x/mixengine"));
        assert_eq!(run.file_name().unwrap(), "run");
        assert!(run.starts_with("/home/x/mixengine"));
    }

    /// In ra 16 chữ số hex thường, đúng `{:016x}` — một số ngắn hơn là một tên pipe khác.
    #[test]
    fn the_address_is_the_socket_on_unix_and_the_pipe_on_windows() {
        let run = PathBuf::from("/home/x/mixengine/run");
        let address = address(&run, "S-1-5-21-1-2-3-1001");
        if cfg!(windows) {
            assert!(address.starts_with(PIPE_PREFIX), "{address}");
            assert!(address.contains("S-1-5-21-1-2-3-1001"), "{address}");
            let hex = address.rsplit('.').next().unwrap();
            assert_eq!(hex.len(), 16, "{address}");
            assert!(hex
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        } else {
            assert!(address.ends_with("mixengined.sock"), "{address}");
        }
    }

    /// Khoá `ipc_path` được đặt thì nó là địa chỉ, chấm hết.
    #[test]
    fn a_configured_ipc_path_is_read() {
        let config = "[log]\nlevel = \"info\"\n\n[daemon]\nipc_path = \"/tmp/elsewhere.sock\"\n";
        assert_eq!(ipc_path_in(config).as_deref(), Some("/tmp/elsewhere.sock"));
    }

    /// File mặc định của MixEngine để mọi khoá ở dạng comment — đó là hình dạng thường gặp nhất, và
    /// nó phải đọc ra "không đặt gì" chứ không phải đọc ra chuỗi ví dụ trong comment.
    #[test]
    fn a_commented_out_ipc_path_is_not_set() {
        let config = "[daemon]\n# ipc_path = \"/example/mixengined.sock\"\n";
        assert_eq!(ipc_path_in(config), None);
    }

    /// Không có mục `daemon`, file rỗng, giá trị rỗng, hay TOML hỏng: cả bốn đều là "không đặt",
    /// không phải lỗi — MixDB rơi về địa chỉ suy ra.
    #[test]
    fn anything_else_leaves_the_address_to_be_worked_out() {
        assert_eq!(ipc_path_in(""), None);
        assert_eq!(ipc_path_in("[log]\nlevel = \"info\"\n"), None);
        assert_eq!(ipc_path_in("[daemon]\nipc_path = \"\"\n"), None);
        assert_eq!(ipc_path_in("[daemon\nbroken"), None);
    }

    #[test]
    fn the_config_file_sits_in_the_home() {
        let file = config_file(&PathBuf::from("/home/x/mixengine"));
        assert_eq!(file.file_name().unwrap(), "config.toml");
    }

    /// `MIXENGINE_HOME` thắng mặc định. Đặt và gỡ trong cùng một test: `std::env` là toàn cục và
    /// cargo chạy test song song, nên không tách ra hai test được.
    #[test]
    fn the_environment_overrides_the_default_home() {
        let before = std::env::var_os("MIXENGINE_HOME");
        std::env::set_var("MIXENGINE_HOME", "/tmp/a-home-of-its-own");
        let answer = home();
        match before {
            Some(value) => std::env::set_var("MIXENGINE_HOME", value),
            None => std::env::remove_var("MIXENGINE_HOME"),
        }
        assert_eq!(answer, Some(PathBuf::from("/tmp/a-home-of-its-own")));
    }
}
