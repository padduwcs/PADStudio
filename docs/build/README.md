# Tài liệu phát triển PADStudio

Thư mục này dành cho **phát triển codebase**, không phải bootstrap cho Agent đang làm video.

## Tài liệu hiện hành bắt buộc

Chỉ coding Agent cần đọc theo thứ tự:

1. [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md) — mục tiêu và ranh giới sản phẩm.
2. [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md) — quyết định hiện hành đã chốt.
3. [`PADSTUDIO-DEVELOPMENT-STATUS.md`](PADSTUDIO-DEVELOPMENT-STATUS.md) — ảnh chụp trạng thái code/test gần nhất và cách xử lý tài liệu lệch thời điểm.
4. Phần liên quan trong [`PADSTUDIO-BUILD-OUTLINE.md`](PADSTUDIO-BUILD-OUTLINE.md) — bản đồ triển khai.
5. [`DEVELOPMENT-PROTOCOL.md`](DEVELOPMENT-PROTOCOL.md) — quy tắc thay đổi, xác minh và bàn giao.

`PADSTUDIO-CURRENT-DIRECTION.md` là sổ quyết định tích lũy: các đoạn có ngày và câu “ưu tiên tiếp
theo” mô tả thời điểm chúng được viết. Dùng trang trạng thái phát triển ở trên để biết mốc hiện tại;
không dùng một đoạn lịch sử nằm giữa file làm backlog mới.

## Tài liệu chỉ đọc khi liên quan

Các file `*-SPEC.md` và `PHASE*.md` ghi contract hoặc quyết định của từng lát cắt; chỉ mở file gắn trực
tiếp với phần code đang thay đổi. Các Package, roadmap và state report đã khép lại được tách vào
[`history/`](history/README.md), không phải danh sách việc mặc định.

Các mốc thường bị đọc nhầm là trạng thái hiện hành:

- [`PADSTUDIO-STATE-AND-NEXT.md`](history/PADSTUDIO-STATE-AND-NEXT.md) — snapshot tích lũy đến 2026-09-17;
- [`PADSTUDIO-V1-COMPLETION.md`](history/PADSTUDIO-V1-COMPLETION.md) — báo cáo hoàn tất một mốc implementation ngày 2026-09-14;
- [`PADSTUDIO-ROADMAP.md`](history/PADSTUDIO-ROADMAP.md) — lộ trình sáu đợt và kết quả practical tại thời điểm đóng đợt;
- `reports/` và `eval/**/reports/` — evidence bất biến của từng lần acceptance/evaluation.

Index lịch sử được giữ tại [`HISTORICAL-DOCUMENTS.md`](HISTORICAL-DOCUMENTS.md). Agent vận hành
project video không đọc thư mục này; dùng [`../../PADSTUDIO-AGENT-RUNTIME.md`](../../PADSTUDIO-AGENT-RUNTIME.md).
