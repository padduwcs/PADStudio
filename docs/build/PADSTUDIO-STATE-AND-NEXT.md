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
- Đợt 6B hoàn tất practical: có system/project doctor, health chỉ đọc, kế hoạch phục hồi mặc định dry-run, apply phục hồi finalization an toàn và runbook vận hành/backup/restore/rollback.
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

- `npm run operations:acceptance`: `passed_with_documented_limits`.
- Repository: 226/226 pass; source-analysis harness: 20/20 pass.
- Browser: timeline/seek, player preservation, conditional polling, lazy activity, feedback anchor, exact Result selection/comparison, Health và Delivery đều pass ở 390/768/1440 px.
- Deep doctor pilot: health `ready`, 48 file xác minh checksum, 32 file lịch sử chưa có checksum, 0 file lỗi; trạng thái hệ thống là `attention` chứ không chặn vì dữ liệu legacy được báo rõ.
- E2E project mới: render bị ngắt đúng lúc finalization, mở lại và phục hồi đúng một lần không render trùng; lần phục hồi kế tiếp không còn việc; approval, delivery, reopen và deep verify 9/9 file đều đạt.
- Agent summary pilot: 19.008 byte; full context: 424.516 byte; giới hạn 32 KiB đạt.
- Persistence/reopen, target mismatch/out-of-range, explicit resolution, concurrent append/double-resolve và lock cleanup đều pass.
- Delivery pilot: full decode, exact-byte copy, MP4/H.264/yuv420p 1080×1920 30 fps, AAC 48 kHz stereo, -18,46 LUFS, -3,97 dBTP, tail silence 0,355 giây đều pass.
- Pilot thật Longest Substring: deep doctor `ready`, 39/39 file xác minh, 0 pending feedback/finalization; delivery r2 giữ exact SHA-256 của Result và đạt đủ 8 gate xuất bản local.
- Báo cáo: [phase6b-operations-acceptance.json](../../reports/phase6b-operations-acceptance.json).
## Giới hạn còn lại

- Chưa nghe duyệt chất giọng Piper bằng tai người; ASR và số đo audio không thay thế đánh giá tự nhiên/cảm xúc.
- Chưa gọi ElevenLabs thật, chưa kiểm chứng catalog/quota/voice của tài khoản thật.
- Ảnh AI và tìm kiếm stock tự động chưa triển khai; chỉ thêm khi project thật chứng minh nhu cầu.
- Các gate release rộng của Đợt 1 vẫn `not_measured`; `releaseDefault` vẫn là `null`.

## Bước tiếp theo

**Sáu đợt practical đã hoàn thành.** Đợt hardening tiếp theo đã sửa import đồng thời, lease/owner-token và stale-takeover nhiều contender của mutation lock, đồng thời làm Phase 6A/6B acceptance tự tạo fixture thay vì phụ thuộc project ignored trên máy owner. Repository hiện có 226 test.

Project thật `real-pilot-longest-substring` đã đi qua import → probe/scenes/frames/audio/ASR/preview → brief/direction/sequence → render → review/acceptance → delivery. Lần tự duyệt phát hiện r1 cắt hụt âm cuối nên đã tạo r2 ở 320,2–330,0 giây. Exact Result hiện hành `result-mtzsqygo-18e21678` dài 9,821333 giây; exact-output ASR giữ trọn câu đến 9,36 giây, không có clipping candidate và hình đã được kiểm tra bằng contact sheet cùng lấy mẫu tiêu đề 4 fps. Theo ủy quyền rõ của người dùng, Decision `decision-mtzswrzy-57d409a2` chấp nhận đúng artifact r2; delivery `result-mtzswyx2-5fe1c724` giữ nguyên SHA-256 `9e519a1a06bf1cc22c9f26105b00b3b9098bef5561baee39e7b2e10b61b3ea5f`. Deep doctor `ready`, xác minh 39/39 file và không còn việc vận hành chờ. Bằng chứng ở [real-project-pilot.json](../../reports/real-project-pilot.json).

## Cập nhật Lượt 4 — automated output QA

Lượt 4 đã hoàn tất cổng QA cho exact render. Capability `video.inspect-output` tạo
Result `video.output-quality` có checksum nguồn, evidence probe/frame/contact
sheet/audio/ASR, full decode, clipping, speech lead/tail, final-word confidence và
kiểm tra điểm cắt so với word timestamp của transcript nguồn. Delivery nay fail-closed
khi thiếu QA, QA fail, evidence hỏng hoặc byte render thay đổi; bundle có thêm
`metadata/quality.json`. Observer hiển thị toàn bộ check nhưng ghi trung thực human
visual/auditory review là `not_performed`.

Repository đạt 235/235 test, source-analysis harness đạt 20/20 và
`npm run operations:acceptance` đạt `passed_with_documented_limits`, gồm browser
390/768/1440 và deep integrity 18/18 file cho fixture mới. Trên pilot thật, r1
`result-mtzrmwks-16f4b02a` bị chặn đúng bởi QA `result-mtzwewlx-f301cb72` vì
speech lead/tail và điểm 329,5 giây cắt xuyên từ kết thúc ở 329,58; r2
`result-mtzsqygo-18e21678` vượt QA `result-mtzwel2w-3dd8a50a`, có source end
margin 0,42 giây và speech tail 0,461 giây. Bundle hiện hành có QA là
`result-mtzwelfe-ebf48d25`; bundle cũ vẫn được giữ
như lịch sử và không còn là đường xuất hiện hành.
Deep doctor sau cùng xác minh 69/69 file, không có file lỗi; checkpoint đã fresh và
project trở lại `ready`.

Bằng chứng tổng hợp: [phase7-output-qa-acceptance.json](../../reports/phase7-output-qa-acceptance.json).

Giới hạn còn lại không đổi: machine QA không thay thế việc một người thực sự xem toàn
bộ video, nghe độ tự nhiên/cảm xúc của giọng và duyệt sáng tạo. Đây là lớp kiểm chứng
độc lập, không được tự động đánh dấu đạt.

Bước tiếp theo không còn là hoàn tất pilot này mà là chọn cải tiến sản phẩm dựa trên ma sát quan sát được. Giới hạn đã ghi rõ: môi trường Agent không phát audio trực tiếp nên review âm thanh dùng full decode, ASR mức từ và số đo kỹ thuật; human audition về độ tự nhiên/cảm xúc vẫn là một lớp kiểm chứng độc lập. Các việc độc lập khác là kiểm chứng provider/tài khoản thật và các release gate/corpus rộng; `releaseDefault` vẫn là `null`.
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

## Cập nhật Đợt 6B — 2026-09-13

`padstudio:doctor` kiểm tra runtime, quyền đọc/ghi, dung lượng, capability bắt buộc/tùy chọn và health project; `--deep` xác minh từng Result file mà không sửa dữ liệu. `project:recover` mặc định chỉ lập kế hoạch, còn `--apply` chỉ hoàn tất bằng chứng đã bền vững dưới project lock, bỏ qua trường hợp không an toàn và chạy lặp không tạo Result/render trùng. Observer có Health chỉ đọc và Agent summary mang trạng thái sẵn sàng.

Runbook vận hành nằm tại [OPERATIONS-RUNBOOK.md](../OPERATIONS-RUNBOOK.md). Acceptance tạo project mới, tiêm lỗi finalization sau render, reopen/recover, duyệt exact Result, xuất bundle, reopen/deep verify và kiểm tra browser; kết quả 191/191 repository tests, 20/20 analysis tests, 9/9 file fixture và ba viewport đều đạt. Chi tiết tại [đặc tả 6B](PHASE6B-OPERATIONS-SPEC.md) và [report](../../reports/phase6b-operations-acceptance.json). Đợt 6 practical đã đóng với các giới hạn đã ghi rõ.

## Cập nhật hardening — 2026-09-13

Integrity/Doctor nay phân biệt file `legacy_unchecked` với corruption thật, dùng checksum legacy của primary và từng sequence segment khi có, phát hiện cả thay đổi giữ nguyên kích thước và chỉ đưa remediation đúng nguyên nhân. Visual-quality contract kiểm tra contrast, safe area, cỡ chữ, số dòng, tốc độ đọc và wrap theo Unicode cho graphic/sequence; observer có baseline regression, accessibility smoke và kiểm tra nhãn timeline ở 390/768/1440 px. Catalog production có 3 output profile và 5 style playbook, chỉ chọn tường minh và không tạo pipeline/default mới.

Broad-release checklist nay có 16 gate fail-closed cùng CLI/acceptance. Khi thiếu evidence, toàn bộ vẫn `not_measured`; fixture chỉ kiểm tra evaluator, human viewing/listening và corpus holdout vẫn chưa được đo. `releaseDefault` tiếp tục là `null` và chỉ người phụ trách mới có thể đưa ra quyết định release riêng.
