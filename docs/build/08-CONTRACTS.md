# Contract và Schema

## Mục đích

Contract là hướng suy nghĩ về cách các Agent, tool, provider, renderer và implementation tương lai có thể phối hợp mà không cần chia sẻ code nội bộ hoặc phụ thuộc vào trí nhớ của hội thoại.

Các lớp contract và ví dụ schema ở tài liệu này chưa phải danh sách phải triển khai ngay. Contract thật chỉ nên được chốt khi một boundary thực tế cần giao tiếp; trước đó có thể dùng cấu trúc đơn giản hơn để học và kiểm chứng luồng.

## Các lớp contract

```text
User/input contract
  Tài liệu và intent nào có thể đi vào hệ thống

Domain contract
  Project, Artifact, Run, Candidate và Decision có ý nghĩa gì

Agent contract
  Agent session đọc context và yêu cầu operation thế nào

Tool contract
  Input, output, capability, dependency, cost và side effect

Artifact contract
  Identity, schema, lineage, hash, status và provenance

Evidence contract
  Đã kiểm tra gì, bằng cách nào, trên candidate nào và cho kết quả gì
```

## Artifact envelope

Mọi artifact bền vững dùng một envelope chung với content riêng theo type:

```json
{
  "artifactId": "artifact-...",
  "type": "scene_plan",
  "schemaVersion": "1.0",
  "revision": 1,
  "status": "draft",
  "createdBy": {
    "kind": "agent",
    "provider": "...",
    "model": "...",
    "sessionId": "..."
  },
  "inputRefs": ["brief-...", "direction-..."],
  "contentHash": "sha256:...",
  "createdAt": "...",
  "content": {}
}
```

Envelope phải nhỏ và dễ dự đoán. Field riêng theo type phải nằm trong schema `content`.

## Input contract

Input record phải phân biệt:

```text
intent của user
file hoặc URL gốc
media type
technical probe
transcript hoặc timing data
provenance
constraint của user
confidence và conflict
```

Hệ thống có thể suy ra inventory, transcript, alignment hoặc preview từ input, nhưng không được thay thế input gốc.

## Tool contract

Khai báo tool nên gồm:

```text
name và version
capability family
provider và execution runtime
input/output schema
dependency và availability
best_for / not_good_for
estimated cost và duration
determinism
retry / resume / idempotency
side effect
fallback
required skill
verification method
```

`ToolResult` phải phân biệt success, artifact đã tạo, warning, error class, provider task ID, cost, duration và thông tin resume. Tool không được giấu partial result hoặc degraded result dưới success bình thường.

## Task contract

Mỗi task trong production graph phải khai báo:

```text
taskId
capability hoặc role
inputRefs
expected outputs
constraints
owner Agent/session
permission scope
budget
retry/resume policy
verification requirements
```

Agent có thể tạo task động, nhưng mỗi task vẫn phải kiểm tra và truy vết được.

## Run và checkpoint contract

Run ghi lại một lần thử execution. Checkpoint ghi đủ thông tin để resume hoặc giải thích lần chạy:

```text
runId
projectId
graph revision
current task
completed tasks
pending tasks
selected artifact/candidate refs
agent session
tool/provider request IDs
cost snapshot
approval state
last heartbeat
resume information
```

Run bị gián đoạn phải hiện rõ là interrupted hoặc resumable. Không được âm thầm khởi động lại external operation tính phí khi request trước có thể vẫn tồn tại.

## Event contract

Event là observation append-only dùng cho live progress và replay:

```text
eventId
timestamp
runId
taskId
agent/session
event type
artifact/candidate refs
status
summary
```

Event không phải canonical artifact content. Thiếu event có thể làm UI live ít chi tiết hơn, nhưng không được xóa production result.

## Schema evolution

1. Mọi public contract có schema version rõ ràng.
2. Thay đổi additive nên backward compatible khi có thể.
3. Breaking change cần migration hoặc contract version mới.
4. Artifact cũ vẫn nên đọc được qua adapter khi thực tế cho phép.
5. Schema version không giống architecture version.
6. Không được đổi tên tài liệu kiến trúc cho mỗi schema hoặc implementation revision.

## Error contract

Error phải chỉ ra boundary nơi nó xảy ra:

```text
invalid_input
missing_dependency
permission_required
provider_auth
provider_rejected
provider_timeout
external_task_unknown
tool_failure
render_failure
contract_failure
review_failure
user_decision_required
```

Mỗi error nên có giải thích cho con người, machine category, retry safety, operation đã thử, ID liên quan và next action có thể thực hiện.

## Quy tắc tương thích

Adapter chuyển format bên ngoài thành contract của PAD. Field riêng provider có thể giữ dưới provider metadata, nhưng không được rò vào core domain thành concept bắt buộc.

## Không có aggregate ẩn

Không tạo lại một object `Project` khổng lồ sở hữu mọi artifact, history và provider detail. Project index reference artifact; artifact lineage giải thích dependency; run giải thích execution.
