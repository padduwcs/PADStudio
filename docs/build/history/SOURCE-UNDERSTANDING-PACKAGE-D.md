# Source Understanding — gói D: hiểu biết và truy xuất

Cập nhật: **2026-09-09**. Tài liệu này ghi contract thực tế sau khi triển khai gói D.
Đặc tả tổng thể vẫn là [SOURCE-UNDERSTANDING-SPEC.md](../SOURCE-UNDERSTANDING-SPEC.md).

## Phạm vi đã hoàn thành

Gói D nối các Result phân tích của gói B/C thành một đường đọc và một lớp hiểu biết
có bằng chứng:

- reader dùng chung cho CLI, project context và observer API;
- đọc transcript, scene, frame, audio theo nguồn/Result, khoảng thời gian và cursor;
- tìm văn bản tiếng Việt trong transcript, bản hiệu chỉnh và assessment;
- summary gọn cho Agent mở lại project mà không nạp toàn bộ JSONL;
- ba artifact chuyên biệt có revision: `source.profile`, `source.assessment`,
  `source.transcript-edit`;
- verify tường minh để phát hiện source/file hiện hành, stale hoặc missing;
- cảnh báo freshness đi vào production context;
- skill/runtime guide hướng dẫn Agent phân biệt quan sát, suy luận và phần chưa review.

Gói này không thêm model phân tích, không thay Result máy gốc, không biến assessment
thành nhãn gold và không cho web sửa project.

## Đường đọc

Các view được hỗ trợ:

| View | Bộ lọc chính | Kết quả |
| --- | --- | --- |
| `summary` | `sourceKey` tùy chọn khi verify | nguồn, result set theo version/operation/profile/range, job, assessment, freshness |
| `transcript` | `sourceKey` hoặc `resultId`, range, mode | segment raw/corrected/both |
| `scenes` | `sourceKey` hoặc `resultId`, range | scene rows |
| `frames` | `sourceKey` hoặc `resultId`, range | frame mapping rows |
| `audio` | `sourceKey` hoặc `resultId`, range | audio-analysis rows |
| `assessment` | `sourceKey` tùy chọn | artifact assessment active mới nhất theo key |
| `search` | `text`, source/range tùy chọn | transcript/assessment/finding có snippet |
| `job` | `jobId` | snapshot job phân tích |

Query có `version: "1.0"`, `limit` mặc định 50 và tối đa 200. Cursor được ký bằng
fingerprint của dataset/query; khi Result, artifact hoặc index đổi, cursor cũ bị từ chối
với `cursor_stale`. Reader stream JSONL, chỉ giữ một trang kết quả trong RAM.
Khi query bằng `sourceKey` khớp nhiều Result/profile/range, reader không tự lấy “mới nhất”:
Agent chọn `resultId` từ `summary.resultSets` hoặc thu hẹp range/job.

Ví dụ:

```powershell
npm run analysis:read -- <project-id> '{"view":"summary"}'
npm run analysis:read -- <project-id> '{"view":"transcript","resultId":"result-...","limit":50}'
npm run analysis:read -- <project-id> '{"view":"search","text":"thuật toán","diacriticInsensitive":true}'
npm run project:context -- <project-id> --view summary
```

Observer dùng cùng service:

- `GET /api/projects/<id>/analysis`
- `GET /api/projects/<id>/analysis/query?...`
- `GET /api/projects/<id>?view=summary`

Route chỉ đọc. Validation trả 400, Result không tồn tại trả 404, cursor/index/dataset
stale trả 409.

## Verify, freshness và search index

```powershell
npm run analysis:verify -- <project-id>
npm run analysis:verify -- <project-id> '{"resultId":"result-..."}'
```

Verify hash lại source hiện hành và file đã đăng ký, rồi ghi cache dẫn xuất dưới
`analysis/indexes/`. Nó không sửa hoặc viết lại Result lịch sử. Trạng thái:

- `verified_current`: sourceVersion và checksum file còn khớp;
- `stale`: source hoặc file đã đổi;
- `missing`: source hoặc file không còn resolve được;
- `unchecked`: chưa có lần verify tường minh áp dụng.

Search index chỉ được dựng trong verify, không tự dựng ngầm khi query. Index được ghi
streaming vào file tạm rồi thay thế nguyên tử; metadata giữ generation, checksum,
row count, warning và thời điểm dựng. Query từ chối index thiếu, bị sửa hoặc không còn
khớp tập Result/artifact và yêu cầu chạy verify lại.

## Artifact hiểu biết

Các lệnh nhận JSON từ file hoặc standard input:

```powershell
$profile | npm run project:source-profile -- <project-id> -
$assessment | npm run project:source-assessment -- <project-id> -
$edit | npm run project:transcript-edit -- <project-id> -
```

Mọi artifact giữ `source`, `sourceKey`, `sourceVersion`, `changeReason` và
references top-level. Khi sửa cùng key phải truyền `expectedRevision`; revision cũ
không bị ghi đè.

- `source.profile` phân loại vai trò nguồn, mục đích, ràng buộc và nguồn gốc.
- `source.assessment` giữ purpose, summary, finding, usable range, limitation,
  open question và coverage đã review.
- `source.transcript-edit` giữ raw transcript bất biến; correction ghi original,
  corrected, lý do, timing tùy chọn và evidence.

Validation đối chiếu trực tiếp project:

- source key/version và Result evidence phải khớp;
- file/item/range được dẫn phải tồn tại và nằm trong coverage;
- checksum dataset phải khớp trước khi dùng evidence;
- finding/range/correction chỉ được dẫn phần đã khai báo trong `evidenceReviewed`;
- transcript correction phải trỏ segment raw thật, giữ đúng `originalText` và có
  bằng chứng `listened`;
- references phải chứa nguồn và mọi Result được dùng.

Artifact lịch sử có thể được retire dù evidence cũ không còn resolve được; artifact
active mới vẫn phải qua toàn bộ validation.

## Tích hợp context và giới hạn còn lại

`project:context` có thêm `analysis`; summary view tránh nạp Results/Runs đầy đủ.
Production context đánh dấu dependency có `source_evidence_stale` hoặc
`source_evidence_missing` sau verify.

Gói D đã được kiểm tra bằng unit/integration cho pagination, Unicode search, correction,
evidence validation, stale source, tampered index và route observer. Các ngưỡng benchmark
10 giờ transcript, browser acceptance và corpus/holdout rộng vẫn thuộc gói E/F; chưa được
tuyên bố đạt bởi tài liệu này.
