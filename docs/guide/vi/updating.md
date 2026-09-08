+++
title = "Giữ MixEngine luôn mới"
slug = "updating"
order = 12
summary = "Cập nhật do bạn quyết, có kiểm tra chữ ký, và có chạy thử trước khi thay bất cứ thứ gì. Riêng một chương trình cố ý không bao giờ được thay theo đường này."
translation_of = "en/updating.md"
source_sha256 = "02cd1265a99c4f8651adc1855e52d22967616eec9823348f299403643e262b2d"
+++

# Giữ MixEngine luôn mới

> **Đây là tài liệu hướng dẫn dùng MixEngine qua dòng lệnh `mix`.** Nếu bạn muốn thao tác bằng
> giao diện đồ họa cho dễ hơn thì bạn đã có sẵn: mọi bộ cài đều đặt **MixLab**, ứng dụng desktop
> của MixEngine, ngay cạnh dòng lệnh. MixLab làm việc trên cùng một MixEngine, nên mọi khái niệm
> trong cẩm nang này vẫn áp dụng.

```bash
mix self-update --check
mix self-update
```

`--check` in ra bản có sẵn, gồm phiên bản, dung lượng và những gì đã thay đổi, và không cài gì.
Không có `--check` thì cũng hiện đúng thông tin đó, rồi hỏi bạn có cập nhật không.

## Cập nhật không bao giờ âm thầm

Cập nhật sẽ khởi động lại các service bạn đang chạy. Vì thế đó là việc bạn chọn, không phải việc
xảy ra với bạn giữa lúc đang làm, nên **không có gì được cài mà không hỏi**. Daemon có kiểm tra
lặng lẽ, lúc khởi động và mỗi ngày một lần, để `mix status` báo được cho bạn là có bản mới. Cả hai
lần kiểm tra đều thất bại trong im lặng nếu không có mạng: máy không có mạng không phải máy có vấn
đề.

`--yes` trả lời trước câu hỏi, dành cho script chạy khi không có ai ở bàn phím.

## Chuyện gì xảy ra khi bạn đồng ý

Theo thứ tự, và không bước nào bỏ qua được:

1. Bản phát hành được tải về và đối chiếu hash với feed cập nhật **có chữ ký**. Payload không khớp
   thì không được giải nén.
2. Chữ ký được kiểm tra bằng khóa công khai biên dịch sẵn trong MixEngine. Không có gì ở tầng
   truyền tải được tin để quyết định một file có phải của chúng tôi hay không.
3. **Bản `mixengined` mới được chạy thử một lần** trước khi thay bất cứ gì, để chắc máy này khởi
   động được nó. Một bản cập nhật sẽ để lại daemon không chạy được thì bị chặn ở đây, thay vì phát
   hiện ra sau.
4. Những gì đang chạy được dừng, các file thực thi được thay, và daemon thoát.
5. `mix` khởi động daemon mới, và daemon khởi động lại service của bạn.

## Chương trình duy nhất không bao giờ bị đụng tới

`mixengine-elevate` chạy với quyền quản trị, nên thay nó là một hành động đặc quyền.
`mix self-update` cố ý để nguyên nó.

```bash
mix elevation upgrade
```

Đó là hành động riêng, có chủ đích. Lệnh này tải chương trình phụ trợ mà bản phát hành này công
bố, kiểm tra chữ ký của MixEngine trên đó, chạy thử một lần để chắc nó khởi động được, rồi đưa bản
thay thế vào hàng đợi. **Lệnh này không cài gì cả**: `mix elevation grant` mới là lệnh hiện hộp
thoại xin quyền, và chương trình phụ trợ đang cài sẽ tự kiểm tra chữ ký thêm lần nữa trước khi cho
phép bất cứ gì ghi đè lên nó.

Trong lúc đó, bản cũ và bản mới cùng tồn tại an toàn. Daemon và chương trình phụ trợ thỏa thuận
phiên bản giao thức khi nói chuyện với nhau. Chương trình phụ trợ cũ vẫn phục vụ các thao tác nó
biết, trong khi MixEngine nhắc bạn nâng cấp nó.

## Khi MixEngine được cài bằng trình quản lý gói

`mix self-update` từ chối, nói rõ lý do, và nêu tên thư mục. Đó là hành vi đúng chứ không phải vô
ích: bản cài bằng `apt`, `dnf` hay `.pkg` thuộc về trình quản lý gói đó. Thay file sau lưng nó sẽ
khiến hồ sơ của hệ thống mô tả một thứ không còn ở đó nữa. Hãy cập nhật theo đúng cách bạn đã cài.

Bản zip portable, AppImage, bộ cài Windows theo người dùng và bản build từ mã nguồn đều cập nhật
bình thường bằng `mix self-update`.

## Phiên bản

MixEngine dùng semantic versioning, một số phiên bản chung cho mọi thứ nó phát hành. Trước 1.0, API
có thể thay đổi không tương thích giữa các phiên bản minor, và mỗi thay đổi như vậy được liệt kê
trong changelog. Đó chính là thứ `mix self-update --check` in ra trước khi hỏi bạn.
