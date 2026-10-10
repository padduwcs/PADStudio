# Lịch sử thay đổi

Theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). PADStudio chưa phát hành chính thức; mọi thay đổi dưới đây nằm trên
nhánh `main`. Chi tiết kỹ thuật và số liệu kiểm thử từng mốc: [`docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md`](docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md).

## [Chưa phát hành]

### Thêm
- Giấy phép MIT, hướng dẫn đóng góp, chính sách bảo mật, quy tắc ứng xử, mẫu issue và pull request, README tiếng Anh.
- [`docs/CAI-DAT-RUNTIME.md`](docs/CAI-DAT-RUNTIME.md): cài Remotion, HyperFrames, Chrome Headless Shell, Manim và Piper với phiên bản ghim và
  checksum; gói npm của hoạt họa được ghim trong `runtime/animation/`.

### Sửa
- File `padstudio.local.json` lưu có BOM (Windows PowerShell 5.1, Notepad) không còn bị coi là không hợp lệ.

## [0.1.0] - 2026-10-10 (mốc đầu tiên, chưa gắn tag)

Điểm khởi đầu của repo công khai. Tóm tắt những gì đã có:

### Lõi
- Kho dự án cục bộ: tài nguyên, lần chạy, kết quả có mã kiểm tra, artifact có phiên bản, workflow thích nghi, review, quyết định, checkpoint,
  khôi phục sau lỗi, lưu trữ dự án, và dọn dẹp sau khi chốt (`project:finish`).
- Bộ thực thi dùng chung cho mọi công cụ, có ước tính chi phí, phê duyệt dùng một lần cho dịch vụ trả phí, và trần credit theo dự án
  (`project:credits`).
- Bản giao (delivery) giữ nguyên từng byte của video đã chốt.

### Công cụ
- FFmpeg: cắt, ghép, đổi khung hình, ảnh đại diện, chèn âm thanh, phụ đề, video từ ảnh, dựng sequence nhiều đoạn.
- Hoạt họa bằng code: Manim, Remotion, HyperFrames, có kiểm tra, preflight, preview và render theo đúng phiên bản.
- Giọng đọc: Piper (cục bộ) và ElevenLabs (có chọn giọng, model và tìm giọng trên trang web).
- Hiểu tư liệu quay sẵn: thông số, khung hình, âm thanh, cắt cảnh, phiên âm; tìm ảnh/video Wikimedia kèm giấy phép.
- Kiểm tra chất lượng đầu ra, 20 skill hướng dẫn Agent, 5 phong cách và 4 hồ sơ xuất.

### Trang xem (web cục bộ)
- Thư viện dự án, xem video, so sánh phiên bản, nhảy theo đoạn, sao chép mốc phản hồi, tải bản đã chốt, giao diện sáng/tối, điện thoại.
- Trang **Công cụ** với ba tab (tổng quan, giọng đọc, dịch vụ của bạn): xem công cụ nào đã sẵn sàng, dán khóa API, chọn model và giọng.
- Chỉ nghe trên `127.0.0.1`, từ chối `Host` lạ, và chỉ ghi cài đặt máy (không bao giờ ghi dự án).

### Chất lượng
- CI trên Windows (`npm run check` và toàn bộ test), annotation lỗi đọc được công khai, các browser test trên Chrome thật.
