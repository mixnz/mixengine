//! Dial endpoint của MixEngine và trả một IO tokio cho `hyper`.
//!
//! **Trên Windows, client có cổng gác của riêng nó.** Namespace pipe của Windows phẳng và toàn
//! máy, tên suy ra được từ một SID công khai cộng một fingerprint mã nguồn bên kia viết rõ, và
//! `CreateNamedPipeW` không cần đặc quyền gì — nên một tài khoản khác giữ được cái tên đó trước
//! khi daemon lên và thu mọi request, kể cả `elevation.*`. Cờ `FILE_FLAG_FIRST_PIPE_INSTANCE` của
//! daemon chỉ chặn nó *nhập* vào pipe đó. Nên ở đây đọc **owner của đối tượng pipe** và cúp máy
//! trước byte đầu tiên nếu không phải tài khoản này. Owner chứ không phải pid: pid tái sử dụng
//! được giữa lúc lấy và lúc tra, còn owner được đóng dấu lúc tạo và không đặt thành một tài khoản
//! mà người tạo không có.
//!
//! Kết nối được mở **trước** lần đọc đó và không byte nào được ghi lên nó cho tới khi owner đã
//! khớp — lý do ở [`dial_once`]. Thứ một pipe của tài khoản lạ thu được vẫn là không có gì.
//!
//! Unix không cần: socket là file trong `run/` của chính tài khoản này, và không tài khoản khác
//! đặt một cái vào đó để bị tìm thấy nhầm được.

use crate::error::AppError;

use super::endpoint;

/// Một kết nối đang mở tới daemon. Không rời module này: `rpc` và `events` bọc nó vào `hyper`.
pub enum Io {
    #[cfg(windows)]
    Pipe(tokio::net::windows::named_pipe::NamedPipeClient),
    #[cfg(not(windows))]
    Socket(tokio::net::UnixStream),
}

/// Địa chỉ endpoint của home trên máy này.
///
/// `config.toml` thắng: `[daemon] ipc_path` là chỗ người dùng chuyển daemon sang một endpoint khác,
/// và một địa chỉ suy ra sẽ dial nhầm chỗ ở đúng những máy đó. Không đọc được file, hay khoá không
/// có, thì suy ra từ `<root>/run` như thường — file này viết một lần lúc chạy đầu và vắng mặt là
/// chuyện bình thường ở một home chưa dùng bao giờ.
pub fn current_address() -> Result<String, AppError> {
    let home = endpoint::home().ok_or_else(|| err!("error.mixengineNoHome"))?;

    if let Ok(config) = std::fs::read_to_string(endpoint::config_file(&home)) {
        if let Some(configured) = endpoint::ipc_path_in(&config) {
            return Ok(configured);
        }
    }

    let run = endpoint::run_dir(&home);
    Ok(endpoint::address(&run, &current_sid()?))
}

/// Mở một kết nối tới daemon của home trên máy này.
pub async fn connect() -> Result<Io, AppError> {
    let address = current_address()?;
    dial(&address).await
}

/// SID của tài khoản đang chạy tiến trình này, dạng `S-1-5-…`.
#[cfg(windows)]
pub fn current_sid() -> Result<String, AppError> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: `token` là chỗ nhận một handle; nó được đóng ở mọi đường ra bên dưới.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(err!(
            "error.mixengineNoSid",
            message = std::io::Error::last_os_error()
        ));
    }

    // Hỏi độ dài trước: `TOKEN_USER` là một struct có đuôi biến thiên (chính cái SID), nên kích
    // thước của nó không phải `size_of`.
    let mut needed: u32 = 0;
    // SAFETY: buffer rỗng với độ dài 0 là cách API này được hỏi độ dài; nó luôn thất bại và điền
    // `needed`.
    unsafe {
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
    }
    let mut buffer = vec![0u8; needed.max(1) as usize];
    // SAFETY: `buffer` dài đúng `needed` byte, là thứ lời gọi trên vừa yêu cầu.
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            needed,
            &mut needed,
        )
    };
    // SAFETY: `token` là handle hợp lệ vừa mở ở trên và không dùng lại sau dòng này.
    unsafe { CloseHandle(token) };
    if read == 0 {
        return Err(err!(
            "error.mixengineNoSid",
            message = std::io::Error::last_os_error()
        ));
    }

    // SAFETY: `buffer` giữ một `TOKEN_USER` API vừa ghi vào, và `User.Sid` trỏ vào chính buffer đó,
    // thứ còn sống tới hết hàm.
    let sid = unsafe { (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid };
    sid_to_string(sid).ok_or_else(|| err!("error.mixengineNoSid", message = "unreadable SID"))
}

/// Trên unix không có SID, và `endpoint::address` không đọc tới nó.
#[cfg(not(windows))]
pub fn current_sid() -> Result<String, AppError> {
    Ok(String::new())
}

/// Một SID thành `S-1-…`. `None` khi Windows từ chối chuyển.
#[cfg(windows)]
fn sid_to_string(sid: windows_sys::Win32::Security::PSID) -> Option<String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;

    let mut text: *mut u16 = std::ptr::null_mut();
    // SAFETY: `sid` là con trỏ hợp lệ do người gọi giữ; `text` là chỗ nhận một chuỗi Windows cấp
    // phát, được `LocalFree` đúng một lần bên dưới.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 || text.is_null() {
        return None;
    }
    // SAFETY: `text` là chuỗi wide kết thúc NUL do Windows cấp phát.
    let len = unsafe {
        let mut len = 0usize;
        while *text.add(len) != 0 {
            len += 1;
        }
        len
    };
    // SAFETY: `len` là số ô trước NUL, nên slice nằm gọn trong vùng đã cấp phát.
    let owner = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
    // SAFETY: `text` do `ConvertSidToStringSidW` cấp phát bằng `LocalAlloc` và không dùng lại sau
    // dòng này.
    unsafe { LocalFree(text as *mut std::ffi::c_void) };
    Some(owner)
}

/// Bao nhiêu lần thử lại khi pipe đang bận, và cách nhau bao lâu.
///
/// **Không phải phòng xa — đo được ngay lần đầu chạy với daemon thật.** Daemon giữ đúng một
/// instance pipe chờ sẵn và chỉ dựng cái thay thế *sau khi* đã nhận một client, nên giữa hai lời
/// gọi liên tiếp có một khe vài micro giây không có instance nào để mở và Windows trả
/// `ERROR_PIPE_BUSY`. Với thiết kế một-kết-nối-một-call ở `rpc.rs`, khe đó bị dính liên tục: call
/// thứ hai ngay sau call thứ nhất là hỏng.
///
/// Hai con số này là của chính MixEngine — `crates/mixengine-platform/src/windows/ipc.rs` dùng
/// đúng chúng ở nửa bên kia, và bình luận ở đó nói rõ chúng rộng rãi hơn khe cần thiết vài bậc độ
/// lớn: không tốn gì khi không có gì hỏng, và một giây là đủ ngắn để một daemon thật sự kẹt vẫn
/// được báo nhanh.
#[cfg(windows)]
const BUSY_ATTEMPTS: u32 = 20;
#[cfg(windows)]
const BUSY_PAUSE: std::time::Duration = std::time::Duration::from_millis(50);

/// Mở kết nối tới một địa chỉ đã biết.
#[cfg(windows)]
pub async fn dial(address: &str) -> Result<Io, AppError> {
    let mut attempts = 0;
    loop {
        match dial_once(address) {
            Ok(client) => return Ok(Io::Pipe(client)),
            Err(Dial::Busy) if attempts < BUSY_ATTEMPTS => {
                attempts += 1;
                tokio::time::sleep(BUSY_PAUSE).await;
            }
            Err(Dial::Busy) | Err(Dial::Absent) => {
                return Err(err!(
                    "error.mixengineUnreachable",
                    endpoint = address,
                    message = "no pipe instance became free"
                ))
            }
            Err(Dial::Stranger(owner)) => {
                return Err(err!(
                    "error.mixenginePipeOwner",
                    endpoint = address,
                    owner = owner
                ))
            }
            Err(Dial::Failed(message)) => {
                return Err(err!(
                    "error.mixengineUnreachable",
                    endpoint = address,
                    message = message
                ))
            }
        }
    }
}

/// Vì sao một lần dial không thành.
///
/// `Busy` tách khỏi mọi thứ khác vì nó là cái duy nhất đáng thử lại: nó nghĩa là daemon vừa nhận
/// một client và chưa kịp dựng instance thay thế, không phải daemon vắng mặt và không phải một
/// tài khoản lạ.
#[cfg(windows)]
enum Dial {
    Busy,
    Absent,
    Stranger(String),
    Failed(String),
}

/// Một lần thử: mở đúng một lần, rồi đọc owner của chính handle vừa mở.
///
/// **Mở một lần, không phải hai.** Bản trước đọc owner bằng `GetNamedSecurityInfoW`, thứ nhận
/// *tên* pipe — và mở một named pipe theo tên **chính là kết nối vào nó như một client**. Nên bước
/// "chỉ đọc thôi" ấy ăn mất một instance, và mỗi lần dial cần hai instance trong khi daemon chỉ
/// giữ một cái chờ sẵn. Hai bước tranh nhau đúng cái instance mà bước kia vừa lấy, retry không gỡ
/// được vì mỗi vòng lại tiêu thêm một cái nữa, và app báo "MixEngine đã cài nhưng chưa chạy" ở một
/// máy daemon đang chạy bình thường.
///
/// `GetSecurityInfo` nhận **handle**, nên nó đọc descriptor của kết nối đã có và không mở gì thêm.
/// Tính chất bảo mật giữ nguyên: kết nối được mở nhưng **không byte nào được ghi** cho tới khi
/// owner đã khớp — thứ một pipe của tài khoản lạ thu được vẫn là không có gì.
#[cfg(windows)]
fn dial_once(address: &str) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, Dial> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY};

    let client = ClientOptions::new().open(address).map_err(|e| {
        match e.raw_os_error().map(|code| code as u32) {
            Some(ERROR_PIPE_BUSY) => Dial::Busy,
            Some(ERROR_FILE_NOT_FOUND) => Dial::Absent,
            _ => Dial::Failed(e.to_string()),
        }
    })?;

    let owner = handle_owner(&client)?;
    let ours = current_sid().map_err(|e| Dial::Failed(e.to_string()))?;
    if owner != ours {
        // Thả kết nối trước khi trả lỗi: không có gì đã được ghi lên nó, và không có gì sẽ được.
        drop(client);
        return Err(Dial::Stranger(owner));
    }
    Ok(client)
}

// `advapi32!GetSecurityInfo` — bản nhận handle của `GetNamedSecurityInfoW`.
//
// Khai tay vì `windows-sys 0.59` không lộ hàm này ra (nó chỉ có `GetNamedSecurityInfoW` bản nhận
// tên, và hai `GetSecurityInfo` của WinInet và WFP không liên quan gì). Ba tham số `ppsidGroup`,
// `ppDacl` và `ppSacl` khai là con trỏ thuần vì chỗ này luôn truyền NULL cho chúng — ABI của một
// con trỏ không đổi theo thứ nó trỏ tới.
#[cfg(windows)]
#[link(name = "advapi32")]
extern "system" {
    fn GetSecurityInfo(
        handle: windows_sys::Win32::Foundation::HANDLE,
        object_type: i32,
        security_info: u32,
        owner: *mut windows_sys::Win32::Security::PSID,
        group: *mut core::ffi::c_void,
        dacl: *mut core::ffi::c_void,
        sacl: *mut core::ffi::c_void,
        descriptor: *mut windows_sys::Win32::Security::PSECURITY_DESCRIPTOR,
    ) -> u32;
}

/// SID của chủ sở hữu một kết nối pipe đang mở.
#[cfg(windows)]
fn handle_owner(
    client: &tokio::net::windows::named_pipe::NamedPipeClient,
) -> Result<String, Dial> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::SE_KERNEL_OBJECT;
    use windows_sys::Win32::Security::{OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID};

    let mut sid: PSID = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();

    // SAFETY: `client` còn sống suốt lời gọi nên handle của nó hợp lệ; ba tham số NULL là cách API
    // này được bảo "không cần phần đó"; `descriptor` được `LocalFree` đúng một lần bên dưới.
    let status = unsafe {
        GetSecurityInfo(
            client.as_raw_handle(),
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut sid,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(Dial::Failed(format!("Windows error {status}")));
    }

    let owner = sid_to_string(sid);
    // SAFETY: `descriptor` do `GetSecurityInfo` cấp phát và không dùng lại sau dòng này.
    unsafe { LocalFree(descriptor) };
    owner.ok_or_else(|| Dial::Failed("unreadable owner SID".to_string()))
}

/// Trên unix, socket là file trong `run/` của chính tài khoản này — không có cổng gác nào phải
/// dựng thêm.
#[cfg(not(windows))]
pub async fn dial(address: &str) -> Result<Io, AppError> {
    let stream = tokio::net::UnixStream::connect(address).await.map_err(|e| {
        err!(
            "error.mixengineUnreachable",
            endpoint = address,
            message = e
        )
    })?;
    Ok(Io::Socket(stream))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Không có MixEngine trên máy CI, nên cái test được là *câu trả lời khi không có gì ở đó*:
    /// một `AppError` đọc được, không phải một panic và không phải một treo.
    ///
    /// Dial thẳng một địa chỉ bịa thay vì đi qua `MIXENGINE_HOME`: biến môi trường là toàn cục và
    /// cargo chạy test song song, nên một test đặt nó là một test làm hỏng test khác.
    #[tokio::test]
    async fn an_absent_daemon_is_an_error_and_not_a_panic() {
        let address = if cfg!(windows) {
            r"\\.\pipe\mixengine.S-1-5-21-0-0-0-0.0123456789abcdef"
        } else {
            "/nowhere/a-home-that-is-not-there/run/mixengined.sock"
        };
        let error = dial(address)
            .await
            .err()
            .expect("an absent daemon must not connect");
        assert_eq!(error.code, "error.mixengineUnreachable", "{error:?}");
    }

    /// Câu lỗi phải mang theo địa chỉ đã thử, vì triệu chứng của một fingerprint lệch là
    /// "không tìm thấy daemon" và cách duy nhất so bằng mắt là nhìn thấy cái tên.
    #[tokio::test]
    async fn the_error_names_the_address_it_tried() {
        let address = if cfg!(windows) {
            r"\\.\pipe\mixengine.S-1-5-21-0-0-0-0.fedcba9876543210"
        } else {
            "/nowhere/else/run/mixengined.sock"
        };
        let error = dial(address).await.err().unwrap();
        assert_eq!(error.params.get("endpoint"), Some(&address.to_string()));
    }

    /// Địa chỉ của máy này dựng được, và có hình dạng đúng nền tảng. Không cần daemon nào chạy.
    #[test]
    fn this_machine_has_an_address() {
        let Ok(address) = current_address() else {
            // Một máy không có `HOME` lẫn `LOCALAPPDATA` là hợp lệ để bỏ qua, không phải để đỏ.
            return;
        };
        if cfg!(windows) {
            assert!(address.starts_with(endpoint::PIPE_PREFIX), "{address}");
        } else {
            assert!(address.ends_with("mixengined.sock"), "{address}");
        }
    }
}
