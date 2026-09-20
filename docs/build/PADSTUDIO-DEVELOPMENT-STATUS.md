# PADStudio — trạng thái phát triển

Cập nhật: **2026-09-20**.

Đây là điểm vào ngắn để biết codebase đang ở đâu. PADStudio vẫn đang được xây dựng và chỉnh
chu; các báo cáo có chữ `completion`, tên đợt hoặc số phiên bản ghi lại một mốc nghiệm thu kỹ
thuật, không tuyên bố sản phẩm đã hoàn chỉnh hoặc sẵn sàng phát hành rộng.

## Trạng thái hiện tại

- Ranh giới sản phẩm hiện hành vẫn là Agent host bên ngoài điều khiển, project local giữ nguồn
  sự thật và web observer chỉ đọc.
- Kho project, Resource/Run/Result, artifact có revision, workflow thích nghi, review, decision,
  checkpoint, recovery, QA và local delivery đã có đường triển khai và test.
- Source understanding, sequence composition, asset preparation, TTS và code animation local là
  các lát cắt đã dùng được trong phạm vi đã kiểm chứng; chúng không đồng nghĩa với một studio đã
  bao phủ mọi loại video, provider hoặc môi trường.
- Workflow mẫu là điểm bắt đầu tùy chọn. Không có pipeline chung bắt buộc cho mọi project.
- Broad release chưa được chứng nhận. `npm run release:gates` hiện cố ý fail-closed khi chưa có
  corpus, phép đo và human evidence độc lập.

## Baseline kiểm chứng

Tại ngày cập nhật tài liệu này:

- `npm test`: **300/300 pass**;
- `node --test --experimental-test-coverage`: **83,10% line**, **73,73% branch**,
  **89,69% function**;
- `npm run release:gates`: **blocked**, 16/16 gate `not_measured`, `releaseDefault: null`.

Các số trên là ảnh chụp tại ngày ghi nhận, không phải giá trị tự cập nhật. Khi chúng khác kết quả
lệnh đang chạy, ưu tiên kết quả từ code và test hiện tại rồi cập nhật lại trang này. Acceptance
report trong `reports/` và `eval/**/reports/` là bằng chứng của lần chạy đã ghi ngày, không phải
dashboard trạng thái.

## Thứ tự nguồn sự thật

Khi các tài liệu có vẻ mâu thuẫn, dùng thứ tự sau:

1. Code, contract và test đang chạy.
2. [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md) cho mục tiêu và ranh giới nền tảng.
3. [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md) cho các quyết định thiết kế
   còn hiệu lực.
4. Trang này cho ảnh chụp trạng thái phát triển gần nhất.
5. Spec liên quan cho contract của đúng phân hệ đang xem.
6. Roadmap, Phase/Package, state report, completion report và acceptance report cho lịch sử và
   bằng chứng của từng mốc.

Không suy ra trạng thái hiện tại chỉ từ tên file, từ chữ `current`, `next`, `completion`, hoặc từ
số test nằm trong một báo cáo cũ.

## Phạm vi đợt chỉnh chu hiện tại

Đợt này chỉ dọn cấu trúc thông tin và tính nhất quán của repository. Không thay đổi hành vi runtime,
storage format, CLI contract, workflow, approval, delivery, tool selection hoặc ranh giới sản phẩm.
Các đề xuất phát triển mới chỉ được chọn sau khi nền tài liệu và trạng thái đã rõ ràng.
