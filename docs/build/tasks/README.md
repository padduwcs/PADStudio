# Build Task Packet

Task packet là format bàn giao cho công việc implementation. Nó cung cấp đủ context để developer hoặc coding Agent mới làm việc mà không phải dựng lại project từ lịch sử chat.

## Các phần bắt buộc

```text
Task ID và title
Objective
Background
In scope
Out of scope
Authoritative build documents
File/module có thể bị ảnh hưởng
Constraint và thay đổi bị cấm
Acceptance criteria
Verification plan
Open decisions
Dependencies
```

## Vòng đời task

```text
Draft
  → owner review scope
  → Agent restate understanding
  → implementation
  → verification
  → handoff report
  → accepted / follow-up
```

Task packet không phải architecture document. Nếu hoàn thành task đòi hỏi đổi kiến trúc, phải tạo hoặc yêu cầu ADR.

Dùng [`TEMPLATE.md`](TEMPLATE.md) cho task mới.
