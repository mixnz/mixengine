+++
title = "Gỡ MixEngine"
slug = "uninstalling"
order = 13
summary = "Hoàn tác mọi thứ MixEngine đã ghi bên ngoài thư mục của nó, xem danh sách trước khi đồng ý, và giữ lại cơ sở dữ liệu nếu bạn muốn."
translation_of = "en/uninstalling.md"
source_sha256 = "4a1bbff93bf5eb3a145d273ef2d790b5253078e23ff9e55b15d885966f1c195f"
+++

# Gỡ MixEngine

> **Đây là tài liệu hướng dẫn dùng MixEngine qua dòng lệnh `mix`.** Nếu bạn muốn thao tác bằng
> giao diện đồ họa cho dễ hơn thì bạn đã có sẵn: mọi bộ cài đều đặt **MixLab**, ứng dụng desktop
> của MixEngine, ngay cạnh dòng lệnh. MixLab làm việc trên cùng một MixEngine, nên mọi khái niệm
> trong cẩm nang này vẫn áp dụng.

MixEngine ghi gần như mọi thứ vào một thư mục duy nhất. Ngoại lệ là vài thay đổi đặc quyền mà nó
đã xin phép bạn, và `mix uninstall` chính là để thu hồi những thay đổi đó.

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
- và cuối cùng là thư mục riêng của MixEngine

## Thực hiện

```bash
mix uninstall
```

Bạn sẽ được hỏi xác nhận, và một hộp thoại quản trị duy nhất bao trọn phần đặc quyền. `--yes` trả
lời trước câu xác nhận đó, dành cho script.

**Báo cáo là kết quả đo được, không phải lời khẳng định.** Thứ trả về là những gì MixEngine tìm
thấy trên máy *sau khi* gỡ, từng dòng một, kể cả những dòng trả lời *không có gì ở đây*. Nếu báo
cáo giấu những dòng đó, bạn sẽ không phân biệt được "không có cấu hình resolver nào" với "chưa
kiểm tra cấu hình resolver". Lệnh thoát với mã khác không nếu bất cứ thứ gì nó đã xử lý vẫn còn,
để script kiểm tra được.

Kết nối sẽ đứt giữa chừng, và đó là bình thường: daemon đang xóa chính thư mục home nó phục vụ, nên
nó tự dừng. Sau đó MixEngine đọc lại các dòng cuối trực tiếp từ đĩa. Nhờ vậy câu trả lời là *không
còn gì sót lại*, chứ không phải *daemon bảo thế*.

## Giữ lại dữ liệu

```bash
mix uninstall --keep-home
```

Lệnh này hoàn tác mọi thứ **bên ngoài** thư mục home và để nguyên home: cơ sở dữ liệu trong `data/`,
chứng chỉ, bản ghi các project. Daemon vẫn chạy, vì vẫn còn home để nó phục vụ.

Đây là lệnh đúng khi bạn muốn trả lại cấu hình mạng cho máy nhưng vẫn chưa xong việc với dữ liệu.

## Rồi gỡ chính chương trình

`mix uninstall` gỡ những gì MixEngine đã làm. Còn gỡ bản thân MixEngine là việc của trình quản lý
gói, và tùy vào cách bạn đã cài:

```bash
sudo dpkg -r mixengine
sudo rpm -e mixengine
sudo rm -rf /usr/local/bin/mix /usr/local/bin/mixengined /usr/local/bin/mixengine-shim \
  /Applications/MixLab.app
```

Trên Windows, dùng Apps & Features nếu cài bằng bộ cài, hoặc xóa thư mục nếu dùng bản zip portable.
Trên macOS, dòng thứ ba ở trên xóa những gì `.pkg` đã đặt vào, **MixLab** cũng nằm trong đó.
AppImage chỉ là một file, xóa đi là xong.

## Những gì cố ý không tự động

Nhật ký kiểm tra của chương trình phụ trợ đặc quyền thuộc sở hữu root, và bản thân chương trình đó
cũng vậy. `mix doctor` báo cáo cả hai và không xóa cái nào. Một công cụ chẩn đoán mà xóa nhật ký
thuộc sở hữu root thì tức là xóa luôn bằng chứng về thứ nó đang chẩn đoán. `mix uninstall` mới là
lệnh gỡ chúng, và nó sẽ hỏi trước.
