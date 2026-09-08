//! Tách khung Server-Sent Events.
//!
//! Bốn luật, và không hơn: dòng bắt đầu bằng `:` là comment (stream rảnh gửi một cái mỗi 15 giây —
//! đó là thứ phân biệt kết nối sống với kết nối chết); dòng `data:` gom lại, nối bằng `\n`; dòng
//! trống chốt một message; dòng khác bỏ qua.
//!
//! Sự kiện của MixEngine **internally tagged** — không có dòng `event:` nào để đọc, discriminator
//! nằm trong chính JSON. Nên ở đây không có khái niệm "loại sự kiện": nó chỉ chở payload ra, và
//! việc hiểu payload là của phía trên.

/// Bộ gom byte thành từng message. Một cái cho mỗi kết nối.
#[derive(Default)]
pub struct Frames {
    buffer: String,
}

impl Frames {
    pub fn new() -> Self {
        Self::default()
    }

    /// Nuốt một chunk vừa tới, trả về từng payload đã hoàn chỉnh, đúng thứ tự.
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut out = Vec::new();

        loop {
            // Dòng trống chốt một message, và nó tới ở một trong hai hình dạng. Lấy cái xuất hiện
            // sớm hơn: một `\r\n\r\n` cũng chứa một `\n\n` lệch một byte, nên tìm `\n\n` trước rồi
            // mới quyết định độ rộng là sai.
            let crlf = self.buffer.find("\r\n\r\n");
            let lf = self.buffer.find("\n\n");
            let (at, width) = match (crlf, lf) {
                (Some(crlf_at), Some(lf_at)) if crlf_at <= lf_at => (crlf_at, 4),
                (_, Some(lf_at)) => (lf_at, 2),
                (Some(crlf_at), None) => (crlf_at, 4),
                (None, None) => break,
            };

            let block: String = self.buffer.drain(..at + width).collect();
            let mut data: Vec<&str> = Vec::new();
            for line in block.lines() {
                let line = line.trim_end_matches('\r');
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                if let Some(rest) = line.strip_prefix("data:") {
                    data.push(rest.strip_prefix(' ').unwrap_or(rest));
                }
            }
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Một message, gọn gàng.
    #[test]
    fn one_message_comes_out_whole() {
        let mut frames = Frames::new();
        assert_eq!(
            frames.push("data: {\"type\":\"resync\",\"missed\":3}\n\n"),
            vec!["{\"type\":\"resync\",\"missed\":3}"]
        );
    }

    /// Stream rảnh gửi một comment `:` mỗi 15 giây — đó là thứ phân biệt kết nối sống với kết nối
    /// chết, và nó không phải một message.
    #[test]
    fn a_comment_is_not_a_message() {
        let mut frames = Frames::new();
        assert!(frames.push(": keepalive\n\n").is_empty());
    }

    /// Nhiều dòng `data:` của cùng một message được nối bằng `\n`, đúng như spec SSE.
    #[test]
    fn several_data_lines_join() {
        let mut frames = Frames::new();
        assert_eq!(frames.push("data: a\ndata: b\n\n"), vec!["a\nb"]);
    }

    /// TCP cắt ở đâu cũng được, kể cả giữa một dòng. Không có gì ra cho tới khi dòng trống tới.
    #[test]
    fn a_message_split_across_chunks_waits_for_its_blank_line() {
        let mut frames = Frames::new();
        assert!(frames.push("data: {\"type\":\"job_pro").is_empty());
        assert!(frames.push("gress\"}").is_empty());
        assert_eq!(frames.push("\n\n"), vec!["{\"type\":\"job_progress\"}"]);
    }

    /// Hai message trong một chunk ra cả hai, đúng thứ tự.
    #[test]
    fn two_messages_in_one_chunk_both_come_out() {
        let mut frames = Frames::new();
        assert_eq!(frames.push("data: a\n\ndata: b\n\n"), vec!["a", "b"]);
    }

    /// `\r\n` cũng phải nuốt được: đây là HTTP.
    #[test]
    fn carriage_returns_do_not_end_up_in_the_payload() {
        let mut frames = Frames::new();
        assert_eq!(frames.push("data: a\r\n\r\n"), vec!["a"]);
    }
}
