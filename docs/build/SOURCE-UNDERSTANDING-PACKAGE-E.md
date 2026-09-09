# Source Understanding — gói E: workspace observer

Cập nhật: **2026-09-09**. Tài liệu này ghi phạm vi thực tế sau khi triển khai gói E.
Đặc tả toàn đợt vẫn là [SOURCE-UNDERSTANDING-SPEC.md](SOURCE-UNDERSTANDING-SPEC.md);
đường đọc mà UI sử dụng được chốt tại
[SOURCE-UNDERSTANDING-PACKAGE-D.md](SOURCE-UNDERSTANDING-PACKAGE-D.md).

## Phạm vi đã hoàn thành

Observer có một workspace chỉ đọc để người dùng kiểm tra tư liệu và bằng chứng mà Agent đã tạo:

- chọn từng nguồn đã phân tích, thấy tên, loại, vai trò và freshness;
- phát nguồn gốc hoặc ưu tiên Result `source.preview` browser-safe khi có;
- timeline luôn dùng source time, kể cả khi player đang phát proxy theo một range;
- hiển thị coverage riêng cho preview, transcript, scene, frame và audio;
- xem transcript, scene, frame, audio và assessment theo từng Result set;
- chọn rõ profile/range khi một nguồn có nhiều Result cùng operation;
- chuyển giữa raw ASR, bản hiệu chỉnh và chế độ đối chiếu cả hai;
- bấm timestamp/frame/waveform/finding để đi đến đúng vị trí nguồn;
- tìm transcript và assessment qua search index đã được verify;
- phân biệt observation/inference, certainty, limitation và open question;
- phân trang/lazy-load qua reader API thay vì nạp toàn bộ JSONL;
- giữ nguyên player và vị trí phát qua chu kỳ polling khi context có ý nghĩa không đổi;
- hủy request cũ khi đổi project, nguồn, view hoặc tìm kiếm để response cũ không ghi đè UI mới;
- deep-link project bằng `?project=<project-id>`.

Gói E không thêm endpoint mutation, không chạy phân tích hoặc verify ngầm và không đọc trực tiếp
file JSONL. Khi thiếu proxy hay search index, UI hướng dẫn yêu cầu Agent thực hiện thao tác tương ứng.

## Luồng dữ liệu và trạng thái

`ui/source-analysis-view.js` nhận production context từ observer và chỉ gọi:

- `GET /api/projects/<id>` để đồng bộ project/context;
- `GET /api/projects/<id>/analysis/query?...` cho view/search phân trang;
- route file project đã đăng ký để phát input, preview và frame.

Source summary/result set/freshness đến từ reader gói D; UI không tạo bản sao trạng thái bền vững.
Mỗi workspace giữ state tương tác trong bộ nhớ trình duyệt. Một chữ ký context gồm project,
resource version, source/result freshness và revision artifact quyết định khi nào cần render lại.
Polling không thay media element nếu dữ liệu đó không đổi.

Nếu timestamp nằm ngoài range của proxy hiện có, UI không giả seek và không tự sinh proxy:
nó giữ source time và báo người dùng yêu cầu Agent tạo preview cho range đó.

## Khả năng truy cập và responsive

Các điều khiển dùng button/select/range thật, có nhãn ARIA và focus-visible. Source list và tab
được cuộn nội bộ trên màn hình hẹp; card có metadata/path dài được co và wrap đúng ranh giới.
Bố cục đã được kiểm tra không tràn ngang tại 390, 768 và 1440 px.

Browser smoke test dùng Chrome hoặc Edge qua Chrome DevTools Protocol, không thêm dependency:

```powershell
npm start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/source-observer-browser-smoke.ps1 -ProjectId <project-id-có-dữ-liệu-phân-tích>
```

Test xác nhận workspace/player/timeline/evidence tồn tại, transcript được lazy-load thật,
timestamp có thể seek, polling không thay player và ba viewport không tràn ngang.
Project được chọn phải có ít nhất một nguồn với preview, timeline và transcript để chạy gate này.

## Kiểm tra tự động

- `test/source-analysis-view.test.js`: định dạng source time, coverage interval, URL query an toàn
  và chọn Result set theo operation/profile/range.
- `test/project-reader.test.js`: HTML section và module tĩnh được server phục vụ.
- `scripts/source-observer-browser-smoke.ps1`: acceptance trên browser thật với project local.

## Giới hạn và phần để gói F

Gói E là observer kiểm tra bằng chứng, chưa phải editor timeline hoặc nơi gửi lệnh cho Agent.
Nó không tự tạo preview/index, không phát media ngoài file đã đăng ký và không thay thế chat.
Search hiện là lexical index của gói D; chưa có vector search, OCR hoặc speaker diarization.

Gói F còn phải nghiệm thu toàn phân hệ: luồng mới/mở lại, nguồn dài và pagination/range,
cancel/resume/reconcile cùng lỗi runtime, stale/missing/tampered data, regression các capability cũ,
browser acceptance có fixture được kiểm soát, và tổng hợp rõ gate chất lượng nào đã đo hay chưa đo.
