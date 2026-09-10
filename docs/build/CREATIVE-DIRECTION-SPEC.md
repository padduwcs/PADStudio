# PADStudio — đặc tả Đợt 2: định hướng sáng tạo và duyệt mẫu

Trạng thái: **đang triển khai**. Cập nhật: **2026-09-10**.

Tài liệu này chốt phạm vi kỹ thuật cho Đợt 2 của [lộ trình](./PADSTUDIO-ROADMAP.md), tuân theo
[thiết kế](./PADSTUDIO-DESIGN.md), [định hướng hiện tại](./PADSTUDIO-CURRENT-DIRECTION.md) và
tái sử dụng [Project Intelligence + Adaptive Workflow](./PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md).

Đợt 2 không biến sáng tạo thành pipeline cứng. Agent quyết định việc cần làm; PADStudio giữ
brief, phương án, lựa chọn, lý do, tiêu chí review, mẫu và lịch sử để kiểm tra hoặc tiếp tục.

## 1. Kết quả cần đạt

Người dùng và Agent đi trọn vòng **brief → hiểu nguồn → so sánh hướng → chọn hướng → làm mẫu
khi cần → review → sửa hoặc tiếp tục**. Sau khi mở lại project, Agent khác phải biết sản phẩm
dành cho ai, các hướng đã cân nhắc, hướng được chọn, nguyên tắc cần giữ, mẫu/review tương ứng
và thay đổi mới ảnh hưởng phần nào.

## 2. Pilot và ranh giới

Pilot là **micro-lesson dọc 30–60 giây** từ `D:\Test\vid\vd03_brute_force.mp4`. Đây chỉ là
nguồn tham khảo; phải import thành resource trước khi dùng, không ghi raw path vào artifact.
Pilot ưu tiên lời/hình có sẵn, renderer local và chi phí 0.

`D:\OpenMontage` chỉ là nguồn học hỏi. PADStudio không phụ thuộc code hay pipeline của repo đó.
Những ý phù hợp đã giữ gồm artifact có revision, quyết định có lý do, review có tiêu chí và
checkpoint tiếp tục; stage cố định, raw output path và provider detail không đi vào lõi.

Trong phạm vi: hợp đồng brief/proposal/direction; provenance và revision; workflow đề xuất rồi
chọn hướng; mẫu bằng source evidence, `video.sequence` và renderer hiện có; review/decision/
checkpoint đúng revision; observer ở mức cần để hiểu trạng thái.

Ngoài phạm vi: timeline nhiều lớp, editor kéo-thả, tự chấm sáng tạo, ép mọi project làm mẫu,
dịch vụ sinh nội dung trả phí, kho template lớn, provider integration và viết lại chat client.

## 3. Sáu câu hỏi triển khai

1. **Làm được gì mới?** Biến brief và bằng chứng nguồn thành hướng có thể so sánh, chọn và thử
   bằng mẫu nhỏ trước production lớn.
2. **Điều gì phải còn lại?** Brief, proposal, direction, references/revision, review, decision,
   sample Result và checkpoint.
3. **Được thay đổi gì?** Tạo revision mới; không sửa lịch sử, tự đổi quyết định hay làm lại phần
   không bị ảnh hưởng.
4. **Rủi ro nào phải thấy?** Thiếu bằng chứng, nguồn stale, hướng lệch brief, sample lỗi, review
   gắn bản cũ và mọi chi phí/provider mới.
5. **Kiểm tra thế nào?** Contract/provenance/revision, workflow gate, render/reuse, round-trip,
   browser acceptance và review thủ công mẫu.
6. **Thay đổi record nào?** Artifact, workflow revision, review, decision, Run/Result và
   checkpoint hiện có; không tạo kho trạng thái song song.

## 4. Hợp đồng dữ liệu `1.0`

Ba loại sau chỉ nhận đúng field đã chốt và dùng envelope artifact chung.

### `project.brief`

Gồm `version`, `purpose`, `audience`, `desiredOutcome` và bốn mảng `constraints`, `knownFacts`,
`assumptions`, `openQuestions`. Artifact mới phải đủ mọi field, kể cả mảng rỗng. Không trộn
sự thật, giả định và câu hỏi chưa giải quyết.

### `creative.proposal`

Gồm `version`, `comparisonCriteria`, `options`, `recommendedOptionId`, `recommendationReason`;
phải reference ít nhất một `project.brief`. Có 2–5 option với ID duy nhất; recommendation phải
trỏ đến option tồn tại.

Mỗi option có `id`, `name`, `premise`, `hook`, `narrativeApproach`, `audienceExperience`,
`visualPrinciples`, `audioPrinciples`, `advantages`, `tradeoffs`, `risks`, và `sample`.
`sample` là `null` hoặc `{ purpose, durationSeconds, successCriteria }`, giới hạn 1–600 giây.

### `creative.direction`

Gồm `version`, `basis`, `selectionReason`, `principles`, `avoidances`, `reviewCriteria`, `sample`.
`basis` có đúng một trong hai dạng:

```json
{ "kind": "proposal", "proposalArtifactId": "artifact-...", "optionId": "keys-first" }
```

```json
{ "kind": "direct", "briefArtifactId": "artifact-..." }
```

Dạng `proposal` là đường chuẩn khi có lựa chọn đáng kể. `direct` dành cho việc nhỏ hoặc khi
người dùng đã đưa hướng đủ cụ thể. Direction phải reference chính artifact trong `basis`; option
phải tồn tại trong proposal.

## 5. Revision, provenance và tương thích

- Ba loại này là immutable revision; revision mới cùng `key` phải có `expectedRevision` đúng.
- Reference chỉ dùng ID đã đăng ký, không dùng raw path; review/approval gắn đúng output/revision.
- Revision mới không tự kế thừa approval cũ; lịch sử không bị ghi đè.
- Artifact creative cũ thiếu `data.version` vẫn đọc và retire được. Không được tạo active revision
  schema lỏng mới; việc chuyển đổi sang `1.0` phải chủ động và có thể kiểm tra.

## 6. Workflow và quyền quyết định

Workflow `creative-production` là điểm khởi đầu có thể sửa: `build-brief` →
`understand-sources` → `develop-proposals` → `choose-direction` → `adapt-production-plan`.
Nó không tự chạy tool, chọn option hay cập nhật checkpoint. Agent có thể dùng hướng `direct`
hoặc bỏ sample khi việc so sánh/thử mẫu không làm giảm rủi ro đáng kể.

Review proposal kiểm tra các option có khác nhau có ý nghĩa, phục vụ brief, bám nguồn và nêu
trade-off trung thực. Review direction/sample kiểm tra đúng lựa chọn, nguyên tắc đủ rõ và mẫu
đạt criteria. Khi approval là `required`, quyền chọn thuộc người dùng; Agent chỉ khuyến nghị.

## 7. Vòng pilot

1. Import video thành resource và kiểm tra freshness.
2. Đọc source understanding đủ cho đoạn định dùng.
3. Ghi brief `1.0` cho micro-lesson dọc 30–60 giây.
4. Ghi proposal có ít nhất hai hook/cách kể và khuyến nghị có lý do.
5. Ghi option được chọn thành direction với criteria và sample plan.
6. Tạo `video.sequence`, render mẫu local và giữ Run/Result.
7. Review nội dung/kỹ thuật, ghi decision và checkpoint.
8. Sửa cục bộ ít nhất một lần, chứng minh phần không đổi được giữ/reuse.
9. Đóng/mở lại project và tiếp tục đúng revision mà không cần hội thoại cũ.

Render ra file chưa đủ để đạt: nội dung phải được xác nhận theo criteria, source ranges truy
ngược được, lỗi không tạo Result giả và dependency đổi phải làm stale đúng output.

## 8. Các gói triển khai

| Gói | Nội dung | Trạng thái |
| --- | --- | --- |
| **A. Hợp đồng creative** | Schema strict, revision, provenance, legacy, workflow/skill | **Đã triển khai** |
| **B. Khởi tạo pilot** | Resource, source synthesis, brief, proposal, active direction chờ duyệt | **Đã hoàn thành tại ranh giới user approval** |
| **C. Dựng và duyệt mẫu** | Sequence, render, review, decision, sửa cục bộ/reuse | Chưa làm |
| **D. Quan sát Đợt 2** | Brief/proposal/direction/sample/review trong observer chỉ đọc | Chưa làm |
| **E. Nghiệm thu** | Round-trip, failure/recovery, browser và báo cáo bằng chứng | Chưa làm |

Gói A không tạo CLI riêng vì lệnh artifact chung đã là đường mutation phù hợp.

## 9. Kiểm tra và tiêu chí hoàn thành

Tự động phải từ chối contract thiếu/thừa field, proposal ngoài 2–5 option hoặc recommendation
sai, provenance/basis sai và revision conflict; đồng thời đọc/retire legacy và không regression
workflow, context, sequence, renderer. Full repository suite phải xanh trước handoff.

Nghiệm thu pilot yêu cầu người dùng hiểu các lựa chọn/trade-off; direction đủ để Agent khác
tiếp tục mà không thành shot list cứng; mẫu phát được, đúng dự kiến và trung thành nguồn;
feedback trỏ đúng bản; sửa cục bộ giữ phần tốt; observer cho biết active/review/next action.

Đợt 2 hoàn thành khi vòng pilot đạt trên máy owner và có báo cáo bằng chứng chạy lại được.
Kết quả của một video không được suy diễn thành chất lượng cho mọi thể loại.

## 10. Lỗi, phục hồi và phần để sau

- Contract/provenance sai bị từ chối trước ghi; conflict yêu cầu đọc lại, không tự merge.
- Source stale/missing phải hiện rõ và chặn dùng bằng chứng không tin cậy.
- Render lỗi giữ Run lỗi, không tạo Result giả; lỗi finalization dùng cơ chế recover hiện có.
- Direction đổi giữ lịch sử nhưng làm stale đúng dependency, không tự chọn hướng thay thế.

Chưa chốt storyboard schema riêng, timeline nhiều lớp, provider sinh nội dung, scoring model,
template library, chat tích hợp hay ngân sách trả phí. Chỉ mở khi pilot chứng minh cần thiết.

Việc gần nhất là người dùng duyệt direction hiện hành. Sau approval, bắt đầu **gói C: tạo
`video.sequence`, render, review và sửa cục bộ mẫu 30–60 giây**. Bằng chứng Gói B nằm tại
[CREATIVE-DIRECTION-PACKAGE-B.md](./CREATIVE-DIRECTION-PACKAGE-B.md).
