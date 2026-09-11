# PADStudio — trạng thái hiện tại và bước tiếp theo

Cập nhật: **2026-09-11**. Đây là bản tóm tắt vận hành hiện hành; khi số liệu cũ trong tài liệu gói khác nhau, ưu tiên code, report nghiệm thu mới nhất và tài liệu này.

## Đã có và dùng được

- Kho project bền vững cho resource, run/result, artifact có revision, review, decision, workflow và checkpoint.
- Đợt 1 practical: probe, scene, frame/contact sheet, audio analysis, ASR, preview, source assessment/search/freshness và observer chỉ đọc.
- Đợt 2 practical: brief → proposal → direction → sequence/render → review/approval, sửa cục bộ và reuse segment.
- Đợt 3 practical local: `graphic.render`, `audio.prepare`, `media.acquire`, Piper/ElevenLabs qua `tts.synthesize`; ElevenLabs có exact single-use credit authorization.
- Context summary gọn nay giữ checkpoint freshness, resume state, sequence/blocker, affected work item và pending finalization.
- Browser smoke dùng profile dưới `.cache/browser-profiles` và dọn đúng process/profile sau khi chạy.

## Pilot Đợt 3

Project `phase3-vd04-asset-pilot` dùng `vd04_brute_force_to_optimization.mp4` từ nguồn người dùng cung cấp. Chuỗi hiện hành:

- brief r2 → proposal r2 → creative direction r3;
- graphic Result local và Piper `vi_VN-vais1000-medium` Result thật;
- sequence r9, render `result-mtxaw6zq-5779e7b0`, 1080×1920, 30 fps, 12.021333 giây;
- ASR khớp đủ 17 từ lời dẫn theo thứ tự; mix `-17.5 LUFS`, peak `0.5614`, không có clipping candidate;
- review `passed_with_notes`: kỹ thuật, hình trực tiếp, ASR và mix đạt; chưa có human listening review;
- Agent ghi quyết định kỹ thuật theo ủy quyền thử nghiệm, không mạo nhận user approval và không gọi dịch vụ trả phí.

Project hiện có checkpoint `current`, không workflow active, không approval chờ, không blocker/dependency stale và không pending finalization.

## Kiểm chứng mới nhất

- `npm test`: 160/160 pass.
- `npm run analysis:test`: 20/20 pass.
- `npm run tts:acceptance`: 16/16 test TTS pass; Piper available, ElevenLabs unavailable vì chưa có credential.
- `npm run assets:acceptance`: pass, gồm image/audio/attribution/player và viewport 390/768/1440.
- `npm run creative:acceptance`: pass với giới hạn đã công bố; repository 160/160 và browser pass.

## Giới hạn còn lại

- Chưa nghe duyệt chất giọng Piper bằng tai người; ASR và số đo audio không thay thế đánh giá tự nhiên/cảm xúc.
- Chưa gọi ElevenLabs thật, chưa kiểm chứng catalog/quota/voice của tài khoản thật.
- Ảnh AI và tìm kiếm stock tự động chưa triển khai; chỉ thêm khi project thật chứng minh nhu cầu.
- Các gate release rộng của Đợt 1 vẫn `not_measured`; `releaseDefault` vẫn là `null`.

## Bước tiếp theo

Chuyển sang **Đợt 4 — dựng hình và âm thanh**, nhưng bắt đầu bằng một workflow người dùng thật thay vì mở rộng tool theo danh sách:

1. Chọn một sản phẩm mục tiêu và tiêu chí đầu ra cụ thể.
2. Chạy trọn vòng intake → hiểu nguồn → direction → sequence → preview → phản hồi.
3. Ghi ma sát thực tế về timing, text/subtitle, bố cục, chuyển cảnh, audio ducking/mix và sửa cục bộ.
4. Chỉ triển khai capability dựng còn thiếu đã được pilot chứng minh.
5. Nghiệm thu bằng exact Result, review có bằng chứng, recovery/freshness và browser observer.
