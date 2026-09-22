# PADStudio — trạng thái phát triển

Cập nhật: **2026-09-22**.

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
- Intake và creative direction hướng Agent tự quyết định từ brief ngắn sau khi xem tư liệu liên quan; Agent phải nêu rõ các lựa chọn lớn khi bỏ qua nguồn đáng kể. Agent review sáng tạo trên exact video mới phải khai phạm vi xem chuyển động và nghe tiếng; review mẫu không được trình bày như đã xem/nghe toàn bộ. Observer hiển thị phạm vi này. Review cũ vẫn đọc được.
- Choreography 1.3 là nhánh tùy chọn cho giải thích bằng hoạt họa: giữ lập luận thị giác do Agent
  đạo diễn, lưu minh chứng bằng hình và footprint chữ chính xác cho review; không tự đảm bảo chất
  lượng hình ảnh khi chưa preview/xem một video thật.
- Broad release chưa được chứng nhận. `npm run release:gates` hiện cố ý fail-closed khi chưa có
  corpus, phép đo và human evidence độc lập.

## Baseline kiểm chứng

Tại ngày cập nhật tài liệu này:

- Lần chạy full gần nhất, `npm test`: **317/317 pass**;
- Vòng sửa chữa preview/review/Observer hiện tại: **34/34 targeted tests pass**; chưa chạy lại toàn bộ suite;
- `npm run observer:browser-test -- -ProjectId priority-queue-visual-20260920 -StructureOnly`: **passed** với observer server đang chạy, tại 390, 768 và 1440 px;
- `npm run animation:acceptance`: **passed** (local Remotion preflight, preview và render một fixture
  độc lập trong thư mục tạm; không phải pilot sáng tạo của người dùng);
- Lần đo coverage gần nhất (trước đợt 1.3): `node --test --experimental-test-coverage`:
  **83,10% line**, **73,73% branch**, **89,69% function**;
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

Đợt này mở rộng contract `animation.choreography` lên 1.3 để Agent lập kế hoạch visual-first và
kiểm kê chữ theo beat; observer, skill authoring/review và test liên quan được cập nhật. Version
1.0–1.2 vẫn đọc được; workflow, approval, delivery, tool selection và ranh giới sản phẩm không đổi.
Chưa chạy một pilot render mới để chứng minh chất lượng sáng tạo của video đầu ra.

Vòng sửa chữa hiện tại bổ sung một shortcut project-native để tạo preview Remotion theo khoảng thời
gian từ đúng composition revision/preflight đã pass, hiển thị khoảng thời gian/frame và tùy chọn lặp
clip trong Observer để so chuyển động với tiếng, cùng lệnh `observer:ensure` có thể tái sử dụng hoặc
khởi động Observer local. Skill authoring/review hướng Agent chọn đoạn rủi ro theo nội dung và tự xem
chuyển động có voice trước khi đưa người dùng xem; đây không phải eval Greedy, template hình ảnh hay
bộ luật thẩm mỹ cứng.

Pilot recursion sau đó làm rõ hai lỗi vận hành ở đoạn chốt. `project:accept` nay kiểm tra exact media
khớp một delivery profile trước khi mở confirmation và tự đưa feedback còn chờ của đúng sequence vào
`resolvesDecisionIds`; người dùng không còn phải xác nhận lại chỉ vì lỗi profile hoặc thiếu cờ
`--resolves`. Sequence compositor xuất `yuv420p` limited range với metadata BT.709. Khi commit output,
ProjectStore xóa các thư mục runtime rỗng nhưng giữ nguyên mọi file và thư mục có nội dung. Project mới
chỉ tạo `project.json`; các kho con được tạo khi lần đầu có dữ liệu thay vì dựng sẵn nhiều thư mục rỗng.

Vòng dùng thật tiếp theo cho thấy chính profile/QA gate hậu duyệt vẫn gây lãng phí: người dùng đã chốt
file có thể sử dụng nhưng Agent phải sửa, render và xin duyệt lại để thỏa contract nội bộ. Baseline mới
coi acceptance trong Agent host là quyết định sáng tạo cuối. Agent ghi nó bằng `project:accept
--from-agent-host`; local delivery chỉ probe tối thiểu, copy exact byte và kiểm checksum. QA sâu, profile,
loudness, tail silence, promise review và freshness là kiểm tra trước duyệt hoặc evidence advisory, không
còn block local delivery sau acceptance. Terminal full-view/full-listen attestation vẫn có nhưng là tùy chọn.
