+++
title = "Tự chạy máy chủ đồng bộ"
slug = "self-hosting"
order = 18
summary = "Đồng bộ qua máy chủ của riêng bạn, chạy trên Cloudflare Workers hoặc trong container Docker, rồi trỏ MixLab vào đó."
translation_of = "en/self-hosting.md"
source_sha256 = "4de9e13ac0240995a9df115adadda9580dd6f80433e2796a482406652c3b09af"
+++

# Tự chạy máy chủ đồng bộ

MixLab mã hoá dữ liệu ngay trên máy bạn trước khi đồng bộ, nên máy chủ mặc định
`https://sync-0.lab.mixnz.com` giữ dữ liệu mà không đọc được. Tự chạy máy chủ thì ngay cả bản đã
mã hoá đó cũng nằm trong tay bạn. Máy chủ là mã nguồn mở, nằm ở thư mục
[`server/`](https://github.com/mixnz/mixlab/tree/master/server) trong repo của MixLab, và có hai
cách chạy.

## Trên Cloudflare Workers

Máy chủ mặc định chạy theo cách này, và gói miễn phí của Cloudflare đủ cho vài người dùng.

1. Fork [mixnz/mixlab](https://github.com/mixnz/mixlab).
2. Trong dashboard Cloudflare, tạo một Worker từ bản fork, thư mục gốc là **`server/worker/`**.
3. Trong **Settings → Variables and Secrets** của Worker, đặt `PEPPER` (32 byte ngẫu nhiên dạng
   base64) và `EMAIL_API_KEY` ở dạng secret, `EMAIL_FROM` và `EMAIL_PROVIDER` ở dạng variable.
4. Nhập địa chỉ Worker vào MixLab, như ở phần cuối trang.

[README của Worker](https://github.com/mixnz/mixlab/blob/master/server/worker/README.md#deploying-it-to-your-own-cloudflare-account)
có đủ các thiết lập và giới hạn của gói miễn phí.

## Trong container Docker

Image `ghcr.io/mixnz/mixlab-sync-server` chứa máy chủ trong một file chạy duy nhất và lưu dữ liệu
trong một file SQLite. Máy nào chạy được Docker là dùng được.

1. Tạo file `.env` với pepper và nhà cung cấp email:

   ```bash
   umask 077
   cat > .env <<EOF
   MIXLAB_SYNC_PEPPER=$(openssl rand -base64 32)
   MIXLAB_SYNC_EMAIL_FROM=noreply@example.com
   MIXLAB_SYNC_EMAIL_PROVIDER=resend
   MIXLAB_SYNC_EMAIL_API_KEY=
   EOF
   ```

2. Lưu file compose trong README thành `compose.yaml` cạnh đó, rồi chạy `docker compose up -d`.
3. Đặt một reverse proxy có TLS phía trước, rồi nhập địa chỉ của nó vào MixLab, như ở phần cuối
   trang.

**Chỉ tạo pepper một lần, và sao lưu nó cùng database.** Pepper đổi là mọi tài khoản trên máy chủ
đều không đăng nhập được nữa.
[README](https://github.com/mixnz/mixlab/blob/master/server/native/README.md#using-the-container-image)
có đủ cấu hình, cách sao lưu, và cách kiểm tra máy chủ bằng bộ conformance.

## Trỏ MixLab vào máy chủ của bạn

Trong **Cài đặt → Đồng bộ**, bấm **Thêm máy chủ** cạnh danh sách **Máy chủ**, nhập địa chỉ rồi bấm
**Thêm**. Địa chỉ phải bắt đầu bằng `https://`; `http://` chỉ dùng được cho máy chủ chạy trên chính
máy này. Sau đó tạo tài khoản trên máy chủ đó như với máy chủ mặc định.

Nếu bạn đang đồng bộ qua một máy chủ khác, dùng **Chuyển sang máy chủ khác**. MixLab chép tài khoản
cùng mọi thứ trong đó, vẫn ở dạng mã hoá, rồi đăng nhập bạn vào máy chủ mới.
