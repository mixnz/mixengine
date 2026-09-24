+++
title = "Gỡ MixLab"
slug = "uninstalling"
order = 13
summary = "Hoàn tác mọi thứ MixLab đã ghi bên ngoài thư mục của nó, xem danh sách trước khi đồng ý, và giữ lại cơ sở dữ liệu nếu bạn muốn."
translation_of = "en/uninstalling.md"
source_sha256 = "8fb28e6a48941aaf2abe92c8610eb413420a9770107a00ff45c8b375021b5220"
+++

# Gỡ MixLab

> **Đây là tài liệu hướng dẫn dùng MixLab qua dòng lệnh `mix`.** Nếu bạn muốn thao tác bằng
> giao diện đồ họa cho dễ hơn thì bạn đã có sẵn: mọi bộ cài đều đặt sẵn cửa sổ MixLab ngay cạnh
> dòng lệnh. Cả hai đều điều khiển cùng một MixEngine bên dưới, nên mọi khái niệm trong cẩm nang
> này vẫn áp dụng.

MixLab ghi gần như mọi thứ vào một thư mục duy nhất. Ngoại lệ là vài thay đổi đặc quyền mà nó
đã xin phép bạn, và `mix uninstall` chính là để thu hồi những thay đổi đó.

## Trên Windows, Installed apps lo hết

Gỡ MixLab trong Installed apps. Bộ gỡ hỏi hai lựa chọn, mặc định đều không tick:

- **Also delete MixLab's data**: thư mục home, gồm database, chứng chỉ và bản ghi các project.
- **Also delete the folders you moved out of it**: chỉ hiện khi bạn đã dùng `[paths]` để chuyển
  `runtimes`, `packages`, `data` hoặc `logs` sang chỗ khác, và liệt kê các thư mục đó.

Nếu MixLab đang mở, bộ gỡ hỏi rồi đóng nó. Sau đó nó kiểm tra mọi thứ có thể làm kẹt giữa chừng:
file đang được dùng, hoặc chương trình đang chạy từ thư mục của MixLab, ví dụ một `php` bạn chạy
qua shim. Có thứ nào chặn thì nó nêu tên và không xóa gì cả. Tắt thứ đó rồi bấm Uninstall lại.

Tiếp theo là một hộp thoại quản trị để hoàn tác các thay đổi trên máy liệt kê bên dưới, rồi đến
lượt chương trình. Nếu bạn từ chối hộp thoại, không có gì bị xóa và MixLab vẫn còn nguyên. Khi nào
sẵn sàng thì chạy Uninstall lại.

Phần còn lại của trang này là cùng việc đó nhưng làm bằng `mix`, cũng là cách làm trên macOS và
Linux.

## Xem danh sách trước

```bash
mix uninstall --dry-run
```

Lệnh này không thay đổi gì, chỉ liệt kê từng thứ nó sẽ gỡ:

- khối trong file hosts, và rule DNS hoặc resolver dùng để định tuyến tên miền của bạn
- quyền lắng nghe trên cổng 80 và 443
- certificate authority, khỏi mọi store đang tin nó
- rule firewall nào còn sót lại từ site đã chia sẻ
- mục tự khởi động daemon khi bạn đăng nhập
- mục trong `PATH`
- chương trình phụ trợ đặc quyền, cùng nhật ký kiểm tra của nó
- và cuối cùng là thư mục riêng của MixLab

## Thực hiện

```bash
mix uninstall
```

Bạn sẽ được hỏi xác nhận, và một hộp thoại quản trị duy nhất bao trọn phần đặc quyền. `--yes` trả
lời trước câu xác nhận đó, dành cho script.

**Chưa có gì thay đổi cho tới khi bạn cho phép.** Từ chối hộp thoại thì `PATH`, mục tự khởi động
và các browser của bạn vẫn y như cũ. Khi nào sẵn sàng thì chạy lại lệnh.

**Có chương trình đang chạy từ thư mục của MixLab thì lệnh dừng ngay từ đầu.** Danh sách đánh dấu
nó là `BLOCKED` và lệnh thoát với mã `3`, để script phân biệt được "tắt cái này rồi thử lại" với
một lỗi thật. Tắt chương trình đó rồi chạy lại lệnh.

**Báo cáo là kết quả đo được, không phải lời khẳng định.** Thứ trả về là những gì MixLab tìm
thấy trên máy *sau khi* gỡ, từng dòng một, kể cả những dòng trả lời *không có gì ở đây*. Nếu báo
cáo giấu những dòng đó, bạn sẽ không phân biệt được "không có cấu hình resolver nào" với "chưa
kiểm tra cấu hình resolver". Lệnh thoát với mã khác không nếu bất cứ thứ gì nó đã xử lý vẫn còn,
để script kiểm tra được.

Kết nối sẽ đứt giữa chừng, và đó là bình thường: daemon đang xóa chính thư mục home nó phục vụ, nên
nó tự dừng. Sau đó MixLab đọc lại các dòng cuối trực tiếp từ đĩa. Nhờ vậy câu trả lời là *không
còn gì sót lại*, chứ không phải *daemon bảo thế*.

## Giữ lại dữ liệu

```bash
mix uninstall --keep-home
```

Lệnh này hoàn tác mọi thứ **bên ngoài** thư mục home và để nguyên home: cơ sở dữ liệu trong `data/`,
chứng chỉ, bản ghi các project. Xong việc thì daemon dừng, và lần cài sau sẽ dùng lại home này.

Nếu bạn đã dùng `[paths]` để chuyển `runtimes`, `packages`, `data` hoặc `logs` sang ổ khác, các thư
mục đó là một lựa chọn riêng:

```bash
mix uninstall --keep-relocated
```

giữ chúng lại và xóa home. Dùng cả hai cờ để giữ tất cả. Thư mục nào bạn chưa từng chuyển đi thì
nằm trong home, nên đi cùng home.

## Rồi gỡ chính chương trình

`mix uninstall` gỡ những gì MixLab đã làm. Còn gỡ bản thân MixLab là việc của trình quản lý
gói, và tùy vào cách bạn đã cài:

```bash
sudo dpkg -r mixlab
sudo rpm -e mixlab
sudo rm -rf /usr/local/bin/mix /usr/local/bin/mixengined /usr/local/bin/mixengine-shim \
  /Applications/MixLab.app
```

Trên Windows, bộ gỡ của bộ cài đã làm luôn phần này. Nếu dùng bản zip portable thì xóa thư mục.
Trên macOS, dòng thứ ba ở trên xóa những gì `.pkg` đã đặt vào, **MixLab** cũng nằm trong đó.
AppImage chỉ là một file, xóa đi là xong.

## Những gì cố ý không tự động

Nhật ký kiểm tra của chương trình phụ trợ đặc quyền thuộc sở hữu root, và bản thân chương trình đó
cũng vậy. `mix doctor` báo cáo cả hai và không xóa cái nào. Một công cụ chẩn đoán mà xóa nhật ký
thuộc sở hữu root thì tức là xóa luôn bằng chứng về thứ nó đang chẩn đoán. `mix uninstall` mới là
lệnh gỡ chúng, và nó sẽ hỏi trước.
