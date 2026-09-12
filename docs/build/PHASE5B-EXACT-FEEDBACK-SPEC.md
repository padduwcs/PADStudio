# PADStudio — Đợt 5B: exact Result feedback và Agent resume

Ngày nghiệm thu: 2026-09-12.

## Mục tiêu

Khép các khoảng trống còn lại của Đợt 5 mà 5A chưa giải quyết: Agent đọc nhanh được trạng thái cần tiếp tục, người dùng xem/so sánh đúng từng render Result, và phản hồi qua chat được lưu bền vững vào đúng Result, sequence revision, segment và time range.

Web tiếp tục chỉ đọc. Agent host nhận phản hồi trong chat và ghi qua contract Decision hiện hữu; hệ thống không tạo thêm một kho feedback song song.

## Contract feedback

Decision Result giữ các field cũ và bổ sung:

```json
{
  "resultId": "result-...",
  "outcome": "changes_requested",
  "note": "Rút ngắn nhịp mở đầu.",
  "feedbackTarget": {
    "artifactId": "artifact-...",
    "revision": 10,
    "segmentId": "opening",
    "timeRange": { "startSeconds": 0.25, "endSeconds": 1.5 }
  },
  "resolvesDecisionIds": []
}
```

- Mọi Decision mới cho `video.sequence-render` bắt buộc có `feedbackTarget`.
- `artifactId` và `revision` phải đúng artifact mà exact Result đã render; revision lịch sử vẫn hợp lệ nếu đúng Result lịch sử.
- `segmentId`, nếu có, phải hiện diện cả trong sequence artifact và Result.
- `timeRange`, nếu có, phải nằm trong duration của sequence; khi có segment, range còn phải nằm trong khoảng của segment đó.
- Field lạ, range đảo/ngoài biên, Result/artifact/revision không khớp đều bị từ chối trước khi ghi.
- Decision cũ không có `feedbackTarget` vẫn đọc được để bảo toàn lịch sử.

Feedback `changes_requested` là pending cho đến khi một Decision `accepted` mới liệt kê ID của nó trong `resolvesDecisionIds`. Resolution là tường minh, append-only, chỉ thực hiện một lần và không được tự suy ra từ việc có render mới.

Ghi Decision được serialize bằng project-local file lock. Nhờ vậy timestamp vẫn đơn điệu, concurrent feedback không mất record và hai writer không thể cùng resolve một yêu cầu.

## Context cho Agent

Full context và summary đều có `pendingFeedback`; `resumeView` có `pendingFeedbackIds` và `pendingFeedbackCount`.

`project:context --view summary` không còn nhúng toàn bộ artifact data, tool schema hay analysis Result detail. Nó giữ:

- metadata và summary của active artifact;
- workflow/work item đủ để tiếp tục;
- capability/tool availability rút gọn;
- source analysis operation pointer, coverage/count/freshness;
- active sequence, toàn bộ exact render IDs và trạng thái quyết định;
- feedback chưa giải quyết.

Gate kích thước là tối đa 32 KiB trên pilot chuẩn; khi cần evidence hoặc lịch sử đầy đủ, Agent đọc full context hoặc analysis reader theo phạm vi.

## Observer exact Result

Mỗi sequence key có ba lựa chọn chỉ đọc:

1. sequence revision;
2. exact Result trong revision đó;
3. exact Result để đối chiếu, kể cả Result khác của cùng revision.

Panel luôn hiện Result ID và thời điểm tạo. Video, frame, review, decision và feedback anchor đều lấy từ Result đang chọn, không ngầm lấy phần tử cuối. Feedback toàn Result hiện ở panel; feedback segment/time chỉ hiện trên segment tương ứng.

## Acceptance

`npm run feedback:acceptance` kiểm tra:

- toàn bộ repository regression và source-analysis harness;
- persistence/reopen của exact feedback;
- mismatch revision, missing segment, range ngoài biên và thiếu target;
- explicit resolution cùng race hai writer;
- concurrent append và timestamp đơn điệu;
- pending feedback trong full/summary resume;
- Agent summary không quá 32 KiB trên pilot;
- browser chọn/so sánh exact Result, timeline/seek, player preservation, lazy sections và viewport 390/768/1440;
- không còn mutation lock sau test.

## Giới hạn đã chốt

- Web không ghi feedback trực tiếp; chat với Agent là kênh điều khiển duy nhất.
- Decision lịch sử thiếu target được giữ nguyên, không backfill bằng suy đoán.
- “Đã sửa” không đồng nghĩa “đã giải quyết”; chỉ `resolvesDecisionIds` đóng feedback.
