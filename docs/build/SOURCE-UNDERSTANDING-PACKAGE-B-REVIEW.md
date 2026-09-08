# Review gói B — 2026-09-09

Review commit `6820eb9`. Bộ test hiện có: 104/104 qua. Không sửa implementation trong lượt review này. Hai ca tái hiện bổ sung đều thất bại theo hành vi mong đợi; cần sửa trước khi tích hợp adapter chạy lâu của gói C.

## P1 — Resume không xác minh lại unit đã thành công

`src/analysis/analysis-service.js`: `#reconcile` bỏ qua SUCCESS_STATES (khoảng dòng 792); `#runOwned` cũng bỏ qua chúng trước refresh fingerprint (khoảng dòng 519).

Tái hiện: job probe + frames; probe v1 thành công, frames unavailable nên job partial. Đổi probe sang v2, cho frames available rồi resume. Job completed, probe vẫn chỉ chạy một lần, unit.method vẫn v1 dù tool hiện tại v2. Downstream tiếp tục dựa trên bằng chứng cũ. Cùng nhánh bỏ qua này không revalidate checksum file của các unit succeeded/reused khi resume.

Cần đối soát unit đã thành công theo source, file checksum, method và dependency hiện tại trước khi dùng tiếp; giữ lịch sử cũ, chỉ vô hiệu hóa/chạy lại phần bị ảnh hưởng theo policy. Phân biệt phục hồi dấu vết của Result durable với chấp nhận Result đó làm bằng chứng hiện hành. Thêm regression cho version drift và output hỏng/mất giữa hai lần chạy.

## P1 — Race khi tiếp quản lease cũ

`src/analysis/analysis-store.js`, `acquireLease`, khoảng dòng 430: sau khi đọc lease và xác định owner chết, code rename đường dẫn writer.json mà không đảm bảo đó vẫn là lease đã kiểm tra.

Tái hiện interleaving bằng ownerAlive được điều khiển trong fixture: B đọc lease cũ rồi chờ; A tiếp quản và nhận lease mới; B tiếp tục rename writer.json, thực tế archive lease mới của A, rồi cũng acquire thành công. Cả hai acquireLease trả lease; assertLease của A thất bại. Adapter đang chạy có thể còn thực thi đến lần heartbeat kế tiếp.

Cần cơ chế serialize takeover/ownership an toàn trước thay thế lease, không chỉ thêm kiểm tra token rời rạc rồi vẫn rename theo path có race. Thêm test tranh chấp takeover có thứ tự xen kẽ xác định, kiểm một writer duy nhất và không archive lease mới của writer còn sống.

## Đánh giá phạm vi

Nền hợp đồng, nguồn có hash, Executor hooks, bảo toàn Result khi finalization lỗi và test các luồng thông thường đã có. Việc default registry chưa có sáu adapter, hoặc chưa dừng cây FFmpeg/Python thật, là phạm vi gói C đã được tài liệu B nêu rõ; không coi đó là lỗi thiếu triển khai B.

Ca tái hiện local: `.cache/review-package-b.test.mjs`; chạy `node --test .cache/review-package-b.test.mjs`. File cache không được Git lưu; các bước và kết quả đã ghi đầy đủ ở trên để dựng regression trong test chính thức. Chạy review trên fixture riêng, không sửa media owner hay project thật.

Sau khi sửa hai lỗi, chạy regression liên quan và toàn bộ test rồi tiếp tục gói C theo đặc tả. Giữ quyết định §18: large-v3 FP16 dùng thực tế; không đòi dataset riêng để chặn tiến độ.

## Kết quả xử lý

Cả hai lỗi P1 đã được xác minh và sửa trong lượt tiếp theo:

- Resume revalidate unit thành công theo source bytes, method/fingerprint, dependency provenance,
  Result contract và checksum file. Evidence không còn current bị gỡ khỏi active unit để chạy lại;
  Result và attempt lịch sử vẫn được giữ, kèm warning invalidation.
- Mọi contender tạo acquisition claim riêng trước khi đọc hoặc thay `writer.json`. Claim đang sống
  làm contender đến sau fail closed; claim chết được archive theo đúng token nên không thể rename
  nhầm lease mới của writer khác.

Regression chính thức đã thêm cho version/upstream drift, evidence checksum bị sửa, source đổi giữa
hai lần chạy và takeover interleaving có kiểm soát. Sau sửa: `npm test` đạt 108/108 và
`npm run analysis:test` đạt 20/20.
