# Lịch sử thay đổi

Theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/). Các bản phát hành nằm ở [Releases](https://github.com/padduwcs/PADStudio/releases). Chi tiết kỹ thuật và số liệu kiểm thử từng mốc: [`docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md`](docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md).

## [Chưa phát hành]

- Giọng ElevenLabs có hệ số giá riêng (thường là giọng từ Voice Library) giờ chọn và dùng được. Ước tính credit ghi rõ là mức tối thiểu,
  mỗi lần tạo vẫn cần phê duyệt riêng và số credit thực tế được ghi lại sau khi tạo. Với loại giọng này, trần credit của dự án chỉ chặn được
  sau lần vượt, không chặn trước.
- **Tạo giọng ít tốn kém hơn, ít đọc sai hơn.** `tool:plan` của `tts.synthesize` trả `inputReview`: những chỗ lời có thể bị đọc sai (số,
  ký hiệu, chữ cái lẻ, tên file, markup, lỗi mã hóa, từ viết tắt, từ lặp) trước khi tốn credit, chỉ để tham khảo. Ước tính credit của giọng có
  rate riêng được đo lại từ chi phí thực của các lần tạo trước cùng giọng và model (`calibrated`), thay vì mức tối thiểu có thể lệch gấp
  nhiều lần. `withTimestamps` (tắt mặc định) lấy thời điểm từng từ ngay trong lần tạo; chưa thử với ElevenLabs thật.
- **Hướng dẫn Agent đặt mình vào người xem.** Tài liệu vận hành, skill intake, review, hình họa và lời dẫn nay lấy một người xem lần đầu làm
  thước đo thay vì chỉ kiểm yêu cầu. Skill `voice-narration` viết lại: viết lời cho người nghe, giải thích vì sao trước cách làm, tạo cả
  bài một lần, mẫu thử là đoạn rủi ro nhất.
- Sửa: helper ASR đọc request bằng UTF-8 (glossary có "mười ba" từng làm công cụ dừng với `TextInputSequence must be str`);
  `animation.source` ở chế độ `revise` tự lấy runtime và entry từ bản gốc; gọi trực tiếp tool phân tích bằng `tool:run` bị từ chối ngay với
  hướng dẫn dùng `project:analyze` (tài liệu cho Agent trước đây không nhắc lệnh này).

## [0.1.0] - 2026-10-10

Bản phát hành đầu tiên (pre-release) của repo công khai. Tóm tắt những gì đã có:

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

### Dự án mã nguồn mở
- Giấy phép MIT, hướng dẫn đóng góp, chính sách bảo mật, quy tắc ứng xử, mẫu issue và pull request, README tiếng Việt và tiếng Anh.
- [`docs/CAI-DAT-RUNTIME.md`](docs/CAI-DAT-RUNTIME.md): cài Remotion, HyperFrames, Chrome Headless Shell, Manim và Piper với phiên bản ghim và
  checksum (đã chạy thử trên bản clone sạch); gói npm của hoạt họa được ghim trong `runtime/animation/`.
- File `padstudio.local.json` lưu có BOM (Windows PowerShell 5.1, Notepad) vẫn đọc được.

### Chất lượng
- CI trên Windows (`npm run check` và toàn bộ test), annotation lỗi đọc được công khai, các browser test trên Chrome thật.
