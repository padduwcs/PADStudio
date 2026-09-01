# Architecture Decision Record

Architecture Decision Record (ADR) ghi lại các lựa chọn thiết kế có ảnh hưởng đáng kể, dùng để bổ sung hoặc làm rõ build blueprint.

## Khi nào phải viết ADR

Viết ADR khi decision làm thay đổi system boundary, invariant, public contract, persistence/recovery model, Agent integration, security boundary, provider/renderer abstraction hoặc ý nghĩa của domain object.

Không cần viết ADR cho local refactor vẫn giữ nguyên thiết kế đã document.

## Status

```text
proposed    đang thảo luận
accepted    decision thiết kế có thẩm quyền
rejected    đã cân nhắc nhưng không chọn
superseded  bị ADR accepted sau đó thay thế
```

## Quy tắc

1. Đánh số ADR tuần tự.
2. Nêu vấn đề và các phương án, không chỉ nêu solution được chọn.
3. Giải thích consequence và ảnh hưởng migration.
4. Link tới build document bị ảnh hưởng.
5. Task implementation không được âm thầm mâu thuẫn với ADR đã accepted.
6. Khi ADR đổi blueprint, cập nhật document bị ảnh hưởng trong cùng coherent change hoặc link follow-up rõ ràng.

Dùng [`TEMPLATE.md`](TEMPLATE.md) cho record mới.
