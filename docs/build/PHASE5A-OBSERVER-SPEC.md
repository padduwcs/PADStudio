# PADStudio — Đợt 5A: observer hiệu quả và phản hồi gắn phiên bản

Cập nhật: **2026-09-12**. Trạng thái: **đã triển khai và nghiệm thu practical trên pilot hiện hành**.

## Kết quả cần giữ

Observer vẫn chỉ đọc và Agent host vẫn là nơi nhận yêu cầu. Người dùng có thể theo dõi project mà polling không thay DOM/player khi dữ liệu không đổi, mở phần chi tiết khi cần, so sánh các revision sequence và sao chép một mốc phản hồi trỏ đúng Result, artifact, revision, segment và khoảng thời gian.

Đợt này không thêm provider, capability sản xuất, web mutation, chat client hay timeline chỉnh sửa.

## Snapshot observer

`GET /api/projects` trả metadata project kèm `generation`. Generation là SHA-256 của danh sách metadata file bền vững trong project; nội dung media không bị đọc lại. `.locks` và file tạm ẩn của atomic write không tham gia generation; project skill vẫn làm generation thay đổi.

Các endpoint chỉ đọc theo khu vực:

- `/api/projects/:id/observer/summary`: checkpoint, resume, workflow/work item hiện hành và các chỉ số;
- `/api/projects/:id/observer/source`: resource, Result cần để phát nguồn, analysis summary và source artifact hiện hành;
- `/api/projects/:id/observer/creative`: brief/proposal/direction, review/decision và liên kết sequence;
- `/api/projects/:id/observer/production`: sequence, render, timeline, segment và dependency state;
- `/api/projects/:id/observer/activity`: resource, Result, Run, artifact và review chi tiết.

Mọi snapshot có `generation`, `view` và ETag. Client gửi `If-None-Match`; project không đổi nhận `304` không body. Summary và production được tải khi chọn project; source, creative và activity dùng `IntersectionObserver` để tải khi tiến gần viewport. Các section cùng generation dùng chung một lần dựng context phía server.

Endpoint full cũ vẫn được giữ để tương thích CLI/test nhưng workspace không dùng nó.

## Bảo toàn trạng thái giao diện

Danh sách project tiếp tục được kiểm tra mỗi hai giây bằng conditional request. Khi list trả `304`, không section nào render lại. Khi generation đổi, chỉ các section đã từng mở được cập nhật. `renderProduction` tiếp tục so signature nên playback không bị thay nếu production snapshot tương đương.

Mỗi render có mốc phản hồi dạng:

```text
project=<id> · result=<id> · artifact=<id> · revision=<n>
```

Mỗi segment bổ sung `segment=<id> · time=<start>-<end>`. Nút sao chép chỉ đưa mốc này vào clipboard để người dùng gửi qua chat; nó không ghi decision/review và không ngụ ý approval.

## Đồng thời và revision

Mutation artifact, workflow và review dùng lock file cấp project với tạo file độc quyền, timeout và thu hồi lock stale. Phạm vi lock là toàn bộ loại record để giữ cả invariant liên key như “một current sequence”.

- Artifact có `expectedRevision` dùng compare-and-swap trong lock.
- Mọi lần sửa workflow bắt buộc có `expectedRevision` khớp revision mới nhất; tạo mới có thể bỏ qua hoặc gửi `0`.
- Review cùng target được tuần tự hóa trước khi tính round.

Writer stale thất bại và phải đọc lại; không tự merge hay ghi đè.

## Nghiệm thu

Chạy:

```powershell
npm run observer:acceptance
```

Acceptance gồm toàn bộ repository regression, analysis harness, race tests, API ETag/invalidation/payload và browser smoke ở 390/768/1440 px. Browser kiểm tra seek timeline, player không bị polling thay, không gọi endpoint full, section tải lười đúng một lần và mốc feedback gắn exact revision.

Kết quả pilot tại thời điểm nghiệm thu:

- 171/171 repository tests và 20/20 analysis tests pass;
- project list 696 byte, summary 6.028 byte, production 75.130 byte, full context cũ 424.020 byte;
- các conditional request list/summary/production đều trả `304` rỗng khi project không đổi;
- pilot `phase3-vd04-asset-pilot`, sequence `pilot-preview` r10 và Result đã duyệt được giữ nguyên.

Bằng chứng máy đọc được: [`reports/phase5a-observer-acceptance.json`](../../reports/phase5a-observer-acceptance.json).

## Điểm bàn giao sang Đợt 5B

Acceptance của tài liệu này chỉ đóng **Đợt 5A**, không tự đóng toàn bộ Đợt 5. Các outcome còn thiếu:

- `project:context --view summary` của Agent vẫn còn lớn và còn nhúng capability/analysis/artifact detail;
- production view chọn sequence revision nhưng chưa chọn hoặc so sánh các exact render Result trong cùng revision;
- mốc feedback segment/time mới là dữ liệu sao chép, chưa là record được validate, lưu bền vững và đưa lại vào Agent context/UI.

Đợt 5B phải khép ba khoảng trống trên và có acceptance reopen/stale-target trước khi đánh giá chuyển sang Đợt 6A.

## Giới hạn đã công bố

- Generation hiện quét metadata file theo polling, chưa dùng filesystem watcher, SSE hay WebSocket.
- Payload chi tiết chỉ tải khi cần nhưng backend vẫn dựng một full context dùng chung cho generation đó.
- Web không nhận phản hồi trực tiếp; người dùng sao chép mốc và trao đổi với Agent trong chat.
- Lock được thiết kế cho project local; chưa tuyên bố hỗ trợ filesystem phân tán.
