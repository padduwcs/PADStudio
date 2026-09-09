# Source Understanding — gói F: nghiệm thu phân hệ

Cập nhật: **2026-09-09**. Trạng thái: **đã hoàn thành trong phạm vi sử dụng thực dụng trên máy
owner, với các giới hạn phát hành rộng được ghi rõ**.

Gói F đóng đợt 1 theo điều chỉnh nghiệm thu §18 của
[`SOURCE-UNDERSTANDING-SPEC.md`](SOURCE-UNDERSTANDING-SPEC.md): dùng cấu hình đã kiểm chứng trên
máy hiện tại, không yêu cầu corpus độc lập để chặn sử dụng, không tuyên bố các gate chưa đo đã đạt.
`large-v3-gpu-fp16` tiếp tục là `practicalDefault`; `releaseDefault` tiếp tục là `null`.

## Phạm vi đã nghiệm thu

Acceptance runner tổng hợp bằng chứng đang tồn tại thay vì tạo một pipeline kiểm thử thứ hai:

- vòng tạo/import, danh tính project, checkpoint và mở lại;
- Analysis Run/Result, dependency, source identity và reuse có kiểm chứng;
- cancel, resume và reconcile Result đã bền vững;
- runtime/dependency thiếu hoặc thay đổi, không fallback ngầm;
- source stale/missing, dataset/index bị sửa và bảo toàn lịch sử;
- range, pagination, nhiều Result set và lựa chọn không mơ hồ;
- regression các capability media, sequence và renderer cũ;
- runtime doctor, harness đánh giá và browser acceptance trên project có dữ liệu thật.

Runner là `scripts/source-understanding-acceptance.mjs` và fail closed khi test làm bằng chứng bị
thiếu/đổi tên, doctor không ready hoặc browser gate không chạy thành công. Lệnh chuẩn:

```powershell
npm run analysis:acceptance -- --browser-project <project-id> --report <report-path>
```

`<project-id>` phải có preview/transcript, ít nhất hai transcript Result set và transcript đủ dài để
phân trang. Runner chạy `analysis:verify` trước browser gate để search/freshness dùng đúng index hiện
hành. Nếu không truyền project, runner vẫn chạy test/harness/doctor nhưng kết thúc `incomplete`; không
được dùng lần chạy đó để đóng gói F.

## Kết quả trên máy hiện tại

Báo cáo máy đọc được:
[`package-f-verification.json`](../../eval/source-understanding/reports/2026-09-09/package-f-verification.json).

| Gate | Kết quả |
| --- | --- |
| Repository regression | 129/129 pass, không skip |
| Evaluation harness | 20/20 pass |
| Analysis doctor | `ready`, đủ sáu capability |
| Browser acceptance | pass trên Chrome, 4 nguồn |
| Result set | thấy nhiều tập và chuyển tập thành công |
| Pagination | tải 86 transcript rows qua nhiều trang |
| Search | 16 kết quả từ index đã verify |
| Polling | giữ nguyên player |
| Responsive | không tràn ngang ở 390/768/1440 px |

Bằng chứng production gói C được mang sang có transcript range 305 giây đi qua biên chunk 300 giây,
không trùng segment ID. Acceptance matrix chỉ chấp nhận các test cụ thể cho project round-trip,
lifecycle, cancel/resume/reconcile, runtime failure, freshness/tamper, pagination/Result set và
regression capability; tổng số test đơn thuần không đủ để báo đạt.

Browser smoke được mở rộng để kiểm tra cả việc chuyển Result set, tải trang tiếp theo và tìm kiếm.
Reader có regression riêng cho source và dataset bị xóa: verify phải trả `missing`, giữ nguyên Result
lịch sử và chỉ ghi cache/index dẫn xuất.

## Ý nghĩa của việc đóng đợt 1

Trong phạm vi đã chốt, Agent có thể phân tích ảnh/audio/video, giữ Result kỹ thuật, đọc/tìm theo
source time, ghi assessment/correction có bằng chứng, mở lại project và cho người dùng kiểm tra qua
observer. Các đường lỗi chính có semantics và regression; capability dựng cũ không bị gói B–F làm
hỏng.

Đây là **practical acceptance**, không phải release certification cho mọi máy, corpus hoặc loại
media. Gói F không thay đổi contract lõi và không thêm capability mới vì nghiệm thu hiện tại chưa cho
thấy nhu cầu phải mở rộng ranh giới.

## Gate chưa đo và giới hạn còn lại

Các mục sau giữ trạng thái `not_measured` và vẫn chặn tuyên bố phát hành rộng:

- corpus gold/holdout độc lập và diversity theo §13;
- CER/token error, tên riêng/số và timing p95 của ASR;
- precision/recall hard-cut;
- nguồn 2 giờ, 4K, VFR và stream offset khác 0 end-to-end;
- benchmark 100 file/10 giờ transcript, query p95 và memory ceiling ở quy mô đó.

Nguồn production dài nhất đã kiểm chứng trong báo cáo hiện tại là 305 giây. Baseline gói A đã chạy
25 file/gần 101 phút tổng, nhưng đây không thay cho nguồn đơn 2 giờ hoặc holdout đã khóa. Không được
đổi `releaseDefault`, hạ ngưỡng §13 hoặc ghi `passed` cho các mục trên nếu chưa có lần đo mới.

OCR/vision, vector search, speaker diarization, UI mutation, dịch vụ trả phí, fallback provider,
timeline nhiều lớp và chat tích hợp không thuộc gói F.

## Hướng tiếp theo

Đợt 1 kết thúc ở mức dùng thực dụng. Việc phát triển tiếp chuyển sang **đợt 2 — định hướng sáng tạo và
duyệt mẫu**: chọn một loại video mục tiêu, dùng brief và bằng chứng nguồn để tạo các phương án hướng
sáng tạo/kịch bản, lưu lựa chọn và tiêu chí review, làm mẫu khi cần rồi tiếp tục qua workflow hiện có.

Chỉ mở lại các gate phát hành rộng của đợt 1 khi có nhu cầu chứng nhận tương ứng và corpus/fixture có
quyền sử dụng; đó là một quyết định phạm vi có chủ đích, không phải tính năng ngầm của đợt 2.
