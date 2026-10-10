# Chính sách bảo mật

## Báo lỗi bảo mật

**Đừng mở issue công khai** cho lỗ hổng bảo mật. Hãy dùng
[báo cáo riêng tư của GitHub](https://github.com/padduwcs/PADStudio/security/advisories/new)
(tab *Security* → *Report a vulnerability*). Nếu không dùng được, hãy mở một issue **không có chi tiết kỹ thuật** nói rằng bạn
cần liên hệ riêng về bảo mật, người duy trì sẽ trả lời để thống nhất kênh.

Hãy cho biết: phiên bản hoặc commit, các bước tái hiện, tác động bạn thấy và (nếu có) cách giảm thiểu. Đây là dự án cá nhân do một
người duy trì; mục tiêu là phản hồi trong vòng 7 ngày và sửa lỗi nghiêm trọng sớm nhất có thể, không có cam kết thời hạn chính thức.

## Phiên bản được hỗ trợ

Chỉ nhánh `main` được sửa lỗi bảo mật. Dự án ở phiên bản 0.1, chưa có bản phát hành ổn định.

## Mô hình an toàn: PADStudio chạy trên máy của bạn

PADStudio là công cụ **chạy cục bộ cho một người dùng**, không phải dịch vụ cho nhiều người. Hãy hiểu rõ các điểm sau trước khi dùng.

- **Web observer chỉ nghe trên `127.0.0.1`**, từ chối mọi request có `Host` không phải localhost, và chỉ nhận ghi cài đặt từ chính
  trang PADStudio (cùng Origin, JSON và header riêng). Đừng đưa nó ra mạng bằng reverse proxy hoặc tunnel: nó không có đăng nhập.
- **Khóa API** (ví dụ ElevenLabs) lưu dạng văn bản thường (không mã hóa) trong `padstudio.local.json` ở thư mục dự án, bị Git bỏ qua. Ai đọc được file
  đó là dùng được khóa. Web không bao giờ trả lại khóa và PADStudio không đưa giá trị khóa vào context của Agent; tuy nhiên một Agent có quyền đọc file trên máy bạn vẫn đọc được `padstudio.local.json`. Đừng dán khóa vào chat. Hãy đặt
  giới hạn credit ngay ở nhà cung cấp, và đổi khóa nếu nghi ngờ lộ.
- **Hoạt họa bằng code chạy mã do Agent sinh ra trên máy bạn** (Manim, Remotion, HyperFrames). PADStudio kiểm tra tĩnh và chạy trong
  thư mục tạm với biến môi trường đã lọc, nhưng **đây không phải sandbox** và chưa cách ly mạng. Chỉ dùng Agent mà bạn tin cậy, và xem
  lại nội dung nếu nó đến từ nguồn bên ngoài.
- **Phê duyệt chi phí và "chốt" video do Agent ghi lại theo lời bạn nói trong chat**, không phải xác thực mật mã. Chúng ngăn lỗi vô
  ý, không ngăn một Agent cố tình làm sai.
- **Dữ liệu dự án** (video, âm thanh, kịch bản, tư liệu bạn đưa vào) nằm trong `.padstudio/` trên máy bạn và không bao giờ được gửi đi
  trừ khi bạn dùng một dịch vụ bên ngoài (ví dụ gửi văn bản tới ElevenLabs để tạo giọng).

## Phạm vi

Trong phạm vi: lỗi cho phép trang web bên ngoài đọc hoặc ghi dữ liệu qua observer, lộ khóa API, thoát khỏi thư mục project qua đường
dẫn, ghi ngoài kho project. Ngoài phạm vi: Agent sinh mã độc khi bạn chủ động chạy nó, lỗi của FFmpeg, Remotion, Manim, HyperFrames,
Piper hay nhà cung cấp dịch vụ (hãy báo cho họ).
