+++
title = "Cài đặt MixEngine"
slug = "install"
order = 2
summary = "Bộ cài cho hệ điều hành của bạn, nó đụng vào những gì, cố ý không đụng vào những gì, và cách kiểm tra file vừa tải."
translation_of = "en/install.md"
source_sha256 = "08e1226dad476a1d0f58e218b934117367f9ea15830223103f9f0c8ed6827209"
+++

# Cài đặt MixEngine

> **Đây là tài liệu hướng dẫn dùng MixEngine qua dòng lệnh `mix`.** Nếu bạn muốn thao tác bằng
> giao diện đồ họa cho dễ hơn, hãy tải ứng dụng **MixDB** tại
> [https://lab.mixnz.com/#mixdb](https://lab.mixnz.com/#mixdb). MixDB làm việc trên cùng một
> MixEngine, nên mọi khái niệm trong cẩm nang này vẫn áp dụng.

Mọi bản build đều được phát hành trên trang releases của dự án trên GitHub, kèm theo checksum và
chữ ký. Bạn chọn file đúng với hệ điều hành của mình ở bên dưới. Bộ cài thay đổi máy bạn ít nhất
có thể: chưa có gì được thêm vào kho chứng chỉ, cài đặt DNS hay firewall cho tới khi bạn yêu cầu một
tính năng cần tới chúng. Chi tiết xem ở [MixEngine xin quyền để làm gì](./permissions.md).

**Hiện chưa có bản phát hành ổn định.** Mọi link tải bên dưới là URL cố định, GitHub luôn trỏ nó
tới bản mới nhất *không phải* pre-release. Vì vậy khi bản ổn định đầu tiên ra mắt, các link này sẽ
tự hoạt động mà không cần sửa trang này. Trong lúc chờ, bạn lấy bản pre-release mới nhất thủ công
tại [trang releases](https://github.com/mixnz/mixengine/releases). Hiện tại đó là `v0.0.1`.

## Bạn đang cài những gì

Có bốn chương trình. Nên biết mỗi cái làm gì trước khi một trong số chúng làm bạn bất ngờ.

| Chương trình | Nhiệm vụ |
| --- | --- |
| `mixengined` | Daemon. Lưu mọi trạng thái MixEngine biết và giám sát mọi tiến trình MixEngine chạy. |
| `mix` | Lệnh bạn gõ. Nó hỏi daemon rồi in câu trả lời ra. |
| `mixengine-shim` | Chương trình thế chỗ cho `php`, `node`, `python` và `ruby`, chọn đúng phiên bản cần chạy. |
| `mixengine-elevate` | Chương trình duy nhất chạy với quyền quản trị, mỗi lần chỉ vài giây. |

Ba chương trình đầu được cài chung một lượt, dưới tài khoản của bạn. Chương trình thứ tư thì trên
hầu hết hệ điều hành bộ cài không đặt vào máy. MixEngine sẽ tự cài nó vào lần đầu tiên có việc cần
quyền quản trị, ngay trong hộp thoại xin quyền mà đằng nào bạn cũng sẽ thấy.

## Windows

[**Tải bộ cài**](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-windows-x86_64-setup.exe)
· [bản zip portable](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-windows-x86_64.zip)
· Windows ARM: [bộ cài](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-windows-aarch64-setup.exe),
[zip](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-windows-aarch64.zip)

Có hai file được phát hành, file nào cũng là một bản cài đầy đủ.

- **`mixengine-<version>-windows-x86_64-setup.exe`**: bộ cài theo từng người dùng. Nó ghi vào
  profile của bạn và thêm thư mục cài vào `PATH`, nên không cần hộp thoại quản trị, và cũng không
  đụng tới tài khoản của người khác trên cùng máy.
- **`mixengine-<version>-windows-x86_64.zip`**: cùng bộ chương trình đó, đóng gói trong một thư
  mục. Giải nén ở đâu tùy bạn rồi chạy `mix.exe` từ đó.

Bản cho Windows ARM được phát hành bên cạnh, đặt tên `aarch64`.

**Bạn sẽ gặp cảnh báo SmartScreen.** MixEngine chưa được ký bằng chứng chỉ Authenticode, nên
Windows hiện *"Windows protected your PC"* và giấu nút chạy sau **More info → Run anyway**. Cảnh
báo này chỉ nói rằng chưa ai mua chứng chỉ, chứ không nói gì về bản thân file. Nếu muốn biết chắc
file mình tải có đúng không, hãy kiểm tra chữ ký theo hướng dẫn bên dưới. Cảnh báo này thường xuất
hiện lại ở mỗi bản phát hành, vì khi không có danh tính nhà phát hành, "uy tín" mà Windows tích lũy
gắn với từng file chứ không gắn với dự án.

## macOS

[**Tải gói cài**](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-macos-universal.pkg)

**`mixengine-<version>-macos-universal.pkg`**: một gói dùng chung cho cả Intel lẫn Apple silicon.

MixEngine cũng chưa có Apple Developer ID, nên nếu bạn nhấp đúp gói cài trong Finder thì sẽ gặp hộp
thoại Gatekeeper. Trên macOS 15 trở lên còn phải vào **System Settings → Privacy & Security → Open
Anyway**. Cài từ terminal thì bỏ qua được tất cả những bước đó:

```bash
sudo installer -pkg mixengine-*-macos-universal.pkg -target /
```

Với một sản phẩm dòng lệnh thì đây là cách nên dùng trước tiên. Gói cài chạy với quyền root, nên nó
cũng đặt luôn chương trình phụ trợ cần quyền quản trị vào máy cho bạn.

## Linux

[**`.deb`**](https://github.com/mixnz/mixengine/releases/latest/download/mixengine_amd64.deb)
· [**`.rpm`**](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-x86_64.rpm)
· [**`.AppImage`**](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-linux-x86_64.AppImage)
· arm64: [`.deb`](https://github.com/mixnz/mixengine/releases/latest/download/mixengine_arm64.deb),
[`.rpm`](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-aarch64.rpm),
[`.AppImage`](https://github.com/mixnz/mixengine/releases/latest/download/mixengine-linux-aarch64.AppImage)

Ba file, file nào cũng là một bản cài đầy đủ:

- **`.deb`** cho Debian, Ubuntu và các bản phái sinh
- **`.rpm`** cho Fedora, RHEL và openSUSE
- **`.AppImage`**, không cần trình quản lý gói và không cần quyền root

```bash
sudo dpkg -i mixengine_*_amd64.deb
sudo rpm -i mixengine-*.x86_64.rpm
chmod +x mixengine-*-linux-x86_64.AppImage && ./mixengine-*-linux-x86_64.AppImage
```

Cả hai gói đều được build với glibc 2.28, nên chạy được trên các bản phân phối hỗ trợ dài hạn mà
chúng nhắm tới, chứ không chỉ trên máy mới ngang với máy đã build ra chúng. Bản `aarch64` được phát
hành bên cạnh bản `x86_64`.

## Build từ mã nguồn

MixEngine viết bằng Rust, và chỉ Rust:

```bash
git clone https://github.com/mixnz/mixengine.git
cd mixengine
cargo build --release
```

Các file thực thi nằm trong `target/release/`. Đây là cách cài thứ tư chạy hoàn toàn dưới tài khoản
của bạn. Cũng vì thế mà việc đặt chương trình phụ trợ cần quyền quản trị không bao giờ là việc của
người đóng gói.

## Kiểm tra file bạn vừa tải

Bên cạnh mỗi file phát hành có hai file đi kèm, và chúng trả lời hai câu hỏi khác nhau.

```bash
sha256sum -c mixengine-*-linux-x86_64.tar.gz.sha256
minisign -Vm mixengine-*-linux-x86_64.tar.gz -P <the key in packaging/updates.pub>
```

File `.sha256` cho bạn biết hai lần tải cùng một file có ra đúng cùng một file hay không. **Nó
không phải chữ ký** và cũng không được coi là chữ ký: ai thay được file phát hành thì cũng thay
được checksum nằm cạnh nó. Các file không gắn số phiên bản mà những link ở trên trỏ tới cũng có
`.sha256` và `.minisig` riêng, đặt tên theo chính chúng chứ không theo file có số phiên bản mà chúng
là bản sao. File `.minisig` mới là câu trả lời thật: đó là chữ ký Ed25519 do chính pipeline phát
hành của MixEngine tạo ra, ứng với khóa công khai được commit trong repo của dự án tại
`packaging/updates.pub` và được biên dịch vào MixEngine. Đây cũng chính là khóa mà `mix self-update`
kiểm tra trước khi thay bất cứ thứ gì.

## Sau khi cài

Mở một cửa sổ terminal mới, vì bộ cài đã sửa `PATH` mà shell đang chạy sẵn thì chưa biết chuyện đó.
Rồi gõ:

```bash
mix status
```

Lệnh `mix` đầu tiên sẽ khởi động daemon nếu nó chưa chạy. Kết quả bạn nên thấy là một daemon khỏe
mạnh, số phiên bản của nó, và chưa có gì đang được giám sát.

Tiếp theo, đưa các lệnh runtime vào `PATH`. Đây là một bước riêng vì chúng nằm ở một thư mục riêng:

```bash
mix path install
```

Lệnh này điền vào `<root>/bin` các shim, để `php`, `node`, `python` và `ruby` trỏ tới đúng phiên
bản mà từng thư mục yêu cầu, thay vì một phiên bản chung cho cả máy.

## Những gì bộ cài không làm

Không đụng gì ngoài tài khoản của bạn, và không đụng gì tới phần còn lại của máy:

- **Không cài certificate authority** nào. Việc đó diễn ra lần đầu bạn yêu cầu HTTPS.
- **Không sửa DNS hay file hosts.** Việc đó diễn ra lần đầu bạn tạo site.
- **Không thêm rule firewall** và **không cấp quyền dùng cổng**. Việc đó diễn ra khi một site cần.
- **Không tải runtime hay server nào.** MixEngine cài PHP, MariaDB và các thứ khác khi bạn yêu cầu,
  và chỉ những phiên bản bạn yêu cầu.
- **Không đăng ký chạy khi đăng nhập.** Chỉ khi bạn chạy `mix autostart enable` thì điều đó mới xảy
  ra.

Từng mục trên đều được mô tả ở [MixEngine xin quyền để làm gì](./permissions.md), kể cả việc mỗi
hộp thoại sẽ thay đổi chính xác cái gì trước khi bạn đồng ý.

Sẵn sàng chưa? [Site đầu tiên của bạn](./getting-started.md) mất khoảng năm phút.
