# PADStudio — automated output QA

Ngày chốt phạm vi: **2026-09-13**.

## Mục tiêu

Cho Agent kiểm tra chính exact `video.sequence-render` trước khi xin duyệt hoặc xuất delivery. Một lệnh QA tạo bằng chứng bền vững gồm full decode, frame/contact sheet, audio analysis và, với video có lời, ASR mức từ cùng khoảng đệm đầu/cuối.

## Sáu câu hỏi triển khai

1. **Khả năng mới:** Agent chạy một lệnh cho exact Result và nhận kết luận kỹ thuật có dẫn chứng.
2. **Dữ liệu phải giữ:** analysis job, các Result probe/frame/audio/transcript và một Result tổng hợp `video.output-quality` gắn đúng render.
3. **Ranh giới:** không sửa render, sequence, review hay Decision; web tiếp tục chỉ đọc; không gọi provider trả phí.
4. **Rủi ro phải rõ:** ASR không chứng minh đúng nghĩa hoặc tự nhiên; contact sheet không thay thế xem toàn video; QA không được tự nhận đã nghe/xem như con người.
5. **Cách kiểm tra:** unit test contract/gate/cut boundary, media integration, delivery fail-closed, full repository, analysis harness và browser ba viewport.
6. **Record thay đổi:** tạo Run/Result phân tích và `video.output-quality`; không tự tạo review, approval hoặc checkpoint.

## Contract practical

- Capability tổng hợp: `video.inspect-output`, tool local `local-output-quality`.
- Orchestrator `quality:inspect` dùng lại AnalysisService cho exact Result rồi gọi tool tổng hợp qua Executor.
- Profile `spoken-video-v1` yêu cầu probe, contact sheet, audio, transcript, không clipping, có speech và biên lời tối thiểu ở đầu/cuối.
- Profile `nonverbal-video-v1` không chạy ASR nhưng vẫn yêu cầu hình, audio và full decode.
- Result QA có `verification.status = passed` khi báo cáo được tạo đúng và toàn vẹn. Kết luận dùng `data.gate.deliveryEligible`; một báo cáo hợp lệ vẫn có thể kết luận output không đạt.
- Human visual/auditory review luôn là `not_performed` trong Result kỹ thuật.
- `local-delivery` chỉ xuất khi có exact QA Result mới nhất với `deliveryEligible = true`; bundle mang theo `quality.json` và tham chiếu QA Result.

## Cố ý chưa làm

- Không OCR để tự khẳng định caption đúng nội dung.
- Không chấm cảm xúc, nhịp dựng hoặc độ tự nhiên của giọng.
- Không tự ghi user acceptance và không tự chọn profile theo loại project.
- Không biến QA thành stage bắt buộc cho mọi Result; gate chỉ áp dụng khi xuất local delivery từ sequence render.
