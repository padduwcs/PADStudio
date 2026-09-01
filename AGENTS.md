# PADStudio — Điểm bắt đầu cho coding Agent

Đây là hướng dẫn khởi động ngắn cho Agent hoặc developer làm việc trên codebase. Nguồn sự thật về cách xây dựng hệ thống nằm tại [`docs/build/README.md`](docs/build/README.md) và [`docs/build/00-START-HERE.md`](docs/build/00-START-HERE.md).

## Trước khi thay đổi code

1. Đọc `docs/build/00-START-HERE.md`.
2. Đọc task packet được giao trong `docs/build/tasks/` hoặc yêu cầu owner xác định scope.
3. Đọc các tài liệu architecture, domain, contract, workspace và quality liên quan.
4. Kiểm tra code/test hiện có; không suy ra thiết kế chỉ từ code cũ hoặc hội thoại cũ.
5. Nêu lại mục tiêu, phạm vi, giả định và kế hoạch verification trước khi triển khai.

## Quy tắc bắt buộc

- `docs/build/` là build contract chuẩn; runtime documentation là loại tài liệu khác.
- Agent là control plane sáng tạo; PAD cung cấp substrate, capability, artifact, execution và evidence.
- Input linh hoạt; không ép mọi project đi qua workflow page cố định.
- Giữ artifact, lineage, decision, run, checkpoint và evidence có thể kiểm tra; không dựa vào conversation memory.
- Không đưa provider, renderer hoặc UI detail vào core domain.
- Không âm thầm đổi boundary, contract, invariant, persistence, permission hoặc hướng thiết kế. Nếu cần đổi, tạo/request ADR.
- Bảo toàn user work và thay đổi ngoài scope; không dùng reset phá hủy để làm sạch commit.

Protocol triển khai, verification, handoff và commit nằm trong [`docs/build/10-DEVELOPMENT-PROTOCOL.md`](docs/build/10-DEVELOPMENT-PROTOCOL.md).
