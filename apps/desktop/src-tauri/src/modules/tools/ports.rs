//! Đọc output của `netstat`, `ss` và `lsof` thành một danh sách cổng đang nghe.
//!
//! Không có `Command` nào trong file này, và đó là chủ ý: chạy lệnh phụ thuộc máy, phụ thuộc
//! quyền, và không test được trong CI. Đọc output thì là hàm thuần — và nó là chỗ mọi lỗi sẽ nằm,
//! vì ba nền tảng có ba định dạng, mỗi cái một kiểu dòng lạ. `commands.rs` giữ nửa kia.
//!
//! `allow(dead_code)` cho cả file, và nó là điều kiện để cách chia trên hoạt động: `collect()` ở
//! `commands.rs` bị `cfg` theo nền tảng nên trên máy nào cũng chỉ gọi **một** trong ba bộ đọc, còn
//! cả ba thì cố ý được biên dịch ở mọi nơi để **test của cả ba chạy ở mọi nơi**. Không có dòng
//! này thì clippy báo hai bộ đọc kia là code chết trên Windows, và báo `parse_netstat` là code
//! chết trên máy Linux của CI. Đóng khung ở đúng file này chấp nhận được vì trong đây không có gì
//! ngoài ba bộ đọc và mấy hàm phụ của chúng.
#![allow(dead_code)]

use serde::Serialize;
use std::collections::HashMap;

/// Một cổng đang được nghe trên máy này.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    /// Địa chỉ đang nghe: `0.0.0.0`, `127.0.0.1`, `::`. Phân biệt "mở ra ngoài" với "chỉ localhost".
    pub address: String,
    pub pid: u32,
    /// `None` khi tra được cổng nhưng không tra được tên tiến trình — thường là thiếu quyền.
    pub process: Option<String>,
}

/// Tách `0.0.0.0:445` hoặc `[::]:445` thành địa chỉ và cổng.
///
/// Cắt ở dấu hai chấm **cuối cùng**: địa chỉ IPv6 có đầy dấu hai chấm bên trong nó, nên cắt ở dấu
/// đầu tiên là ra `[` và một mớ rác.
fn split_address(text: &str) -> Option<(String, u16)> {
    let cut = text.rfind(':')?;
    let (host, port) = text.split_at(cut);
    let port: u16 = port[1..].parse().ok()?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    Some((host.to_string(), port))
}

/// Bảng PID → tên tiến trình, đọc từ `tasklist /FO CSV /NH`.
///
/// Mỗi dòng là `"tên","pid","session","số","bộ nhớ"`. Tách bằng `","` chứ không bằng dấu phẩy đơn:
/// tên tiến trình có thể chứa dấu phẩy, và nó nằm trong ngoặc kép chính vì thế.
fn tasklist_names(text: &str) -> HashMap<u32, String> {
    let mut names = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('"') {
            continue;
        }
        let mut parts = line.trim_matches('"').split("\",\"");
        let Some(name) = parts.next() else { continue };
        let Some(pid) = parts.next().and_then(|p| p.trim().parse::<u32>().ok()) else {
            continue;
        };
        names.insert(pid, name.to_string());
    }
    names
}

/// Đọc `netstat -ano` cộng `tasklist /FO CSV /NH`.
///
/// **`netstat -ano`, không phải `netstat -ano -p TCP`**: cờ `-p TCP` lọc mất toàn bộ IPv6, nên một
/// service chỉ nghe trên `[::]` sẽ biến mất khỏi bảng mà không có dấu hiệu gì.
///
/// Bỏ `-p` thì output có thêm UDP, và cách phân biệt là **số cột**: dòng TCP có 5 cột vì có cột
/// trạng thái, dòng UDP chỉ có 4. Nên luật ở đây là đúng 5 cột, cột đầu `TCP`, cột thứ tư
/// `LISTENING` — UDP tự rụng vì thiếu cột, TCP đang `ESTABLISHED` tự rụng vì sai trạng thái.
pub fn parse_netstat(netstat: &str, tasklist: &str) -> Vec<ListeningPort> {
    let names = tasklist_names(tasklist);
    let mut ports = Vec::new();
    for line in netstat.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() != 5 || fields[0] != "TCP" || fields[3] != "LISTENING" {
            continue;
        }
        let Some((address, port)) = split_address(fields[1]) else {
            continue;
        };
        let Ok(pid) = fields[4].parse::<u32>() else {
            continue;
        };
        ports.push(ListeningPort {
            port,
            address,
            pid,
            process: names.get(&pid).cloned(),
        });
    }
    ports
}

/// Rút tên và PID đầu tiên ra khỏi `users:(("nginx",pid=123,fd=6),("nginx",pid=124,fd=6))`.
fn parse_ss_users(field: &str) -> Option<(String, u32)> {
    let rest = field.strip_prefix("users:((")?;
    let name = rest.strip_prefix('"')?;
    let end = name.find('"')?;
    let name = &name[..end];
    let pid_at = rest.find("pid=")? + 4;
    let pid: String = rest[pid_at..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    Some((name.to_string(), pid.parse().ok()?))
}

/// Đọc `ss -lntp`.
///
/// Không dùng cờ `-H` để bỏ tiêu đề: cờ đó chỉ có ở `iproute2` đời mới, và nhận ra dòng tiêu đề ở
/// đây rẻ hơn là đòi hỏi một phiên bản. Phần khó là `users:(("nginx",pid=123,fd=6))` — tên và PID
/// nằm lồng trong ngoặc, và một cổng có thể có nhiều tiến trình cùng giữ.
pub fn parse_ss(text: &str) -> Vec<ListeningPort> {
    let mut ports = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        // `State Recv-Q Send-Q Local:Port Peer:Port [Process]`
        if fields.len() < 5 || fields[0] != "LISTEN" {
            continue;
        }
        let Some((address, port)) = split_address(fields[3]) else {
            continue;
        };
        let (process, pid) = match fields.get(5).and_then(|f| parse_ss_users(f)) {
            Some((name, pid)) => (Some(name), pid),
            // Không có quyền xem tiến trình: cổng vẫn là một câu trả lời có ích.
            None => (None, 0),
        };
        ports.push(ListeningPort {
            port,
            address,
            pid,
            process,
        });
    }
    ports
}

/// Đọc `lsof -nP -iTCP -sTCP:LISTEN -Fpcn`.
///
/// Dạng field: mỗi dòng một trường, ký tự đầu là tên trường. `p` mở đầu một tiến trình, `c` là tên
/// lệnh của nó, và mọi dòng `n` sau đó thuộc về tiến trình gần nhất — nên phải nhớ `p` và `c` đang
/// mở chứ không đọc từng dòng độc lập.
pub fn parse_lsof(text: &str) -> Vec<ListeningPort> {
    let mut ports = Vec::new();
    let mut pid = 0u32;
    let mut command: Option<String> = None;
    for line in text.lines() {
        let Some(tag) = line.chars().next() else {
            continue;
        };
        let value = &line[1..];
        match tag {
            'p' => {
                pid = value.parse().unwrap_or(0);
                command = None;
            }
            'c' => command = Some(value.to_string()),
            'n' => {
                // `*:3000` nghĩa là nghe trên mọi địa chỉ.
                let text = value.replace("*:", "0.0.0.0:");
                if let Some((address, port)) = split_address(&text) {
                    ports.push(ListeningPort {
                        port,
                        address,
                        pid,
                        process: command.clone(),
                    });
                }
            }
            _ => {}
        }
    }
    ports
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bắt nguyên văn từ `netstat -ano` trên Windows 11.
    const NETSTAT: &str = "\
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1588
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:65370        127.0.0.1:65371        ESTABLISHED     21928
  TCP    [::]:135               [::]:0                 LISTENING       1588
  UDP    0.0.0.0:53             *:*                                    4864
";

    const TASKLIST: &str = "\
\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"
\"System\",\"4\",\"Services\",\"0\",\"5.844 K\"
\"svchost.exe\",\"1588\",\"Services\",\"0\",\"12.000 K\"
";

    #[test]
    fn netstat_chi_lay_dong_dang_nghe() {
        let ports = parse_netstat(NETSTAT, TASKLIST);
        // Hai dòng LISTENING IPv4 cộng một dòng IPv6; ESTABLISHED và UDP không được vào.
        assert_eq!(ports.len(), 3);
        assert!(ports.iter().all(|p| p.port != 65370));
        assert!(ports.iter().all(|p| p.port != 53));
    }

    #[test]
    fn netstat_doc_duoc_ipv6() {
        let ports = parse_netstat(NETSTAT, TASKLIST);
        let v6 = ports.iter().find(|p| p.address == "::").unwrap();
        assert_eq!(v6.port, 135);
        assert_eq!(v6.pid, 1588);
    }

    #[test]
    fn netstat_tra_ten_tien_trinh_theo_pid() {
        let ports = parse_netstat(NETSTAT, TASKLIST);
        let p135 = ports.iter().find(|p| p.port == 135).unwrap();
        assert_eq!(p135.process.as_deref(), Some("svchost.exe"));
        let p445 = ports.iter().find(|p| p.port == 445).unwrap();
        assert_eq!(p445.process.as_deref(), Some("System"));
    }

    #[test]
    fn netstat_de_none_khi_khong_co_pid_trong_tasklist() {
        let netstat = "  TCP    0.0.0.0:9999           0.0.0.0:0              LISTENING       777\n";
        let ports = parse_netstat(netstat, TASKLIST);
        assert_eq!(ports[0].process, None);
    }

    #[test]
    fn tasklist_khong_vo_vi_ten_co_dau_phay() {
        let names = tasklist_names("\"a,b.exe\",\"42\",\"Services\",\"0\",\"1 K\"\n");
        assert_eq!(names.get(&42).map(String::as_str), Some("a,b.exe"));
    }

    const SS: &str = "\
State      Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
LISTEN     0      511          0.0.0.0:80          0.0.0.0:*    users:((\"nginx\",pid=123,fd=6))
LISTEN     0      4096            [::]:5432             [::]:*    users:((\"postgres\",pid=99,fd=7))
LISTEN     0      128          0.0.0.0:22          0.0.0.0:*
";

    #[test]
    fn ss_doc_ten_va_pid_trong_ngoac() {
        let ports = parse_ss(SS);
        let nginx = ports.iter().find(|p| p.port == 80).unwrap();
        assert_eq!(nginx.process.as_deref(), Some("nginx"));
        assert_eq!(nginx.pid, 123);
    }

    #[test]
    fn ss_bo_dong_tieu_de() {
        assert_eq!(parse_ss(SS).len(), 3);
    }

    #[test]
    fn ss_doc_duoc_ipv6() {
        let pg = parse_ss(SS).into_iter().find(|p| p.port == 5432).unwrap();
        assert_eq!(pg.address, "::");
        assert_eq!(pg.pid, 99);
    }

    // Thiếu quyền thì `ss` không in cột tiến trình. Cổng vẫn phải hiện ra.
    #[test]
    fn ss_van_tra_cong_khi_khong_co_cot_tien_trinh() {
        let ssh = parse_ss(SS).into_iter().find(|p| p.port == 22).unwrap();
        assert_eq!(ssh.process, None);
        assert_eq!(ssh.pid, 0);
    }

    const LSOF: &str = "\
p123
cnode
n*:3000
n127.0.0.1:9229
p456
cpostgres
n[::1]:5432
";

    #[test]
    fn lsof_gan_moi_dong_n_vao_tien_trinh_gan_nhat() {
        let ports = parse_lsof(LSOF);
        assert_eq!(ports.len(), 3);
        assert_eq!(ports[0].pid, 123);
        assert_eq!(ports[0].process.as_deref(), Some("node"));
        assert_eq!(ports[1].pid, 123);
        assert_eq!(ports[2].pid, 456);
        assert_eq!(ports[2].process.as_deref(), Some("postgres"));
    }

    #[test]
    fn lsof_doi_sao_thanh_moi_dia_chi() {
        let ports = parse_lsof(LSOF);
        assert_eq!(ports[0].address, "0.0.0.0");
        assert_eq!(ports[0].port, 3000);
    }

    #[test]
    fn lsof_doc_duoc_ipv6() {
        let ports = parse_lsof(LSOF);
        assert_eq!(ports[2].address, "::1");
        assert_eq!(ports[2].port, 5432);
    }

    #[test]
    fn cat_dia_chi_o_dau_hai_cham_cuoi_cung() {
        assert_eq!(split_address("[::]:445"), Some(("::".to_string(), 445)));
        assert_eq!(
            split_address("127.0.0.1:8080"),
            Some(("127.0.0.1".to_string(), 8080))
        );
        assert_eq!(split_address("khong-co-cong"), None);
    }
}
