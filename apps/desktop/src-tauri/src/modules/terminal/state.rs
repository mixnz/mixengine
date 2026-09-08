use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

use super::models::TerminalSize;

/// Tay cầm một phiên. Local hay SSH khác nhau ở chỗ ai dựng nó, không ở chỗ dùng nó.
pub struct Session {
    /// Byte người dùng gõ, chảy tới đầu xa.
    pub input: UnboundedSender<Vec<u8>>,
    /// cols/rows mỗi khi khung đổi kích thước.
    pub resize: UnboundedSender<TerminalSize>,
    /// Đóng tab, hoặc app thoát.
    pub kill: CancellationToken,
}

impl Drop for Session {
    /// Bỏ tay cầm là giết phiên: tiến trình con bị kill, thread ghi và thread resize thấy kênh
    /// đóng rồi tự thoát. Nên không có đường nào bỏ sót một phiên.
    fn drop(&mut self) {
        self.kill.cancel();
    }
}

/// Mọi phiên đang mở, theo id frontend cấp. Khoá thường chứ không phải khoá async: không có gì
/// được await khi đang giữ nó.
#[derive(Default)]
pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalState {
    /// Bỏ một phiên khỏi map, nếu nó còn ở đó.
    ///
    /// Buông nó *ngoài* phạm vi khoá: `Drop` của `Session` huỷ token và buông hai đầu gửi, và đó
    /// là thứ đánh thức các thread và task còn đang chờ trên chúng — không có gì trong đó cần
    /// khoá, và không có gì trong đó nên chạy khi đang giữ khoá.
    pub fn forget(&self, id: &str) {
        let gone = self.sessions.lock().unwrap().remove(id);
        drop(gone);
    }
}
