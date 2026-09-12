# PADStudio — trạng thái hiện tại và bước tiếp theo

Cập nhật: **2026-09-13**. Đây là bản tóm tắt vận hành hiện hành; khi số liệu cũ trong tài liệu gói khác nhau, ưu tiên code, report nghiệm thu mới nhất và tài liệu này.

## Đã có và dùng được

- Kho project bền vững cho resource, run/result, artifact có revision, review, decision, workflow và checkpoint.
- Đợt 1 practical: probe, scene, frame/contact sheet, audio analysis, ASR, preview, source assessment/search/freshness và observer chỉ đọc.
- Đợt 2 practical: brief → proposal → direction → sequence/render → review/approval, sửa cục bộ và reuse segment.
- Đợt 3 practical local: `graphic.render`, `audio.prepare`, `media.acquire`, Piper/ElevenLabs qua `tts.synthesize`; ElevenLabs có exact single-use credit authorization.
- Context summary gọn giữ checkpoint freshness, resume state, sequence/render pointer, affected work item, pending finalization và exact pending feedback; pilot hiện 19.008 byte so với full context 424.516 byte.
- Đợt 5 hoàn tất: observer generation/ETag và lazy section, exact Result selection/comparison, feedback target Result/artifact revision/segment/time, explicit resolution và concurrent-write protection.
- Đợt 6A hoàn tất: local delivery chỉ xuất exact Result user đã duyệt; có current/freshness/finalization/integrity/media gate, bundle metadata/checksums và khu vực Delivery chỉ đọc.
- Browser smoke dùng profile dưới `.cache/browser-profiles` và dọn đúng process/profile sau khi chạy.

## Baseline Đợt 3 và pilot hiện hành

Project `phase3-vd04-asset-pilot` dùng `vd04_brute_force_to_optimization.mp4` từ nguồn người dùng cung cấp. Baseline Đợt 3 được giữ nguyên trong lịch sử:

- brief r2 → proposal r2 → creative direction r3;
- graphic Result local và Piper `vi_VN-vais1000-medium` Result thật;
- sequence r9, render `result-mtxaw6zq-5779e7b0`, 1080×1920, 30 fps, 12.021333 giây;
- ASR khớp đủ 17 từ lời dẫn theo thứ tự; mix `-17.5 LUFS`, peak `0.5614`, không có clipping candidate;
- review `passed_with_notes`: kỹ thuật, hình trực tiếp, ASR và mix đạt; chưa có human listening review;
- Agent ghi quyết định kỹ thuật theo ủy quyền thử nghiệm, không mạo nhận user approval và không gọi dịch vụ trả phí.

Pilot hiện hành là `pilot-preview` r10, Result `result-mty1pb0w-d6598cd6`: 1080×1920, 30 fps, đúng 12 giây theo creative direction r3. Lời Piper và tiếng nguồn được tách theo thời gian ở đoạn đầu; concept card có lời Piper riêng, typography/ngắt dòng mới và footer `Đợt 4`. Đuôi im lặng đo được 0,355 giây, mix `-18,46 LUFS`, true peak `-3,97 dBTP`. Nhánh thử sai `phase4-piper-revision` đã retire; project chỉ còn đúng một sequence hiện hành. Người dùng đã duyệt exact Result r10; decision `decision-mtynk1s9-365231d1` gắn exact target và giải quyết tường minh feedback legacy r9.

Bundle bàn giao `result-mtynkixa-db2410bc` giữ nguyên SHA-256 video nguồn `d5b069354e83a3c1bfcad329f85adafa9005e7735e58cb0fceeae73518165a14`, kèm manifest, provenance, reviews, approval và checksums. Project không workflow active, không approval/feedback chờ, không blocker/dependency stale và không pending finalization.

## Kiểm chứng mới nhất

- `npm run delivery:acceptance`: `passed_with_documented_limits`.
- Repository: 183/183 pass; source-analysis harness: 20/20 pass.
- Browser: timeline/seek, player preservation, conditional polling, lazy activity, feedback anchor, exact Result selection/comparison đều pass ở 390/768/1440 px.
- Agent summary pilot: 19.008 byte; full context: 424.516 byte; giới hạn 32 KiB đạt.
- Persistence/reopen, target mismatch/out-of-range, explicit resolution, concurrent append/double-resolve và lock cleanup đều pass.
- Delivery pilot: full decode, exact-byte copy, MP4/H.264/yuv420p 1080×1920 30 fps, AAC 48 kHz stereo, -18,46 LUFS, -3,97 dBTP, tail silence 0,355 giây đều pass.
- Báo cáo: [phase6a-delivery-acceptance.json](../../reports/phase6a-delivery-acceptance.json).
## Giới hạn còn lại

- Chưa nghe duyệt chất giọng Piper bằng tai người; ASR và số đo audio không thay thế đánh giá tự nhiên/cảm xúc.
- Chưa gọi ElevenLabs thật, chưa kiểm chứng catalog/quota/voice của tài khoản thật.
- Ảnh AI và tìm kiếm stock tự động chưa triển khai; chỉ thêm khi project thật chứng minh nhu cầu.
- Các gate release rộng của Đợt 1 vẫn `not_measured`; `releaseDefault` vẫn là `null`.

## Bước tiếp theo

Đợt 6A đã đóng. Bước kế tiếp là **Đợt 6B — vận hành ổn định và bàn giao hệ thống**: rà setup/doctor, phục hồi/chạy lại xuyên suốt, hướng dẫn vận hành và một acceptance từ project mới đến bundle. Vẫn chưa tự mở nền tảng xuất bản, cloud worker hay provider mới.
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
[pilot](../../reports/phase4-pilot.json). Tại thời điểm đóng Đợt 4, điểm bàn giao là review đúng bản này
và chỉ chuyển đợt sau khi người phụ trách yêu cầu; điều đó nay đã diễn ra với Đợt 5A.

## Cập nhật Đợt 5A — 2026-09-12

Observer đã chuyển sang snapshot theo generation/ETag, tách summary và detail tải lười, giữ player khi polling không đổi và thêm mốc phản hồi exact Result/artifact/revision/segment/time. Mutation artifact/workflow/review đã được tuần tự hóa; sửa workflow bắt buộc `expectedRevision`. Acceptance đạt 171/171 repository tests, 20/20 analysis tests và browser 390/768/1440; summary pilot 6.028 byte so với full context cũ 424.020 byte. Chi tiết tại [đặc tả](PHASE5A-OBSERVER-SPEC.md) và [report](../../reports/phase5a-observer-acceptance.json). Đợt 5A đã đạt acceptance riêng nhưng chưa đóng toàn bộ Đợt 5. Điểm tiếp tục là Đợt 5B; chỉ sau khi vòng feedback exact target và Agent summary được nghiệm thu mới đánh giá chuyển Đợt 6A.

## Cập nhật Đợt 5B — 2026-09-12

Decision của sequence render nay bắt buộc `feedbackTarget` khớp exact Result/artifact revision; segment/time range được kiểm tra biên và resolution dùng `resolvesDecisionIds` append-only. Full/summary context đưa feedback chưa giải quyết trở lại Agent. Production observer chọn và so sánh từng Result, kể cả nhiều Result của cùng revision, và đặt feedback đúng panel/segment. File lock đã xử lý thêm contention `EPERM/EACCES` trên Windows, loại race hiếm từng làm test 5A chập chờn. Acceptance 177/177 + 20/20 + browser ba viewport đã đạt; Đợt 5 được đóng. Một feedback legacy của pilot vẫn được bảo toàn dưới dạng chưa resolve vì hệ thống không suy đoán/backfill quyết định lịch sử.

## Cập nhật Đợt 6A — 2026-09-13

Capability `video.export-delivery` và tool `local-delivery` đóng gói nguyên byte exact Result đã accepted. Gate từ chối approval cũ bị quyết định mới thay thế, pending feedback cùng sequence, stale dependency/analysis, run chưa finalization, thiếu/sai checksum, profile sai, decode lỗi, loudness/true peak/tail silence ngoài giới hạn. Mọi Result file mới đều có SHA-256; đường tool/UI xác minh checksum đã biết. Observer snapshot retry khi mutation xen giữa assemble và ETag. Project/Result Decision dùng chung mutex. Pilot r10 đã tạo bundle thật và feedback legacy được resolve bằng Decision append-only. Acceptance 183/183 + 20/20 + browser 390/768/1440 đạt; chi tiết ở [đặc tả](PHASE6A-LOCAL-DELIVERY-SPEC.md) và [report](../../reports/phase6a-delivery-acceptance.json).
