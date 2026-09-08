+++
title = "Phiên bản PHP, Node, Python và Ruby"
slug = "runtimes"
order = 5
summary = "Cài bao nhiêu phiên bản tùy bạn, và để mỗi thư mục tự chọn phiên bản của nó. Không hook shell, không phải nhớ gì cả."
translation_of = "en/runtimes.md"
source_sha256 = "2c9f2b7837a5d2a3e823537d0346d9b30ddc8ea9ee99aa60a32e92f2f6a4164d"
+++

# Phiên bản PHP, Node, Python và Ruby

> **Đây là tài liệu hướng dẫn dùng MixEngine qua dòng lệnh `mix`.** Nếu bạn muốn thao tác bằng
> giao diện đồ họa cho dễ hơn thì bạn đã có sẵn: mọi bộ cài đều đặt **MixLab**, ứng dụng desktop
> của MixEngine, ngay cạnh dòng lệnh. MixLab làm việc trên cùng một MixEngine, nên mọi khái niệm
> trong cẩm nang này vẫn áp dụng.

MixEngine cài runtime ngôn ngữ vào thư mục riêng của nó, mỗi phiên bản một thư mục bất biến, và
không bao giờ đụng tới những gì hệ điều hành đã có sẵn. Cài một phiên bản mới không bao giờ sửa
phiên bản đã cài, nên bạn thêm gì vào cũng không làm hỏng thứ đang chạy tốt.

Có bốn ngôn ngữ được quản lý: **PHP**, **Node.js**, **Python** và **Ruby**.

## Cài một phiên bản

```bash
mix runtime available --kind php
mix runtime install php 8.3.33
mix runtime list
```

Phiên bản phải ghi chính xác. Đây là cố ý chứ không phải thiếu sót. Ghi `8.3` nghĩa là *"chọn giúp
tôi một cái"*, mà chưa cài gì thì không có gì để chọn. Việc chọn giữa các phiên bản là việc của bước
resolve, và resolve chỉ trả lời dựa trên những gì có trên máy. Muốn dùng một khoảng phiên bản thì
dùng ở `mix runtime available`.

Cài đặt là một job, và mặc định `mix` sẽ chờ nó xong. Vì thế `mix runtime install php 8.3.33 && …`
đảm bảo PHP đã có mặt trước khi lệnh sau chạy. Với `--no-wait`, lệnh trả về ngay khi daemon nhận
việc và đưa bạn một job id, để sau đó bạn chờ bằng `mix job wait`.

**Cài PHP cũng tạo luôn pool php-fpm** cho phiên bản đó, ví dụ `php-fpm@8.3.33`. Đây là một
service như mọi service khác, xuất hiện trong `mix service list`. Node, Python và Ruby được gọi theo
từng lệnh, không có gì cần giám sát.

### Trên máy Windows dùng chip ARM

Một số phiên bản không có bản build cho chip này, ví dụ không ai phát hành PHP cho Windows ARM64.
Trong trường hợp đó, MixEngine cài bản x86_64 và Windows sẽ chạy nó cho bạn. Vẫn chạy được, chỉ
chậm hơn một chút so với bản build đúng cho máy.

Bạn không phải đoán cái nào là cái nào. Trên máy đó, `mix runtime available` và
`mix package available` có thêm cột `RUNS`, ghi `native` hoặc `emulated` cho từng phiên bản, và
lệnh cài sẽ nói rõ trước khi bắt đầu tải. Trên các máy khác không có cột này, vì không có gì để
nói.

## Chọn phiên bản cho từng thư mục

Không có gì ở đây sửa shell, vá file profile, hay bắt bạn gõ lệnh activate. Mỗi thư mục resolve ra
một phiên bản, phần còn lại do shim lo.

```bash
mix runtime default php 8.3.33      # the machine-wide fallback
mix project update blog --pin php=^8.1
mix runtime resolve php             # what does *this* directory get, and why?
```

`mix runtime resolve` là lệnh đáng nhớ nhất. Nó trả lời đúng thứ `php -v` sẽ trả lời mà không chạy
gì cả, **và** nói rõ nguồn nào trong bốn nguồn sau quyết định điều đó:

1. Cờ hoặc biến môi trường truyền tường minh cho lệnh đang chạy.
2. File `mixengine.toml` gần nhất có nhắc tới ngôn ngữ này, tìm ngược lên từ thư mục hiện tại.
3. Project đã đăng ký bao trùm thư mục này.
4. Giá trị mặc định toàn cục.

Một file `mixengine.toml` không nói gì về PHP thì không phải câu trả lời cho PHP, nên pin ở lớp
ngoài vẫn có hiệu lực.

### Cách viết ràng buộc phiên bản

Pin và `--version` chấp nhận ba dạng. Tất cả đều resolve trên các phiên bản **đã cài**, không bao
giờ âm thầm lấy từ danh sách có thể tải:

| Cách viết | Nghĩa |
| --- | --- |
| `8.3.33` | Đúng phiên bản đó |
| `8.3` hoặc `8` | Các phần được ghi phải khớp; phần không ghi coi như số không |
| `^8.3` | Khớp tới phần khác không ở ngoài cùng bên trái; `^0.12` dừng trước `0.13` |

Ràng buộc không ghi pre-release thì không bao giờ chọn pre-release. `8.5` và `^8.5` đều bỏ qua
`8.5.0RC1`; muốn dùng nó thì phải ghi chính xác tên.

## Shim

`mix path install` điền vào `<root>/bin` và đưa duy nhất thư mục đó vào `PATH` của bạn. Trong đó
có một chương trình nhỏ cho mỗi lệnh: `php`, `php-config`, `pecl`, `composer`, `node`, `npm`,
`npx`, `python`, `pip`, `ruby`, `gem`, `bundle`. Mỗi chương trình tự tìm xem thư mục hiện tại muốn
phiên bản nào rồi chuyển cho file thực thi thật.

Hai hệ quả đáng biết:

- **Hoạt động cả khi daemon đã dừng.** Shim đọc trực tiếp thứ nó cần thay vì hỏi qua socket. Vì
  vậy `php -v` trong một project vẫn trả lời được khi MixEngine không chạy.
- **Không cần làm mới gì sau khi cài thêm.** Danh sách lệnh là cố định, nên `<root>/bin` không phụ
  thuộc vào bạn đã cài gì. Shim `node` trên máy chưa có Node.js sẽ không resolve ra gì, và cho bạn
  biết cần gõ lệnh nào.

Chỉ có `<root>/bin` được đưa vào `PATH`. Một mục duy nhất, không bao giờ là một thư mục cho mỗi
phiên bản.

```bash
mix path status
mix path uninstall
```

`mix path uninstall` gỡ thư mục đó khỏi `PATH` nhưng để nguyên các lệnh bên trong. Chúng nằm trong
thư mục home của MixEngine, và chỉ khi gỡ home thì chúng mới mất.

## Extension của PHP

Extension gắn với từng phiên bản đã cài, vì chúng được biên dịch ứng với phiên bản đó:

```bash
mix runtime ext list --php 8.3.33
mix runtime ext enable redis --php 8.3.33
mix runtime ext disable xdebug --php 8.3.33
```

`list` cho biết bản build có những extension nào, **và vì sao mỗi cái đang bật hay tắt**. Đó
thường mới là câu hỏi thật. Bỏ `--php` thì lấy phiên bản mà thư mục hiện tại resolve ra.

Bật một extension nghĩa là mọi tiến trình PHP của phiên bản đó đều nạp nó, kể cả pool.

## Gỡ một phiên bản

```bash
mix runtime uninstall php 8.1.31
```

Lệnh này bị từ chối khi còn project đã đăng ký đang pin phiên bản đó, và MixEngine sẽ nêu tên các
project ấy. Nó cũng bị từ chối khi pool php-fpm chạy từ phiên bản đó vẫn đang chạy. `--force` bỏ
qua được điều kiện thứ nhất, nhưng không bao giờ bỏ qua điều kiện thứ hai.
