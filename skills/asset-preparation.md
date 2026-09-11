# Chuẩn bị nguyên liệu

Đọc context và direction hiện hành; xác định nguyên liệu thiếu và mục đích trước khi chọn tool.
Không bắt mọi project qua cùng danh sách nguyên liệu.

- graphic.render: thẻ chữ, biểu đồ dữ liệu hoặc sơ đồ bước. Gắn artifactIds làm căn cứ;
  giữ đúng số liệu, ghi nguồn ở footer khi cần. Xem PNG và chữ trên kích thước mục tiêu.
- audio.prepare: lấy một phần audio/video làm nguyên liệu; chọn track/range, gain/fade/loudness
  theo mục đích. Đây không phải TTS/khử nhiễu. Nghe kết quả trước khi đánh giá lời đọc.
- media.acquire: chỉ lấy URL file đã chọn; khai báo tác giả/giấy phép trung thực.
  Không suy ra quyền sử dụng chỉ vì download thành công. Không gửi URL chứa secret.
- Dùng resource/result IDs cho công cụ tiếp theo; không chọn đường output tùy ý.
- Ghi lựa chọn bằng decision/review/workflow hiện có. Bản mới không kế thừa approval cũ.
- Lỗi finalization_pending cần recover, không chạy lại tool.
- Nếu cần TTS/AI image/provider ngoài phạm vi, ghi rõ capability thiếu; không thay bằng một
  kết quả khác mà gọi đó là đạt.

Đặc tả: docs/build/ASSET-CAPABILITIES-SPEC.md.
