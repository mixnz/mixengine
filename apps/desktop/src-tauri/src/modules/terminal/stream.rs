use std::time::Duration;

use tokio::sync::mpsc::Receiver;
use tokio::time::Instant;

/// Khung lớn nhất gửi qua IPC một lần.
pub const MAX_CHUNK: usize = 64 * 1024;

/// Bao nhiêu lô đọc được xếp hàng trước khi đầu đọc phải dừng lại.
///
/// Đây là chỗ đặt trần cho bộ nhớ của một phiên. Trước đó channel là *unbounded*: `cat` một file
/// vài GB, hay `yes` khi webview vẽ chậm hơn pty đẻ byte, làm hàng đợi lớn không giới hạn — không
/// ai chặn, vì `send` của unbounded channel không bao giờ chờ.
///
/// Có trần thì `send` chờ, đầu đọc dừng, đệm của pty đầy, và hệ điều hành chặn chính tiến trình
/// đang ghi. Đó là backpressure thật, đi hết đường xuống tới `yes`.
///
/// 64 lô × `READ_BUFFER` (8 KiB) là nửa MiB một phiên: đủ để không khựng vì một nhịp giật của
/// webview, đủ nhỏ để mười tab đang `cat` cũng chỉ tốn vài MiB.
pub const QUEUE_DEPTH: usize = 64;

/// Đệm chờ lâu nhất bao lâu trước khi đẩy. Đủ ngắn để gõ phím không thấy trễ, đủ dài để `yes`
/// không sinh ra hàng nghìn khung một giây.
pub const FLUSH_AFTER: Duration = Duration::from_millis(5);

/// Gom byte đọc được thành khung rồi đưa cho `emit`: đủ `MAX_CHUNK` thì đẩy ngay, không thì đẩy
/// khi đệm đã nằm đó `FLUSH_AFTER`.
///
/// Hạn tính từ lúc đệm chuyển từ rỗng sang không rỗng. Đặt lại hạn mỗi lần nhận thêm byte là lỗi
/// kiểu Nagle: một dòng chảy đều, chậm, sẽ không bao giờ tới hạn.
///
/// Trả về khi `rx` đóng — tức khi đầu đọc đã xong — sau khi đẩy nốt phần còn lại. Đó là thứ khiến
/// `Exit` phát sau byte cuối cùng chứ không phải trước.
///
/// Channel vào có trần {@link QUEUE_DEPTH}: hàm này chậm hơn đầu đọc thì đầu đọc phải chờ, chứ
/// không phải hàng đợi phình ra.
pub async fn coalesce<F>(mut rx: Receiver<Vec<u8>>, mut emit: F)
where
    F: FnMut(Vec<u8>),
{
    let mut buffer: Vec<u8> = Vec::new();
    let mut deadline = Instant::now();

    loop {
        if buffer.is_empty() {
            match rx.recv().await {
                Some(chunk) => {
                    deadline = Instant::now() + FLUSH_AFTER;
                    buffer.extend_from_slice(&chunk);
                }
                None => break,
            }
        } else {
            tokio::select! {
                received = rx.recv() => match received {
                    Some(chunk) => buffer.extend_from_slice(&chunk),
                    None => break,
                },
                _ = tokio::time::sleep_until(deadline) => {
                    emit(std::mem::take(&mut buffer));
                    continue;
                }
            }
        }

        while buffer.len() >= MAX_CHUNK {
            let rest = buffer.split_off(MAX_CHUNK);
            emit(std::mem::replace(&mut buffer, rest));
        }
    }

    if !buffer.is_empty() {
        emit(buffer);
    }
}

#[cfg(test)]
mod tests {
    use super::{coalesce, FLUSH_AFTER, MAX_CHUNK, QUEUE_DEPTH};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::sync::mpsc;

    type Emitted = Arc<Mutex<Vec<Vec<u8>>>>;

    fn sink() -> (Emitted, impl FnMut(Vec<u8>)) {
        let seen: Emitted = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        (seen, move |chunk: Vec<u8>| handle.lock().unwrap().push(chunk))
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_small_write_after_the_idle_window() {
        let (tx, rx) = mpsc::channel(QUEUE_DEPTH);
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"hi".to_vec()).await.unwrap();
        tokio::time::sleep(FLUSH_AFTER * 2).await;
        assert_eq!(*seen.lock().unwrap(), vec![b"hi".to_vec()]);

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_full_chunk_without_waiting() {
        let (tx, rx) = mpsc::channel(QUEUE_DEPTH);
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(vec![b'x'; MAX_CHUNK]).await.unwrap();
        // Nhường cho task chạy, nhưng không tiến đồng hồ: đủ 64KB là đẩy ngay.
        tokio::task::yield_now().await;
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(seen.lock().unwrap()[0].len(), MAX_CHUNK);

        drop(tx);
        task.await.unwrap();
    }

    /// Hạn 5ms tính từ byte đầu tiên, không từ byte gần nhất. Một dòng chảy đều mà đặt lại hạn
    /// mỗi lần nhận thì sẽ không bao giờ được đẩy.
    #[tokio::test(start_paused = true)]
    async fn keeps_the_deadline_from_the_first_byte() {
        let (tx, rx) = mpsc::channel(QUEUE_DEPTH);
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        for _ in 0..6 {
            tx.send(b"a".to_vec()).await.unwrap();
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(
            !seen.lock().unwrap().is_empty(),
            "12ms trôi qua mà chưa đẩy lần nào"
        );

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn never_emits_an_empty_chunk() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(QUEUE_DEPTH);
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tokio::time::sleep(FLUSH_AFTER * 10).await;
        drop(tx);
        task.await.unwrap();

        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_what_is_left_when_the_source_ends() {
        let (tx, rx) = mpsc::channel(QUEUE_DEPTH);
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"bye".to_vec()).await.unwrap();
        drop(tx);
        task.await.unwrap();

        assert_eq!(*seen.lock().unwrap(), vec![b"bye".to_vec()]);
    }

    /// R30: cái mà một channel không trần không có.
    ///
    /// Đầu đọc pty ghi vào channel này. Không trần thì `cat` một file vài GB làm hàng đợi lớn tới
    /// đâu cũng được, vì `send` không bao giờ chờ. Có trần thì nó chờ — và chờ ở đó nghĩa là pty
    /// đầy, rồi tới lượt hệ điều hành chặn chính tiến trình đang ghi.
    ///
    /// Chạy trên runtime nhiều luồng vì bên tiêu thụ ở đây *chặn* luồng của nó, đúng như một
    /// webview đã ngừng vẽ.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_reader_cannot_get_further_ahead_than_the_queue_is_deep() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(QUEUE_DEPTH);
        // Khung đầu tiên đỗ bên tiêu thụ lại và không bao giờ thả ra.
        let (_hold, parked) = std::sync::mpsc::channel::<()>();
        tokio::spawn(coalesce(rx, move |_| {
            let _ = parked.recv();
        }));

        // Trần nào cũng phải chạm tới trước con số này; không trần thì không bao giờ chạm.
        let ceiling = QUEUE_DEPTH * 10;
        let mut sent = 0;
        while sent < ceiling {
            // Đợi bên kia nhích lên một chút, để phép đo là "hàng đợi đầy" chứ không phải "chưa
            // ai kịp lấy".
            if tx.try_send(vec![0u8; MAX_CHUNK]).is_err() {
                tokio::time::sleep(Duration::from_millis(20)).await;
                if tx.try_send(vec![0u8; MAX_CHUNK]).is_err() {
                    break;
                }
            }
            sent += 1;
        }

        assert!(
            sent < ceiling,
            "đầu đọc gửi được {sent} lô mà không bị chặn — hàng đợi không có trần"
        );
    }
}
