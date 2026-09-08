# Source Understanding — gói B: hợp đồng và vòng đời

Trạng thái: **đã triển khai**. Tài liệu này ghi contract thực tế của gói B theo
[`SOURCE-UNDERSTANDING-SPEC.md`](SOURCE-UNDERSTANDING-SPEC.md), không thay thế đặc tả toàn đợt.
Quyết định sử dụng gói A tại §18 vẫn giữ nguyên: `large-v3-gpu-fp16` là
`practicalDefault`, không cần dataset riêng để bắt đầu sử dụng và không tuyên bố đã đạt gate
holdout rộng.

## Phạm vi đã có

- Source `resource` hoặc `result` được resolve qua `ProjectStore`; resource folder được mở rộng
  thành snapshot file cụ thể trước khi chạy.
- `sourceKey` là SHA-256 của canonical JSON `{projectId, source}`; `sourceVersion` là SHA-256
  toàn bộ bytes được đọc streaming. File đơn chuẩn hóa `itemPath: null`; Result luôn giữ file ID.
- Contract time dùng interval `[startSeconds,endSeconds)`, số giây hữu hạn và helper đổi PTS theo
  rational time base/stream offset. Không suy timestamp từ nominal FPS.
- Metadata Result của sáu loại bằng chứng được validate strict, giới hạn 32 KiB và bắt buộc giữ
  `contentReview: "not_performed"`. Payload lớn phải đi qua file dataset đã đăng ký.
- Mọi file của Result phân tích có SHA-256 do `ProjectStore` tự tính sau khi output được commit. Reuse kiểm
  tra lại checksum, không chỉ dựa vào path hoặc size.
- Job manifest có revision, source snapshot, unit/dependency, method/fingerprint, attempt, Run,
  Result, warning, trạng thái, owner lease và yêu cầu hủy.
- Một writer giữ exclusive lease theo project. Lease lưu PID, process-start identity, owner token
  và heartbeat; acquisition claim bất biến theo token serialize các contender trước khi takeover,
  writer còn sống gây conflict, lease chết được lưu vào archive trước khi thay thế.
- Mỗi unit chạy qua `ToolExecutor`. Hook nội bộ ghi Run ID vào attempt trước khi tool chạy; hook lỗi
  kết thúc Run failed và không gọi tool. Hash nguồn được kiểm tra lại trước khi commit Result.
- Resume đối soát Result/Run với manifest. Result đã durable được dùng để hoàn tất/recover Run và
  không chạy tool lần hai nếu lần ghi manifest sau Result bị lỗi. Trước khi dùng lại unit đã thành
  công, resume xác minh source, method, dependency provenance và checksum; bằng chứng không còn
  current bị bỏ khỏi active unit nhưng Result/attempt lịch sử không bị xóa.
- Fingerprint bind source logic, source bytes, range/track/options/profile, identity tool/runtime và
  Result/checksum upstream. Đổi tool hoặc dependency chỉ làm mất hiệu lực unit liên quan.
- Cancel là yêu cầu bền vững; coordinator đang chạy nhận `AbortSignal`, dừng unit hiện hành theo
  khả năng của adapter và đánh dấu các unit còn lại cancelled.

## Dữ liệu trong project

```text
.padstudio/projects/<id>/analysis/
├── jobs/<analysis-id>.json
├── indexes/
├── cancellations/<analysis-id>.json
└── leases/
    ├── writer.json
    └── archive/
```

`indexes/` được tạo sẵn nhưng reader/search thuộc gói D. Project mới có layout này ngay khi khởi
tạo; project cũ không có `analysis/` vẫn mở bình thường và được tạo layout khi gói B cần dùng.

Job state: `planned`, `running`, `completed`, `partial`, `failed`, `interrupted`, `cancelled`.
Unit state: `pending`, `running`, `succeeded`, `reused`, `not_applicable`, `blocked`, `failed`,
`cancelled`. Thiếu tool/package là `blocked`, không phải `not_applicable`; job không có bằng chứng
hữu ích kết thúc `failed`, còn job có bằng chứng độc lập dùng được kết thúc `partial`.

## CLI vòng đời

```powershell
$request | npm run project:analyze -- <project-id> -
npm run analysis:resume -- <project-id> <analysis-id>
npm run analysis:cancel -- <project-id> <analysis-id>
```

Request dùng schema §10.1 của đặc tả và phải nêu `operations` rõ ràng. Planner tự thêm dependency
kỹ thuật, ví dụ `probe` trước `transcript`; nó không thêm workflow sáng tạo hay tự phân tích mọi
file khi import.

Lệnh run/resume trả exit code `0` khi `completed`; `1` khi request không hợp lệ, hệ thống lỗi hoặc
có unit thực thi `failed`; `2` khi `partial/interrupted/cancelled` hoặc job thất bại chỉ vì các unit
đang `blocked`. Stdout là JSON; lỗi CLI ở stderr.

## Ranh giới còn lại

Gói B không cài hoặc đăng ký sáu adapter production. Cho đến khi gói C hoàn thành,
`project:analyze` với default registry sẽ giữ job và báo unit `blocked`; không tự gọi harness gói A,
không tải model và không fallback sang profile khác. Việc dừng cây tiến trình FFmpeg/Python thật
phải được adapter gói C nối với `AbortSignal` đã có.

Artifact `source.profile`/`source.assessment`/`source.transcript-edit`, reader/search/summary và skill
thuộc gói D; observer thuộc gói E; holdout/long-run cuối cùng thuộc gói F. Gói B không đổi workflow,
checkpoint, decision hoặc quyền web.

## Kiểm tra

Test chuyên biệt bao phủ canonical fingerprint dùng chung Node/Python, timebase, source logic khác
nhau dù bytes giống nhau, folder snapshot, lease conflict/takeover, dependency, tool-version,
environment drift và upstream invalidation, source đổi giữa run, checksum bị sửa trước cache lẫn
resume, takeover race có interleaving kiểm soát, cancel, hook lỗi, Result/job schema và resume sau
fault injection trước Run lẫn ở ranh giới Result/manifest.

Chạy:

```powershell
npm test
npm run analysis:test
```

Hai lỗi concurrency/freshness phát hiện trong
[`SOURCE-UNDERSTANDING-PACKAGE-B-REVIEW.md`](SOURCE-UNDERSTANDING-PACKAGE-B-REVIEW.md)
đã được tái hiện và khóa bằng regression chính thức nêu trên.
