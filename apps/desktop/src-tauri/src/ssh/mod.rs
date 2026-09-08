use crate::error::AppError;
use crate::platform::in_background;
use crate::secrets::Redacted;
use russh::client::{self};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// How to prove who you are to the SSH server.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

/// Redacted by hand, for the reason `ConnectionConfig`'s is. This one covers more than itself:
/// `SshConfig` derives its `Debug` from here, and so does `TerminalTarget` from that — so the
/// terminal's copy of the problem is fixed by fixing the leaf rather than each of the three.
impl std::fmt::Debug for SshAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password { .. } => f
                .debug_struct("Password")
                .field("password", &Redacted)
                .finish(),
            Self::PrivateKey { key_path, passphrase } => f
                .debug_struct("PrivateKey")
                // The path is not a secret and is the whole of what is worth knowing when a key
                // will not load — which is the one time anybody prints this.
                .field("key_path", key_path)
                .field("passphrase", &passphrase.as_ref().map(|_| Redacted))
                .finish(),
        }
    }
}

/// The server to tunnel through. Config of this layer rather than of whatever is at the far end,
/// which is why it lives here and not with any one module's models: a terminal opened over SSH
/// wants the same four fields a tunnelled database connection does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(10);

/// Nhịp russh gửi một gói giữ phiên khi đường đang im.
///
/// 15 giây: đủ ngắn để đi trước idle timeout của một NAT gia đình (thường 300 giây) và trước
/// `ClientAliveInterval` của sshd; đủ dài để một phiên để không cả ngày cũng chỉ tốn vài trăm byte.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Số lần liên tiếp không được trả lời trước khi russh kết thúc phiên — cũng là mặc định của nó.
/// Nhân với nhịp trên, một đường chết bị phát hiện trong khoảng 45 giây.
const KEEPALIVE_MAX: usize = 3;

/// Khoảng nghỉ tối thiểu sau một lần xác thực hỏng.
///
/// Không có nó, một pool đang cố mở kết nối trong lúc mạng chết sẽ bắn hàng chục lần xác thực mỗi
/// phút vào một sshd có `MaxAuthTries` — và có thể có fail2ban.
const RETRY_COOLDOWN: Duration = Duration::from_secs(3);

/// Nhịp watcher kiểm tra phiên khi mọi thứ đang ổn.
const WATCH_IDLE: Duration = Duration::from_secs(15);

/// Nhịp ngay sau lần hỏng đầu tiên, trước khi giãn dần.
const WATCH_MIN: Duration = Duration::from_secs(5);

/// Trần của backoff: máy chủ SSH thật sự không tới được thì thử một phút một lần, không hơn.
const WATCH_MAX: Duration = Duration::from_secs(60);

/// Vòng accept chờ chừng này sau một lỗi không thuộc về riêng một kết nối — hết file descriptor,
/// hết bộ nhớ tạm. Đủ dài để một lỗi lặp lại không đốt hết một lõi, đủ ngắn để truy vấn tiếp theo
/// qua tunnel không kịp nhận ra.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// Bấy nhiêu lần hỏng liên tiếp thì mới phiền tới người dùng — khoảng hai giây cổng không nhận
/// được gì. Ngắn hơn thì một cơn hết file descriptor thoáng qua cũng nháy banner.
const ACCEPT_ALARM: u32 = 20;

/// Lỗi `accept` thuộc về đúng một kết nối vừa hỏng, không phải về cái cổng đang nghe.
///
/// Kết nối bị huỷ giữa lúc bắt tay là chuyện thường của một pool: Windows trả `WSAECONNRESET` hoặc
/// `WSAECONNABORTED`, Unix trả `ECONNABORTED`, và `EINTR` là một signal cắt ngang lời gọi. Lần
/// `accept` sau vẫn nhận được như không có gì.
///
/// Xếp nhầm không tốn gì ngoài một nhịp `ACCEPT_RETRY`: từ đây trở đi cả hai nhánh đều thử lại, và
/// cái danh sách này chỉ quyết định có chờ và có đếm về phía banner hay không.
fn is_transient_accept(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::ConnectionAborted
            | ErrorKind::ConnectionReset
            | ErrorKind::ConnectionRefused
            | ErrorKind::Interrupted
    )
}

/// Nhịp chờ kế tiếp của watcher.
///
/// So sánh bằng `==` chứ không phải `>=`: `WATCH_MAX` lớn hơn `WATCH_IDLE`, nên một điều kiện
/// "lớn hơn hoặc bằng nhịp nghỉ" sẽ kéo cả nhịp trần về `WATCH_MIN` và biến backoff thành một vòng
/// lặp. `WATCH_IDLE` chỉ được đặt khi thành công, nên so bằng là chính xác.
fn next_backoff(current: Duration, ok: bool) -> Duration {
    if ok {
        return WATCH_IDLE;
    }
    if current == WATCH_IDLE {
        return WATCH_MIN;
    }
    (current * 2).min(WATCH_MAX)
}

/// How much a channel may have in flight before the peer has to wait for the receiver to catch up.
///
/// russh defaults to 2MB, which is less than a distant link holds in flight: at 25MB/s and 100ms
/// of round trip there is 2.5MB in the air at any moment, so the sender spends part of its time
/// stopped, waiting for credit that is still travelling back. A dump is the one thing in the app
/// that runs long enough for that to be worth the memory.
const WINDOW_SIZE: u32 = 8 * 1024 * 1024;

/// The buffer each direction of a forwarded connection copies through.
///
/// 8KB — what this used to read into — is a syscall and a wakeup per 8KB, which caps a forward
/// well below what the link can carry. The cost of the larger buffer is that every connection held
/// open through the tunnel keeps two of these, so it is sized to be past the point of diminishing
/// returns rather than as large as possible.
const BRIDGE_BUFFER: usize = 128 * 1024;

/// Where the fingerprint of every SSH server MixDB has connected to is remembered, keyed by
/// `host:port`. Its own file rather than OpenSSH's `~/.ssh/known_hosts`: that file is the user's,
/// written in a format with its own hashing and wildcard rules, and an app that only ever appends
/// to it has no business rewriting it.
fn known_hosts_file(app_data: &Path) -> PathBuf {
    app_data.join("known_hosts.json")
}

fn load_known_hosts(path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Serialises the read-modify-write above.
///
/// Two tunnels opening at once to two servers neither of which has been seen before both read the
/// file, both add their own entry, and whichever writes second drops the other's. A lock private
/// to this process is enough: the file is MixDB's own, and nothing outside it writes there.
static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());

fn remember_host(path: &Path, endpoint: &str, fingerprint: &str) -> Result<(), AppError> {
    // The guarded value is `()`, so a poisoned lock has nothing left half-written to protect —
    // panicking here would turn one panic elsewhere into every later connection failing.
    let _guard = KNOWN_HOSTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let mut known = load_known_hosts(path);
    known.insert(endpoint.to_string(), fingerprint.to_string());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| err!("error.cannotCreateDirectory", path = parent.display(), message = e))?;
    }
    let text = serde_json::to_string_pretty(&known)
        .map_err(|e| err!("error.cannotSaveKnownHost", message = e))?;

    /* Written beside the real file and renamed over it, rather than into it. `std::fs::write`
       truncates first, so a crash — or a full disk — between the truncate and the last byte leaves
       an empty or half-written file, `load_known_hosts` reads that as "nothing known", and every
       server the user has ever connected to is silently accepted afresh on the next run. That is
       the one failure this file exists to prevent. A rename either happened or did not. */
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|e| err!("error.cannotSaveKnownHost", message = e))?;
    std::fs::rename(&temp, path).map_err(|e| {
        // Nothing was replaced, so the leftover is only clutter — but it is clutter next to a file
        // a worried user may well come and read.
        let _ = std::fs::remove_file(&temp);
        err!("error.cannotSaveKnownHost", message = e)
    })
}

/// Whether this key is the one this address answered with last time.
///
/// Split out of the handler because it is all blocking file work and the handler is `async`: the
/// caller runs it off the runtime. Never returns "no" — a key that does not match is an error with
/// something to say, and saying it is the only reason this is not a plain `bool`.
fn verify_host(path: &Path, endpoint: &str, fingerprint: &str) -> Result<(), AppError> {
    match load_known_hosts(path).get(endpoint) {
        Some(known) if known == fingerprint => Ok(()),
        Some(known) => Err(err!(
            "error.sshHostKeyChanged",
            endpoint = endpoint,
            fingerprint = fingerprint,
            known = known,
            file = path.display(),
        )),
        // First sight of this server: take it on faith, and hold it to that key from now on.
        None => remember_host(path, endpoint, fingerprint),
    }
}

/// Chuyện đang xảy ra với một tunnel, cho ai muốn nói lại với người dùng.
///
/// `ssh/` không biết gì về Tauri — nó nhận một callback và gọi, còn việc biến thành sự kiện của
/// cửa sổ là việc của `commands/mod.rs`.
pub enum TunnelEvent {
    Reconnecting,
    Reconnected,
    Failed(AppError),
}

pub type TunnelNotify = Arc<dyn Fn(TunnelEvent) + Send + Sync>;

/// Phiên SSH đang dùng, và dấu vết của lần mở gần nhất.
struct SessionSlot {
    /// `None` nghĩa là chưa có phiên nào, hoặc lần mở lại gần nhất thất bại.
    handle: Option<Arc<client::Handle<TunnelHandler>>>,
    /// Khi phiên hiện tại được mở. Một phiên trẻ hơn `RETRY_COOLDOWN` không bị vứt đi vì một lần
    /// mở channel hỏng: máy chủ từ chối forward thẳng thừng (`PermitOpen`, `AllowTcpForwarding no`)
    /// thì mọi lần đều hỏng, và xác thực lại cho từng kết nối bị từ chối chỉ tổ nện máy chủ.
    opened_at: Option<Instant>,
    /// Lần thất bại gần nhất, để không nện máy chủ SSH bằng một chuỗi xác thực hỏng.
    failed_at: Option<Instant>,
}

/// Tất cả những gì cần để mở lại phiên, dùng chung bởi vòng accept, watcher, và mọi task bridge.
struct TunnelInner {
    ssh: SshConfig,
    remote_host: String,
    remote_port: u16,
    app_data: PathBuf,
    notify: TunnelNotify,
    session: AsyncMutex<SessionSlot>,
}

impl TunnelInner {
    /// Phiên đang dùng, mở lại nếu phiên cũ đã chết.
    ///
    /// Khoá giữ suốt lần xác thực là cố ý: pool mở năm kết nối cùng lúc thì cả năm dừng lại sau
    /// **một** lần `authenticate`, không phải năm lần. Cái giá là khi đang mở lại, mọi kết nối mới
    /// qua tunnel này chờ tối đa `CONNECT_TIMEOUT` (10 giây) — nằm gọn trong `acquire_timeout` 30
    /// giây mặc định của sqlx.
    async fn session(&self) -> Result<Arc<client::Handle<TunnelHandler>>, AppError> {
        let mut slot = self.session.lock().await;
        if let Some(handle) = slot.handle.as_ref().filter(|handle| !handle.is_closed()) {
            return Ok(Arc::clone(handle));
        }
        if let Some(at) = slot.failed_at {
            if at.elapsed() < RETRY_COOLDOWN {
                return Err(err!("error.sshUnavailable"));
            }
        }

        (self.notify)(TunnelEvent::Reconnecting);
        match authenticate(&self.ssh, &self.app_data).await {
            Ok(session) => {
                let handle = Arc::new(session);
                *slot = SessionSlot {
                    handle: Some(Arc::clone(&handle)),
                    opened_at: Some(Instant::now()),
                    failed_at: None,
                };
                (self.notify)(TunnelEvent::Reconnected);
                Ok(handle)
            }
            Err(e) => {
                *slot = SessionSlot {
                    handle: None,
                    opened_at: None,
                    failed_at: Some(Instant::now()),
                };
                (self.notify)(TunnelEvent::Failed(e.clone()));
                Err(e)
            }
        }
    }

    /// Vứt phiên hiện tại đi, để lần `session()` kế tiếp mở phiên mới.
    ///
    /// `is_closed()` là đường phát hiện nhanh, không phải đường duy nhất: một phiên vừa chết có thể
    /// chưa kịp báo, và cái hỏng đầu tiên là `channel_open_direct_tcpip`. Cooldown ở đây chặn
    /// trường hợp ngược lại — phiên còn sống nhưng máy chủ từ chối forward, khi đó mở phiên mới
    /// không giúp được gì và không được phép lặp lại cho từng kết nối.
    async fn forget_session(&self) {
        let mut slot = self.session.lock().await;
        if slot.opened_at.is_none_or(|at| at.elapsed() >= RETRY_COOLDOWN) {
            slot.handle = None;
            slot.opened_at = None;
        }
    }
}

/// A running port forward, torn down as soon as this is dropped.
///
/// The tasks cannot be held as bare `JoinHandle`s: dropping one of those detaches the task rather
/// than stopping it. Every connection attempt that failed *after* the tunnel came up — a mistyped
/// database password, say — would then leave an authenticated SSH session and a bound local port
/// running for the life of the process, with nothing left holding a handle to either.
pub struct Tunnel {
    inner: Arc<TunnelInner>,
    accept: JoinHandle<()>,
    watch: JoinHandle<()>,
}

impl Tunnel {
    /// Một tay cầm rẻ tới cùng phiên, để người gọi mở lại được mà không phải giữ cái khoá mà
    /// `Tunnel` đang nằm sau — xác thực mất tới 10 giây, và bản đồ connection không được khoá lâu
    /// như thế. Xem `commands::tunnel_reconnect`.
    pub fn session_handle(&self) -> TunnelSession {
        TunnelSession(Arc::clone(&self.inner))
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.accept.abort();
        self.watch.abort();
    }
}

/// Mở lại phiên theo yêu cầu của người dùng, không chờ hết nhịp backoff.
pub struct TunnelSession(Arc<TunnelInner>);

impl TunnelSession {
    pub async fn reconnect(&self) -> Result<(), AppError> {
        // Xoá dấu thất bại trước, nếu không lần gọi ngay sau một lần hỏng sẽ rơi vào cooldown và
        // nút *Thử lại* không làm gì cả.
        {
            let mut slot = self.0.session.lock().await;
            slot.failed_at = None;
        }
        self.0.session().await.map(|_| ())
    }
}

/// Checks the server's key against what MixDB saw the last time it connected to this address.
///
/// Trust on first use: a server never seen before is accepted and its fingerprint written down,
/// and from then on a *different* key is refused. That is the half of host-key checking worth
/// having here — the first connection is taken on faith either way, but the tunnel can no longer
/// be quietly stood in front of afterwards, which is the whole reason a database is reached
/// through SSH rather than over the open network.
struct TunnelHandler {
    /// `host:port`, which is what a fingerprint is remembered under.
    endpoint: String,
    known_hosts: PathBuf,
    /// Why the key was refused, kept for the caller: `check_server_key` may only say yes or no,
    /// and "no" reaches the user as russh's own unspecific error otherwise.
    refused: Arc<Mutex<Option<AppError>>>,
}

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string();
        let path = self.known_hosts.clone();
        let endpoint = self.endpoint.clone();

        /* Off the runtime: this reads a file and, on a first connection, writes one, and the
           thread it would do that on is the one driving the handshake. A home directory on a
           network share is where that stops being theoretical. */
        match in_background(move || verify_host(&path, &endpoint, &fingerprint)).await {
            Ok(()) => Ok(true),
            Err(e) => {
                *self.refused.lock().unwrap() = Some(e);
                Ok(false)
            }
        }
    }
}

async fn authenticate(
    ssh: &SshConfig,
    app_data: &Path,
) -> Result<client::Handle<TunnelHandler>, AppError> {
    match timeout(CONNECT_TIMEOUT, authenticate_inner(ssh, app_data)).await {
        Ok(result) => result,
        Err(_) => Err(err!(
            "error.sshTimeout",
            host = &ssh.host,
            port = ssh.port,
            seconds = CONNECT_TIMEOUT.as_secs(),
        )),
    }
}

async fn authenticate_inner(
    ssh: &SshConfig,
    app_data: &Path,
) -> Result<client::Handle<TunnelHandler>, AppError> {
    let config = Arc::new(client::Config {
        // Nagle's algorithm holds a small write back waiting for more to go with it, which is
        // exactly wrong under a forward: what is being delayed is usually a database's reply, and
        // nothing else is coming until the client has seen it. russh leaves it on by default.
        nodelay: true,
        window_size: WINDOW_SIZE,
        // russh mặc định không gửi gì cả (`keepalive_interval: None`), nên một phiên để không sẽ
        // bị NAT hoặc sshd bỏ rơi mà không ai biết — và `is_closed()` không bao giờ thành `true`.
        // Bật lên vừa giữ phiên sống, vừa là thứ duy nhất phát hiện được đường đã chết.
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX,
        // `inactivity_timeout` giữ nguyên `None`: nó đóng phiên khi không có traffic, đúng thứ
        // đang muốn tránh.
        ..client::Config::default()
    });
    let refused: Arc<Mutex<Option<AppError>>> = Arc::new(Mutex::new(None));
    let handler = TunnelHandler {
        endpoint: format!("{}:{}", ssh.host, ssh.port),
        known_hosts: known_hosts_file(app_data),
        refused: Arc::clone(&refused),
    };
    let mut session = match client::connect(config, (ssh.host.as_str(), ssh.port), handler).await {
        Ok(session) => session,
        // A refused key fails the handshake, and what russh reports for that says nothing about
        // the key — the reason the handler wrote down is the one worth showing.
        Err(e) => {
            let refused = refused.lock().unwrap().take();
            return Err(refused.unwrap_or_else(|| err!("error.sshConnectFailed", message = e)));
        }
    };

    let authenticated = match &ssh.auth {
        SshAuth::Password { password } => session
            .authenticate_password(&ssh.username, password)
            .await
            .map_err(|e| err!("error.sshAuthFailed", message = e))?,
        SshAuth::PrivateKey { key_path, passphrase } => {
            let key_path = key_path.clone();
            let passphrase = passphrase.clone();
            /* Both halves belong off the runtime. Reading is disk; decoding an encrypted key is
               bcrypt-pbkdf, which is slow on purpose — a key written with OpenSSH's default rounds
               takes long enough to be felt, and every other command would wait behind it. */
            let key_pair = in_background(move || {
                let key_data = std::fs::read_to_string(&key_path)
                    .map_err(|e| err!("error.cannotReadPrivateKey", message = e))?;
                russh::keys::decode_secret_key(&key_data, passphrase.as_deref())
                    .map_err(|e| err!("error.invalidPrivateKey", message = e))
            })
            .await?;
            session
                .authenticate_publickey(
                    &ssh.username,
                    // `None` maps to the legacy `ssh-rsa` (SHA-1) signature for
                    // RSA keys, which most modern servers (OpenSSH >= 8.8)
                    // reject outright. Request SHA-256 instead; russh ignores
                    // this for non-RSA key types.
                    russh::keys::PrivateKeyWithHashAlg::new(
                        Arc::new(key_pair),
                        Some(russh::keys::HashAlg::Sha256),
                    ),
                )
                .await
                .map_err(|e| err!("error.sshAuthFailed", message = e))?
        }
    };

    match authenticated {
        russh::client::AuthResult::Success => Ok(session),
        russh::client::AuthResult::Failure {
            remaining_methods,
            partial_success,
        } => {
            // The most common cause of a "rejected" auth isn't a wrong
            // password, it's that the tried method isn't one the server
            // offers at all (e.g. server only allows keyboard-interactive
            // or publickey). Surfacing what it *does* accept saves a lot of
            // guessing.
            let accepted: Vec<&str> = remaining_methods.iter().map(<&str>::from).collect();
            Err(err!(
                "error.sshAuthRejected",
                partialSuccess = partial_success,
                methods = accepted.join(", "),
            ))
        }
    }
}

/// Authenticates against the SSH server without opening any port forward.
/// Used by the UI's "Test tunnel" action to validate credentials/connectivity
/// independently of the database connection itself.
pub async fn test_connection(ssh: &SshConfig, app_data: &Path) -> Result<(), AppError> {
    let session = authenticate(ssh, app_data).await?;
    let _ = session.disconnect(russh::Disconnect::ByApplication, "", "English").await;
    Ok(())
}

/// Opens an SSH connection and a direct-tcpip channel to (remote_host, remote_port),
/// bridged to a freshly bound local TCP port. Returns the local port to connect to
/// instead of the real database host, plus the {@link Tunnel} keeping the bridge alive —
/// dropping that is what closes the forward again.
pub async fn open_tunnel(
    ssh: &SshConfig,
    remote_host: &str,
    remote_port: u16,
    app_data: &Path,
    notify: TunnelNotify,
) -> Result<(u16, Tunnel), AppError> {
    // Lần xác thực đầu đứng ngoài `session()`: nó phải hỏng ra ngoài cho `connect_db` thấy, và
    // không có gì để báo "đang kết nối lại" khi chưa từng có kết nối nào.
    let session = authenticate(ssh, app_data).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?
        .port();

    let inner = Arc::new(TunnelInner {
        ssh: ssh.clone(),
        remote_host: remote_host.to_string(),
        remote_port,
        app_data: app_data.to_path_buf(),
        notify,
        session: AsyncMutex::new(SessionSlot {
            handle: Some(Arc::new(session)),
            opened_at: Some(Instant::now()),
            failed_at: None,
        }),
    });

    let accept: JoinHandle<()> = tokio::spawn({
        let inner = Arc::clone(&inner);
        async move {
            /* Bao nhiêu lỗi `accept` liên tiếp không thuộc về một kết nối lẻ. Đếm để biết lúc nào
               nên nói, và để biết lúc nào nói lại rằng đã ổn. */
            let mut failures: u32 = 0;
            loop {
                let (local_stream, _) = match listener.accept().await {
                    Ok(pair) => {
                        // Nhận lại được sau khi đã kêu thì phải rút lời: banner đang nói tunnel
                        // hỏng, mà nó vừa nhận một kết nối.
                        if failures >= ACCEPT_ALARM {
                            (inner.notify)(TunnelEvent::Reconnected);
                        }
                        failures = 0;
                        pair
                    }
                    // Một kết nối lẻ chết giữa lúc bắt tay. Cái tiếp theo vẫn tới, nên không chờ
                    // và không đếm.
                    Err(e) if is_transient_accept(&e) => continue,
                    Err(e) => {
                        failures += 1;
                        /* Trước đây chỗ này `break` ngay lần đầu, và tunnel chết trong im lặng:
                           watcher chỉ nhìn phiên SSH, thấy phiên còn sống nên không banner nào
                           hiện, và mọi truy vấn sau đó chỉ trả về `connectionLost`. Nói đúng một
                           lần, ở đúng lần thứ `ACCEPT_ALARM`. */
                        if failures == ACCEPT_ALARM {
                            (inner.notify)(TunnelEvent::Failed(
                                err!("error.tunnelAcceptFailed", message = e),
                            ));
                        }
                        /* Và vẫn thử tiếp, như watcher vẫn thử tiếp: hết file descriptor là
                           chuyện qua đi, còn bỏ vòng lặp ở đây thì không còn gì mở lại được cổng
                           — nó chỉ được bind một lần, trong `open_tunnel`. Vòng lặp sống đúng
                           bằng đời của `Tunnel`, mà `Drop` của nó abort task này. */
                        tokio::time::sleep(ACCEPT_RETRY).await;
                        continue;
                    }
                };
                // A DB connection pool (or multiple in-flight queries) can hold several physical
                // connections open at once, so each accepted local connection gets its own
                // bridging task instead of being handled inline — an inline loop would block
                // `accept()` for as long as that one connection stays open, starving every other
                // connection the pool tries to establish through this tunnel.
                let inner = Arc::clone(&inner);
                tokio::spawn(async move {
                    bridge_connection(&inner, local_stream).await;
                });
            }
        }
    });

    // Chỉ mở lại khi có ai đó gõ cửa thì banner chỉ hiện sau khi người dùng đã bấm vào một thứ và
    // chờ. Watcher làm tab tự lành: máy tính ngủ dậy, đường mạng về, và banner đã chuyển sang "đã
    // kết nối lại" trước khi người dùng chạm vào gì.
    let watch: JoinHandle<()> = tokio::spawn({
        let inner = Arc::clone(&inner);
        async move {
            let mut wait = WATCH_IDLE;
            loop {
                tokio::time::sleep(wait).await;
                let dead = {
                    let slot = inner.session.lock().await;
                    slot.handle.as_ref().is_none_or(|handle| handle.is_closed())
                };
                if !dead {
                    wait = WATCH_IDLE;
                    continue;
                }
                wait = next_backoff(wait, inner.session().await.is_ok());
            }
        }
    });

    Ok((local_port, Tunnel { inner, accept, watch }))
}

async fn bridge_connection(inner: &Arc<TunnelInner>, mut local_stream: tokio::net::TcpStream) {
    let channel = match open_channel(inner).await {
        Some(channel) => channel,
        None => {
            // Phiên trông còn sống mà không phải. Vứt nó đi rồi thử đúng một lần nữa với phiên
            // mới, trước khi buông socket local.
            inner.forget_session().await;
            match open_channel(inner).await {
                Some(channel) => channel,
                // Either the SSH server rejected/never answered the forward request (e.g. it
                // can't reach remote_host:remote_port itself, or AllowTcpForwarding/PermitOpen
                // blocks it). Drop this local connection so the DB client sees a closed socket
                // instead of hanging indefinitely.
                None => return,
            }
        }
    };

    // The same reasoning as the SSH socket's `nodelay`, for the hop between the app and whatever
    // the local end of the forward is: a driver's query has nothing following it, so there is
    // never anything to be gained by holding it back.
    let _ = local_stream.set_nodelay(true);

    // Both directions at once, rather than a `select!` that could only ever be carrying one of
    // them: a dump is one long download whose acknowledgements travel the other way, and a restore
    // is the same in reverse. Copying them in turn made each wait on the other.
    //
    // The copy also ends the way the hand-written loop did — one side reaching EOF shuts the other
    // side's write half down, which is the SSH channel's EOF, and the transfer in the other
    // direction is allowed to finish before the channel is dropped.
    let mut remote_stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional_with_sizes(
        &mut local_stream,
        &mut remote_stream,
        BRIDGE_BUFFER,
        BRIDGE_BUFFER,
    )
    .await;
}

/// Một lần thử mở channel forward trên phiên hiện tại. `None` là hỏng, không nói vì sao — người
/// gọi chỉ có hai lựa chọn, thử lại hoặc buông.
async fn open_channel(inner: &Arc<TunnelInner>) -> Option<russh::Channel<client::Msg>> {
    let session = inner.session().await.ok()?;
    let opened = timeout(
        CHANNEL_OPEN_TIMEOUT,
        session.channel_open_direct_tcpip(
            inner.remote_host.clone(),
            inner.remote_port as u32,
            "127.0.0.1",
            0,
        ),
    )
    .await;
    match opened {
        Ok(Ok(channel)) => Some(channel),
        Ok(Err(_)) | Err(_) => None,
    }
}

/// Một shell đang chạy trên máy chủ, cộng phiên SSH giữ nó sống.
///
/// Phiên đi cùng channel chứ không ở lại trong hàm: `client::Handle` là thứ chạy vòng lặp sự kiện
/// của russh, và bỏ nó là channel chết theo trong vài mili giây. Người gọi phải giữ cả hai sống
/// đúng bằng nhau, nên hàm này trao cả hai cùng lúc.
pub struct RemoteShell {
    session: client::Handle<TunnelHandler>,
    read: russh::ChannelReadHalf,
    write: russh::ChannelWriteHalf<client::Msg>,
}

impl RemoteShell {
    /// Tách làm hai nửa cho hai task: một đọc, một ghi. Phiên SSH ở lại với nửa ghi — đó là nửa
    /// sống đúng bằng phiên terminal, còn nửa đọc kết thúc ngay khi đầu xa im.
    pub fn split(self) -> (russh::ChannelReadHalf, RemoteWriter) {
        (
            self.read,
            RemoteWriter {
                session: self.session,
                write: self.write,
            },
        )
    }
}

/// Nửa ghi của một phiên shell: byte gõ, đổi kích thước, và đóng.
///
/// Giữ luôn `client::Handle` vì cả ba đường ra vào của một phiên đều đi qua đây — nên bỏ cái này
/// là đóng cả kết nối, và không có đường nào để sót một phiên SSH đang mở.
pub struct RemoteWriter {
    session: client::Handle<TunnelHandler>,
    write: russh::ChannelWriteHalf<client::Msg>,
}

impl RemoteWriter {
    /// Byte người dùng gõ. Hỏng là đường đã đứt — người gọi dừng, không thử lại.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<(), AppError> {
        self.write
            .data_bytes(bytes)
            .await
            .map_err(|e| err!("error.sshShellFailed", message = e))
    }

    /// Khung đổi kích thước. `pix_width`/`pix_height` để 0: đầu xa dùng cols/rows, và số pixel của
    /// một webview không nói gì về ô chữ của nó.
    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.write
            .window_change(cols as u32, rows as u32, 0, 0)
            .await
            .map_err(|e| err!("error.sshShellFailed", message = e))
    }

    /// Đóng cho gọn: hết đầu vào, đóng channel, rồi chào máy chủ. Bỏ `RemoteWriter` cũng đóng
    /// được, nhưng bằng cách rơi handle mà không nói lời nào — và một sshd đang ghi log thì đáng
    /// được nói.
    pub async fn close(self) {
        let _ = self.write.eof().await;
        let _ = self.write.close().await;
        let _ = self
            .session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    }
}

/// Mở một shell trên máy chủ: kết nối, xác thực, xin pty, xin shell.
///
/// Dùng chung `authenticate()` với tunnel — cùng kiểm vân tay theo `known_hosts.json`, cùng hai
/// cách xác thực — nhưng **kết nối là riêng**: vòng đời một terminal là vòng đời cái tab, còn vòng
/// đời một tunnel là vòng đời một kết nối database. Gộp lại thì đóng tab terminal làm rụng kết nối
/// database.
pub async fn open_shell(
    ssh: &SshConfig,
    app_data: &Path,
    cols: u16,
    rows: u16,
) -> Result<RemoteShell, AppError> {
    let session = authenticate(ssh, app_data).await?;

    let channel = match timeout(CHANNEL_OPEN_TIMEOUT, session.channel_open_session()).await {
        Ok(Ok(channel)) => channel,
        Ok(Err(e)) => return Err(err!("error.sshShellFailed", message = e)),
        Err(_) => {
            return Err(err!(
                "error.sshTimeout",
                host = &ssh.host,
                port = ssh.port,
                seconds = CHANNEL_OPEN_TIMEOUT.as_secs(),
            ))
        }
    };

    /* `want_reply: true` cho cả hai: một máy chủ từ chối cấp pty phải nói ra, và câu trả lời của
       nó tới dưới dạng `ChannelMsg::Success`/`Failure` trong hàng đợi của channel. Bộ đọc bỏ qua
       cả hai — cái nó chờ là byte — nhưng một `Failure` bao giờ cũng kéo theo channel đóng, và
       phiên kết thúc ngay thay vì treo trên một terminal câm. */
    channel
        .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| err!("error.sshShellFailed", message = e))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| err!("error.sshShellFailed", message = e))?;

    let (read, write) = channel.split();
    Ok(RemoteShell {
        session,
        read,
        write,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_transient_accept, known_hosts_file, load_known_hosts, next_backoff, remember_host};
    use super::verify_host;
    use super::{ACCEPT_ALARM, ACCEPT_RETRY, WATCH_IDLE, WATCH_MAX, WATCH_MIN};
    use std::io::{Error, ErrorKind};
    use std::time::Duration;

    /// What the handler reads and writes between connections. The handshake around it needs a real
    /// SSH server to exercise; this is the part that decides whether a key is the one seen before.
    #[test]
    fn a_remembered_host_is_read_back_and_can_be_replaced() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        let file = known_hosts_file(&dir);

        // Nothing remembered yet — a first connection has nothing to check against.
        assert!(load_known_hosts(&file).is_empty());

        remember_host(&file, "db.example:22", "SHA256:aaa").unwrap();
        remember_host(&file, "other.example:2222", "SHA256:bbb").unwrap();
        let known = load_known_hosts(&file);
        assert_eq!(known.get("db.example:22").map(String::as_str), Some("SHA256:aaa"));
        assert_eq!(known.len(), 2);

        // Each host stands on its own: accepting a rebuilt server's new key leaves the others be.
        remember_host(&file, "db.example:22", "SHA256:ccc").unwrap();
        let known = load_known_hosts(&file);
        assert_eq!(known.get("db.example:22").map(String::as_str), Some("SHA256:ccc"));
        assert_eq!(known.get("other.example:2222").map(String::as_str), Some("SHA256:bbb"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Two first connections at once. Without a lock around the read-modify-write both threads
    /// read the same file, both add their own host, and whichever writes last is the only one
    /// remembered — so the other server is a stranger again next time, and TOFU accepts whatever
    /// answers for it.
    #[test]
    fn hosts_remembered_at_the_same_time_all_survive() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        let file = known_hosts_file(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::thread::scope(|scope| {
            for n in 0..8 {
                let file = &file;
                scope.spawn(move || {
                    for round in 0..8 {
                        let endpoint = format!("host{n}.example:22");
                        remember_host(file, &endpoint, &format!("SHA256:{n}-{round}")).unwrap();
                    }
                });
            }
        });

        let known = load_known_hosts(&file);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(known.len(), 8, "an entry was lost to a concurrent write");
    }

    /// The three answers TOFU has, from the one place that decides them.
    #[test]
    fn a_changed_key_is_refused_and_the_known_one_is_not() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        let file = known_hosts_file(&dir);

        // Never seen: accepted, and written down.
        verify_host(&file, "db.example:22", "SHA256:aaa").unwrap();
        assert_eq!(
            load_known_hosts(&file).get("db.example:22").map(String::as_str),
            Some("SHA256:aaa"),
        );

        // Seen, same key: accepted again.
        verify_host(&file, "db.example:22", "SHA256:aaa").unwrap();

        // Seen, different key: refused, and the fingerprint on file is left alone — accepting the
        // new one is the user's decision, taken by deleting the entry, not ours.
        assert!(verify_host(&file, "db.example:22", "SHA256:zzz").is_err());
        assert_eq!(
            load_known_hosts(&file).get("db.example:22").map(String::as_str),
            Some("SHA256:aaa"),
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A file that has been corrupted (or written by a future version) reads as "nothing known"
    /// rather than failing every SSH connection the app makes.
    #[test]
    fn an_unreadable_store_is_treated_as_empty() {
        let dir = std::env::temp_dir().join(format!("mixdb-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = known_hosts_file(&dir);
        std::fs::write(&file, "not json").unwrap();

        let known = load_known_hosts(&file);
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(known.is_empty());
    }

    /// Nhịp của watcher. Thành công thì về nhịp nghỉ; hỏng lần đầu xuống nhịp nhanh nhất rồi giãn
    /// dần gấp đôi tới trần — và ở lại trần thay vì quay về nhịp nhanh.
    #[test]
    fn the_watcher_backs_off_while_the_tunnel_stays_down() {
        // Đang ổn thì mỗi nhịp là WATCH_IDLE, dù trước đó vừa hỏng ở nhịp nào.
        assert_eq!(next_backoff(WATCH_IDLE, true), WATCH_IDLE);
        assert_eq!(next_backoff(WATCH_MIN, true), WATCH_IDLE);
        assert_eq!(next_backoff(WATCH_MAX, true), WATCH_IDLE);

        // Lần hỏng đầu tiên — nhịp hiện tại đang là nhịp nghỉ — thử lại nhanh.
        assert_eq!(next_backoff(WATCH_IDLE, false), WATCH_MIN);

        // Rồi gấp đôi.
        assert_eq!(next_backoff(WATCH_MIN, false), Duration::from_secs(10));
        assert_eq!(next_backoff(Duration::from_secs(10), false), Duration::from_secs(20));

        // Chạm trần thì dừng ở trần, không vượt và không quay về WATCH_MIN.
        assert_eq!(next_backoff(Duration::from_secs(40), false), WATCH_MAX);
        assert_eq!(next_backoff(WATCH_MAX, false), WATCH_MAX);
    }

    /// Cái vòng accept quyết định trên: lỗi nào là của một kết nối lẻ, lỗi nào là của cổng.
    ///
    /// Kiểm bằng chính mã lỗi của hệ điều hành chứ không bằng `ErrorKind` viết tay, vì điều đang
    /// được khẳng định là *mã của Windows và của Unix rơi vào đúng những `ErrorKind` mà vòng lặp
    /// bắt* — phần dễ sai nhất và phần không đọc ra được từ code.
    #[test]
    fn an_aborted_connection_is_not_a_broken_listener() {
        // Mã thô được hệ điều hành *đang chạy* dịch, nên mỗi nửa chỉ chạy ở nhà nó — CI chạy cả
        // hai. Một pool buông socket nửa mở sinh ra đúng những mã này.
        #[cfg(windows)]
        {
            assert!(is_transient_accept(&Error::from_raw_os_error(10054))); // WSAECONNRESET
            assert!(is_transient_accept(&Error::from_raw_os_error(10053))); // WSAECONNABORTED
            // Hết handle không phải chuyện của một kết nối: chờ rồi thử lại.
            assert!(!is_transient_accept(&Error::from_raw_os_error(10024))); // WSAEMFILE
        }
        #[cfg(unix)]
        {
            assert!(is_transient_accept(&Error::from_raw_os_error(104))); // ECONNRESET
            assert!(is_transient_accept(&Error::from_raw_os_error(103))); // ECONNABORTED
            assert!(!is_transient_accept(&Error::from_raw_os_error(24))); // EMFILE
        }

        // Và một signal cắt ngang lời gọi, ở mọi nhà.
        assert!(is_transient_accept(&Error::from(ErrorKind::Interrupted)));

        // Hai giây cổng câm là ngưỡng phiền tới người dùng: đủ lâu để một cơn thoáng qua tự khỏi
        // trong im lặng.
        assert_eq!(ACCEPT_RETRY * ACCEPT_ALARM, Duration::from_secs(2));
    }
}
