# Project Intelligence + Adaptive Workflow

Đây là contract kỹ thuật đã triển khai cho phần giúp Agent hiểu, sáng tạo, lập kế
hoạch và tiếp tục công việc xuyên suốt project. Nó học các cơ chế tốt từ
OpenMontage nhưng không dùng pipeline hay stage cố định.

## Bức tranh vận hành

~~~mermaid
flowchart LR
    C[Context: brief, artifacts, evidence, capabilities]
    A[Agent: hiểu và chọn việc]
    W[Adaptive workflow: đồ thị có revision]
    E[Executor: tool, run, result]
    R[Review: creative và technical]
    D[Decision: lựa chọn, lý do, approval]
    P[Checkpoint: điểm tiếp tục]
    C --> A --> W --> E --> R --> D --> A
    A --> P --> C
~~~

PADStudio lưu, kiểm tra và tập hợp bối cảnh. Agent vẫn quyết định việc sáng tạo nào
cần làm, có cần đổi kế hoạch hay không và vì sao.

## Các lớp dữ liệu

| Thành phần | Giữ gì | Quy tắc chính |
| --- | --- | --- |
| Artifact | Brief, hiểu tư liệu, hướng sáng tạo hoặc tri thức có cấu trúc | Cùng một key tạo revision mới; không ghi đè revision cũ |
| Workflow | Kế hoạch hiện hành gồm các work item và dependency | Đồ thị không chu trình; mọi lần sửa có `changeReason` và `expectedRevision` khớp revision mới nhất |
| Review | Đánh giá một artifact, result hoặc work item | Tách creative, technical, combined; failure phải có hành động đề xuất |
| Decision | Phản hồi result hoặc lựa chọn/approval cấp project | Ghi nối tiếp; giữ phương án, lựa chọn, lý do, người quyết định và confidence |
| Checkpoint | Điểm tiếp tục gọn | Có thể trỏ workflow, work item, artifact, decision; không thay thế record gốc |
| Skill | Cách làm và tiêu chuẩn nghề cho Agent | Không giữ state, không tự chạy tool, có thể mở rộng theo project |

## Workflow thích nghi

Mỗi work item có mục đích, kết quả mong đợi, dependency, skill, input/output
reference, trạng thái, yêu cầu review và mức approval: auto, notify hoặc required.

Trạng thái hỗ trợ: planned, ready, in_progress, awaiting_review,
awaiting_approval, blocked, completed, cancelled.

PADStudio từ chối:

- có đồng thời nhiều hơn một workflow active;
- dependency không tồn tại hoặc tạo chu trình;
- bắt đầu/hoàn tất work item khi dependency chưa hoàn tất;
- chuyển sang `awaiting_review` khi chưa có output;
- ghi review work item khi item chưa ở `awaiting_review`, review sai perspective hoặc
  không bao phủ đủ tiêu chí bắt buộc;
- chuyển sang awaiting_approval khi chưa có output, hoặc review bắt buộc chưa pass;
- ghi decision approval khi item chưa ở `awaiting_approval`;
- hoàn tất khi review bắt buộc chưa pass;
- hoàn tất khi approval bắt buộc chưa do người dùng chấp thuận;
- hoàn tất workflow khi còn work item chưa kết thúc;
- mở lại work item completed/cancelled, hoặc đổi ý nghĩa/output đã bước vào review/approval;
- skill hoặc reference không tồn tại;
- sửa workflow mà không ghi lý do, thiếu `expectedRevision` hoặc dùng revision đã stale.

Workflow template chỉ là điểm khởi đầu. Agent có thể bỏ template, sửa, thêm nhánh
hoặc tạo workflow riêng. Hai template ban đầu là quick-media-task và
creative-production.

Review work item được gắn với workflow revision, perspective, tiêu chí bắt buộc và
chính xác tập output đã review. Approval cũng được gắn với tập output và review đã
pass. Nếu ý nghĩa hoặc output thay đổi, review/approval cũ không còn mở gate; Agent
phải tạo identity mới hoặc đưa item qua review và approval lại.

Với Agent review sáng tạo hoặc kết hợp trên một exact `video.sequence-render` mới,
`project:review` yêu cầu `inspection`. Đây là lời khai về phạm vi Agent thực sự kiểm tra,
không phải chứng nhận tự động rằng Agent đã xem/nghe. `visual.method` là
`not_reviewed`, `sampled_frames`, `motion_samples` hoặc `continuous_playback`;
`audio.method` là `not_reviewed`, `analysis_only`, `sampled_listening`,
`continuous_listening` hoặc `not_applicable`. Mỗi phương thức có mô tả evidence cụ thể;
`limitations` ghi phần còn chưa được đánh giá. Review tích cực phải có motion evidence
và phải nghe ít nhất các đoạn tiếng mẫu nếu render có tiếng. ASR/đo mức mà không nghe
chỉ hỗ trợ QA kỹ thuật, không đủ cho verdict sáng tạo tích cực. Nếu chỉ xem/nghe các
đoạn mẫu, verdict tối đa là `passed_with_notes` và phải nêu giới hạn. `passed` chỉ
hợp lệ khi Agent khai đã xem hình liên tục và nghe tiếng liên tục (hoặc video không có
tiếng). Human acceptance vẫn là quyết định riêng, không thể thay bằng trường `inspection`. Quyết định
đó có thể được người dùng đưa trong Agent host rồi Agent bind vào exact Result; kênh này không tự sinh
full-view/full-listen attestation. Review cũ không có trường này vẫn đọc được để giữ lịch sử.

## Artifact và revision

~~~json
{
  "key": "creative-direction",
  "type": "creative.direction",
  "name": "Hướng sáng tạo",
  "summary": "Ấm áp, gần gũi, tập trung vào con người.",
  "status": "active",
  "data": {},
  "references": [{ "kind": "artifact", "id": "artifact-..." }],
  "createdBy": "agent"
}
~~~

Draft không thay active revision. Active đưa revision đó vào context hiện hành.
Retired kết thúc artifact đang active. Mọi revision và provenance vẫn được giữ.

## Skill và tiêu chuẩn

Catalog ban đầu gồm project-intake, source-understanding, creative-direction,
adaptive-planning và result-review. Mỗi skill khai báo khi nào dùng, artifact liên
quan, tiêu chí review và file hướng dẫn.

Có thể thêm catalog dưới .padstudio/projects/project-id/skills/. ID phải không
trùng catalog hệ thống và đường dẫn instruction không được thoát khỏi root.

~~~text
Capability/tool catalog  = hệ thống làm được gì
Skill catalog            = Agent nên làm việc đó thế nào
Project artifacts        = project này đã hiểu và chọn gì
~~~

## Context cho Agent

Lệnh project:context tập hợp project, checkpoint, resources, results, runs; toàn
bộ artifacts/workflows/reviews/decisions và phần active; work item cần chú ý,
approval đang chờ, skill liên quan; capability thật trong môi trường; và resume
view với workflow revision cùng blocker hiện hành.

Context chỉ tổng hợp trạng thái đã lưu và dependency; nó không tự chọn bước sáng
tạo tiếp theo.

Context đồng thời báo `checkpointFreshness`. Khi có resource, run, result, artifact,
workflow, review hoặc decision mới hơn checkpoint, observer cảnh báo checkpoint có
thể đã cũ; PADStudio không tự viết lại nội dung sáng tạo thay Agent.

## Ranh giới đã giữ

- Không tích hợp code OpenMontage và không phụ thuộc pipeline type.
- Không cho tool tự chọn raw input/output path.
- Không biến skill thành state machine.
- Không lưu full transcript hoặc chain-of-thought.
- Observer vẫn chỉ đọc; mọi mutation đi qua Project Store/CLI.
- Project cũ không có các thư mục mới vẫn mở bình thường.
