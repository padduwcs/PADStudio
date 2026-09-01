# Protocol phát triển

## Mục đích

Protocol này giữ cho chủ dự án, developer và coding Agent đồng bộ trong quá trình xây dựng hệ thống. Nó tách khỏi runtime instruction mà production Agent dùng để làm video.

Protocol này kiểm soát cách cộng tác, phạm vi và việc kiểm tra; nó không biến mọi ý tưởng trong `docs/build/` thành yêu cầu phải triển khai ngay. Task vẫn cần được chọn theo lộ trình và nhu cầu thực tế.

## Protocol bắt đầu task

Trước khi đổi code, developer hoặc coding Agent phải:

1. Đọc [`00-START-HERE.md`](00-START-HERE.md).
2. Đọc task packet được giao.
3. Đọc tài liệu architecture và contract mà task liên kết.
4. Kiểm tra code và test hiện có liên quan.
5. Nêu lại objective, scope, assumption, boundary bị ảnh hưởng và verification plan.
6. Xác định mọi conflict với architecture decision đã chấp nhận.

Không task nào được bắt đầu chỉ từ một bản tóm tắt hội thoại.

## Ranh giới task

Mỗi task phải nêu:

```text
objective
in scope
out of scope
file hoặc module được phép đổi
build document có thẩm quyền
acceptance criteria
command verification
risk đã biết
```

Agent không được mở rộng scope chỉ vì phát hiện cải tiến không liên quan. Có thể ghi chúng thành follow-up task.

## Protocol implementation

1. Bảo toàn user work hiện có, trừ khi task nói rõ phải thay thế.
2. Ưu tiên thay đổi nhỏ nhất đáp ứng thiết kế đã chấp nhận.
3. Giữ domain code độc lập với chi tiết provider và UI.
4. Thêm hoặc cập nhật contract trước khi dựa vào shape chưa được document.
5. Thêm test tại boundary có thể bắt regression.
6. Không che giấu fallback, schema change, data migration hoặc behavior change.
7. Không sửa build architecture docs để biện minh cho shortcut implementation chưa được review.
8. Nếu thiết kế bắt buộc phải đổi, dừng và đề xuất ADR.

## Protocol thay đổi kiến trúc

Thay đổi cần ADR khi làm đổi:

- system boundary
- invariant
- public artifact hoặc tool contract
- Agent integration behavior
- persistence hoặc recovery semantics
- security hoặc permission model
- renderer/provider abstraction
- ý nghĩa của project hoặc candidate

ADR nên được chấp nhận trước implementation nếu thay đổi có hậu quả đáng kể. Build document bị ảnh hưởng phải được cập nhật trong cùng coherent change hoặc link rõ là pending.

## Protocol verification

Trước khi báo hoàn thành, phải kiểm tra:

```text
contract validity
targeted tests
relevant integration behavior
failure behavior khi thực tế cho phép
documentation links và examples
scope boundaries
```

Nếu không chạy được check, báo rõ lý do và phần còn chưa verify. Không được biến “not run” thành “passed”.

## Handoff report

Mọi task hoàn thành phải báo cáo:

```text
Summary
Files changed
Contracts hoặc decisions changed
Tests/checks run và kết quả
Known limitations
Follow-up tasks
Commit identifier, nếu đã commit
```

## Protocol commit

Commit phải:

- giới hạn trong một coherent task
- có message mô tả rõ
- không chứa thay đổi khác của user
- kèm test hoặc giải thích khi test không áp dụng
- an toàn để Agent khác kiểm tra và tiếp tục

Không dùng destructive reset hoặc ghi đè user work chưa review chỉ để làm commit sạch.

## Duy trì context

Context bền vững cho các hội thoại sau là:

```text
build docs → accepted ADRs → task packet → source/tests → handoff report
```

Chat trước là history hữu ích, nhưng không bao giờ là dependency bắt buộc để hiểu hoặc tiếp tục build.

## Quyền kiểm soát của chủ dự án

Chủ dự án có thể yêu cầu dừng trước khi:

- chấp nhận thay đổi kiến trúc
- gọi service bên ngoài có tính phí
- đổi chiến lược provider hoặc renderer
- xóa hoặc migrate user data
- đổi security boundary
- promote candidate quality policy

Agent phải làm rõ các điểm này thay vì âm thầm quyết định thay chủ dự án.
