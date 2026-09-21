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
- Frame evidence kết hợp các ranh giới ngữ nghĩa với nhịp lấy mẫu thích ứng trên toàn timeline, tối đa
  120 mẫu; video ba phút nhắm tới khoảng cách không quá năm giây giữa hai mẫu.
- Spoken QA nhận tùy chọn `expectedSpeech` gồm `text`, các `terms` quan trọng và ngưỡng. Khi có,
  độ khớp ASR/kịch bản và khả năng nhận ra thuật ngữ trở thành check chặn delivery; fingerprint của
  cấu hình này tham gia reuse. Đây là tín hiệu lỗi lời đọc/TTS, không phải kết luận chắc chắn về ngữ âm.
- Profile `nonverbal-video-v1` không chạy ASR nhưng vẫn yêu cầu hình, audio và full decode.
- Result QA có `verification.status = passed` khi báo cáo được tạo đúng và toàn vẹn. Kết luận dùng `data.gate.deliveryEligible`; một báo cáo hợp lệ vẫn có thể kết luận output không đạt.
- Human visual/auditory review luôn là `not_performed` trong Result kỹ thuật.
- `local-delivery` giữ QA của exact Result trong `quality.json` ở trạng thái advisory nếu có; từ quyết định UX ngày 2026-09-22, thiếu/fail/stale QA không phủ quyết một exact Result người dùng đã chấp nhận.
- Nếu creative direction khai báo `deliveryPromise`, Agent nên review từng promise `blocking` trên
  exact Result trước khi trình người dùng. Bundle giữ review nếu có để kiểm tra lại, nhưng acceptance
  sau đó là quyết định cuối và local delivery không mở lại gate này.
- User acceptance của exact Result vẫn là gate độc lập. Agent review không được ghi thành human
  viewing/listening và không thay quyền chấp nhận đầu ra của người dùng.

## Cố ý chưa làm

- Không OCR để tự khẳng định caption đúng nội dung.
- Không chấm cảm xúc, nhịp dựng hoặc độ tự nhiên của giọng.
- Không tự ghi user acceptance và không tự chọn profile theo loại project.
- Không biến QA thành stage bắt buộc cho mọi Result. QA sâu nên chạy trước khi trình người dùng hoặc khi một chuẩn phát hành cụ thể thực sự yêu cầu; nó không còn là gate hậu duyệt của local delivery.
