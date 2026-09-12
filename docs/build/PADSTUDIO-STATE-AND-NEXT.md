# PADStudio — trạng thái hiện tại và bước tiếp theo

Cập nhật: **2026-09-12**. Đây là bản tóm tắt vận hành hiện hành; khi số liệu cũ trong tài liệu gói khác nhau, ưu tiên code, report nghiệm thu mới nhất và tài liệu này.

## Đã có và dùng được

- Kho project bền vững cho resource, run/result, artifact có revision, review, decision, workflow và checkpoint.
- Đợt 1 practical: probe, scene, frame/contact sheet, audio analysis, ASR, preview, source assessment/search/freshness và observer chỉ đọc.
- Đợt 2 practical: brief → proposal → direction → sequence/render → review/approval, sửa cục bộ và reuse segment.
- Đợt 3 practical local: `graphic.render`, `audio.prepare`, `media.acquire`, Piper/ElevenLabs qua `tts.synthesize`; ElevenLabs có exact single-use credit authorization.
- Context summary gọn nay giữ checkpoint freshness, resume state, sequence/blocker, affected work item và pending finalization.
- Browser smoke dùng profile dưới `.cache/browser-profiles` và dọn đúng process/profile sau khi chạy.

## Baseline Đợt 3 và pilot hiện hành

Project `phase3-vd04-asset-pilot` dùng `vd04_brute_force_to_optimization.mp4` từ nguồn người dùng cung cấp. Baseline Đợt 3 được giữ nguyên trong lịch sử:

- brief r2 → proposal r2 → creative direction r3;
- graphic Result local và Piper `vi_VN-vais1000-medium` Result thật;
- sequence r9, render `result-mtxaw6zq-5779e7b0`, 1080×1920, 30 fps, 12.021333 giây;
- ASR khớp đủ 17 từ lời dẫn theo thứ tự; mix `-17.5 LUFS`, peak `0.5614`, không có clipping candidate;
- review `passed_with_notes`: kỹ thuật, hình trực tiếp, ASR và mix đạt; chưa có human listening review;
- Agent ghi quyết định kỹ thuật theo ủy quyền thử nghiệm, không mạo nhận user approval và không gọi dịch vụ trả phí.

Pilot hiện hành là `pilot-preview` r10, Result `result-mty1pb0w-d6598cd6`: 1080×1920, 30 fps, đúng 12 giây theo creative direction r3. Lời Piper và tiếng nguồn được tách theo thời gian ở đoạn đầu; concept card có lời Piper riêng, typography/ngắt dòng mới và footer `Đợt 4`. Đuôi im lặng đo được 0,355 giây, mix `-18,46 LUFS`, true peak `-3,97 dBTP`. Nhánh thử sai `phase4-piper-revision` đã retire; project chỉ còn đúng một sequence hiện hành. Người dùng đã duyệt exact Result r10 qua decision `decision-mty9rm88-79542c18`; Đợt 4 đã đóng.

Project hiện có checkpoint `current`, không workflow active, không approval chờ, không blocker/dependency stale và không pending finalization.

## Kiểm chứng mới nhất

- `npm test`: 165/165 pass.
- `npm run analysis:test`: 20/20 pass.
- `npm run production:acceptance`: pass có giới hạn đã công bố; pilot contract và browser timeline/seek/player ở viewport 390/768/1440 đều đạt.
- `npm run tts:acceptance`: 16/16 test TTS pass; Piper available, ElevenLabs unavailable vì chưa có credential.
- `npm run assets:acceptance`: pass, gồm image/audio/attribution/player và viewport 390/768/1440.
- `npm run creative:acceptance`: pass với giới hạn đã công bố; repository 160/160 và browser pass.

## Giới hạn còn lại

- Chưa nghe duyệt chất giọng Piper bằng tai người; ASR và số đo audio không thay thế đánh giá tự nhiên/cảm xúc.
- Chưa gọi ElevenLabs thật, chưa kiểm chứng catalog/quota/voice của tài khoản thật.
- Ảnh AI và tìm kiếm stock tự động chưa triển khai; chỉ thêm khi project thật chứng minh nhu cầu.
- Các gate release rộng của Đợt 1 vẫn `not_measured`; `releaseDefault` vẫn là `null`.

## Bước tiếp theo

Triển khai **Đợt 5A — observer hiệu quả và phản hồi gắn phiên bản**: thêm generation/ETag để project không đổi không tải lại full context; tách summary nhẹ khỏi dữ liệu chi tiết và lazy-load phần nặng; gắn thao tác so sánh/phản hồi vào exact Result/revision; đặt regression budget cho payload, polling và bảo toàn player. Không hồi sinh nhánh `phase4-piper-revision` và không mở provider mới.

## Cập nhật Đợt 4 — 2026-09-12

Đã triển khai sequence 1.1 và renderer composition: timing lời đọc, automation
âm thanh, music/ducking/loudness, caption style, overlay, animation preset,
transition và timeline quan sát. Chi tiết trong [đặc tả](PHASE4-PRODUCTION-SPEC.md).
Bản sửa giữ footage nguồn 8 giây và concept card 4 giây. Tiếng nguồn tắt trong phần
lời Piper đầu, mở có chủ ý từ giây 4–8; card có lời Piper riêng nên không còn khoảng
im lặng 4,075 giây. Bản cũ và nhánh thử sai vẫn còn dưới dạng lịch sử. Phản hồi user
đã ghi vào project; approval của người dùng chỉ gắn exact Result r10. Đợt 4 đã đóng.
Trạng thái kiểm tra cuối nằm ở
[report](../../reports/phase4-production-acceptance.json) và
[pilot](../../reports/phase4-pilot.json). Ưu tiên tiếp theo là review đúng bản này
và sửa finding cụ thể; chưa tự chuyển sang Đợt 5 hoặc mở provider mới.
