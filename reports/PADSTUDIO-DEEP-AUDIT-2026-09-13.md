# PADStudio — rà soát sâu hiện trạng và hướng triển khai tiếp

## Kết luận điều hành

PADStudio hiện đã hoàn thành cả sáu đợt practical và một lượt hardening output QA trên máy owner. Đây không còn là demo ghép video: hệ có project store bền vững, provenance Run/Result, artifact revision, workflow thích nghi, source analysis, production, exact feedback, local delivery, doctor/recovery và automated output QA. Không có căn cứ để viết lại lõi.

### Chốt phạm vi V1 practical sau triển khai

- Không còn bug code đã biết nào chặn vòng project → render → exact QA → Agent review →
  user acceptance → local delivery.
- V1 practical sẵn sàng để người dùng dùng thử trên máy owner; không mở thêm provider,
  renderer hay pipeline trước khi có ma sát thật từ lần dùng đó.
- Broad release vẫn chưa được chứng nhận: 16 release gate cần corpus holdout và human
  viewing/listening thật đang `not_measured`. Đây là bằng chứng còn thiếu, không phải một backlog
  code cần tiếp tục nở ra.
- Hai project lịch sử còn file `legacy_unchecked`; giữ ở trạng thái `attention`, không sửa ngược
  Result bất biến. Project thật hiện tại không có integrity failure.

Code tại commit `5475bff` chạy lại đạt 235/235 test Node, 20/20 test source-analysis và `operations:acceptance` trả `passed_with_documented_limits`. Doctor nhanh báo `ready`, 21 capability đều dùng được, 21/22 tool dùng được; ElevenLabs là tool duy nhất unavailable vì chưa cấu hình credential. Broad release vẫn bị chặn đúng thiết kế: 16/16 gate là `not_measured`, `releaseDefault` là `null`.[1][2][3]

Ưu tiên tiếp theo không nên là thêm hàng loạt provider hay sao chép pipeline OpenMontage. Nên mở một đợt “product validation + promise-driven review”: khóa lời hứa đầu ra từ direction, tăng QA hình ảnh/audio theo chính lời hứa đó, thu human viewing/listening exact Result, và xây holdout đa dạng độc lập. Sau đó mới chọn giữa chat tích hợp, renderer giàu motion, hoặc provider mới dựa trên ma sát thật.

## Hệ thống đã có

### Cập nhật sau audit

Finding Doctor đã được vá: `video.inspect-output` nay là capability practical bắt buộc của
delivery. Finding promise-driven review cũng đã được triển khai theo lát nhỏ: direction lưu
`deliveryPromise` linh hoạt, Observer hiển thị promise/fallback, và delivery fail-closed nếu
exact Result chưa có Agent review chứng minh mọi requirement `blocking`. Không thêm pipeline
cố định, provider hoặc truth store mới; project legacy vẫn tương thích.

Human full viewing/listening vẫn cố ý là `not_performed` cho tới khi người dùng thực sự dùng
thử. Agent review bằng contact sheet, ASR và technical evidence không được gọi là human review.

| Lớp | Trạng thái hiện tại |
| --- | --- |
| Project store | Project/resource/run/result/artifact/review/decision/workflow/checkpoint; output thuộc project; SHA-256 và path safety; reopen/recovery |
| Agent context | Full context và summary gọn; pending feedback/finalization; capability thực; relevant skills; freshness |
| Source understanding | Probe, scene detection, frame/contact sheet, audio analysis, word-level ASR, preview, search/query/correction |
| Creative/workflow | Brief, proposal, direction, revision/candidate/current semantics, dependency impact, review và approval gates |
| Tools/executor | 21 capability/22 tool; Registry → availability → prepare → execute → verify → Result/Run; không silent fallback |
| Production | trim/concat/reformat/thumbnail/subtitle/audio overlay/image-to-video/graphic/TTS và sequence renderer có caption, overlay, transition, music/ducking |
| Feedback/UI | Observer chỉ đọc, section/lazy load, ETag/generation, exact Result comparison, feedback theo segment/time, Health và Delivery |
| Delivery/operations | Exact accepted Result, automated QA gate, bundle metadata/checksum, doctor quick/deep, dry-run recovery và runbook |

Kiến trúc vẫn đúng định hướng: Agent chọn việc sáng tạo; PADStudio giữ project, quyền chạy và dấu vết; web hiện chỉ quan sát. Chat thật trong cùng ứng dụng vẫn là đích sản phẩm nhưng chưa được triển khai; hiện Agent host bên ngoài điều khiển bằng CLI.[4][5]

## Kiểm chứng độc lập trong lượt rà soát

- `npm test`: 235 pass, 0 fail/skip/todo.
- `npm run analysis:test`: 20 pass.
- `npm run operations:acceptance`: `passed_with_documented_limits`.
- Coverage Node: 81,93% line, 74,26% branch, 88,69% function. Lõi project/intelligence/production phần lớn cao; adapter media phổ thông còn nhiều branch chưa đi qua. Unit coverage UI thấp (8,70–30,93%) và phải dựa thêm browser acceptance.
- Doctor nhanh: `ready`; Node 24.18.1; khoảng 209 GB trống; FFmpeg/ffprobe 8.1.2; faster-whisper CUDA FP16; Piper tiếng Việt; Chrome local.
- Deep doctor: `real-pilot-longest-substring` 69/69 file verified; `source-c-verification-20260909` 56/56; `phase2-brute-force-pilot` 29/43 với 14 legacy unchecked; `phase3-vd04-asset-pilot` 64/80 với 16 legacy unchecked; không project nào có file failed.
- Broad-release evaluator: 0/16 measured, 16/16 `not_measured`; trạng thái `blocked` và `releaseDefault: null`.

Các lỗi chính của audit 12/09 đã được đóng: sequence canonical/candidate, silent tail và direction mismatch của pilot, full-context polling, exact feedback, mutation race, local delivery, recovery và exact-output QA đều đã có implementation/test/acceptance mới.[6]

## Findings hiện tại

### P0 — Chưa có bằng chứng chất lượng cảm nhận của người thật

Machine QA chủ động ghi human visual/auditory review là `not_performed`. Nó full-decode, kiểm tra số frame/contact sheet, clipping, speech lead/tail, confidence từ cuối và biên cắt; nhưng không chứng minh hình đúng nghĩa, nhịp dựng tốt, chữ không bị che ở mọi thời điểm, hay giọng tự nhiên/có cảm xúc. Đây là giới hạn trung thực, không phải bug; nhưng là blocker lớn nhất trước khi gọi hệ thống “release-ready”.[7]

Hành động: thêm một contract human attestation gắn exact Result/checksum và coverage (`watched_full`, `listened_full`, device/context, findings, verdict). Tái sử dụng review/decision hiện có; không tạo một truth store thứ hai. Delivery practical có thể tiếp tục như hiện nay, còn release gate chỉ nhận attestation exact target.

### P0 — Corpus hiện tại không phải holdout và quá đồng nhất

`D:\Test\vid` hiện có đúng 25 MP4, tổng 6.056,723 giây; tất cả 1080×1920, H.264, 30 fps, AAC stereo. Đây là corpus tốt cho video giáo dục dọc tiếng Việt/code-switch, subtitle timing và cut boundary. Nó không kiểm chứng landscape, VFR, 4K, multitrack, stream offset, audio/image-only, nguồn 2 giờ hoặc diversity rộng. Corpus này cũng đã được dùng trong phát triển nên không còn độc lập.[8]

Hành động: giữ 25 video này làm development/regression corpus; tạo một corpus holdout quyền sử dụng rõ, khóa hash, do người gán gold transcript/scene boundary, và thêm các dạng media còn thiếu. Không dùng lại cùng 25 file để tự chứng nhận broad release.

### P1 — Output QA mới kiểm tra “evidence tồn tại”, chưa kiểm tra nội dung pixel đủ sâu

Check `visual-samples` hiện chỉ yêu cầu số frame và số contact sheet đạt ngưỡng; visual-quality preflight phần lớn dựa trên metadata/layout. Nó chưa phát hiện có hệ thống black/frozen frame, transition glitch, caption raster bị cắt/che, duplicate on-screen text, visual repetition hay “animated slideshow” trái lời hứa. Đây là khoảng trống rõ nhất còn lại sau Phase 7.[7][9]

Hành động: thêm các check độc lập, trước hết black/freeze/duplicate-frame windows và sampling tại đầu–giữa–cuối mỗi transition/overlay/caption interval. Kết quả nên là evidence/finding; không tự nhận xét thẩm mỹ. OCR/caption raster và semantic review chỉ mở khi có pilot chứng minh giá trị.

### Đã đóng — Lời hứa đầu ra xuyên direction → render → review

PADStudio đã có review criteria, exact approval, output profile và release gate `representative_delivery_promise_review`, nhưng chưa có một acceptance/delivery promise nhỏ, versioned và machine-readable chứa duration intent, source/motion/audio/caption requirements, quality floor và fallback được duyệt. Audit cũ đã bắt được một output “đúng schema nhưng sai lời hứa”; hardening hiện tại chặn một số biểu hiện, chưa khái quát hóa contract này.[3][6]

OpenMontage có `delivery_promise` và pre-compose validator để phát hiện silent downgrade, thiếu audio, narration/music lệch duration. Ý tưởng đáng học là promise preservation, không phải enum pipeline hay ngưỡng motion cứng của họ.[10]

Đã triển khai dưới tên `deliveryPromise`: requirement có ID, bằng chứng cần dùng và cờ
`blocking`; fallback cho phép/cấm được khai báo rõ. Delivery yêu cầu passing Agent review trên
exact render Result và criterion `passed` cho từng requirement bắt buộc. User approval vẫn độc
lập và hệ không tự chọn fallback.

### P1 — Capability discovery đủ an toàn nhưng chưa đủ giàu để Agent chọn tốt khi hệ mở rộng

Registry hiện nêu capability, provider, runtime, input schema, output, side effect, cost và availability. Nó chưa nêu `bestFor`, hạn chế chất lượng, install/setup path có cấu trúc, alternatives, hay skill bắt buộc theo tool. Với một tool/capability thì chưa đau; khi thêm image/video/music/provider, Agent sẽ phải suy luận từ description hoặc tài liệu rời.[11]

OpenMontage đáng học ở support envelope/provider menu và liên kết tool → skill. Không nên học selector tự fallback; PADStudio đang đúng khi yêu cầu exact tool/capability và không thay nhà cung cấp âm thầm.[12]

Hành động: mở rộng public tool contract tối thiểu với `bestFor`, `limitations`, `setup`, `skillIds`, `usage/cost unit`, và alternatives chỉ để trình bày. Việc chọn/chuyển tool vẫn do Agent/người dùng quyết định.

### P1 — Quản trị chi phí mới sâu cho ElevenLabs, chưa là ngân sách project

Exact single-use credit authorization, request hash, provider receipt và recovery của PADStudio mạnh hơn cơ chế chung trong OpenMontage. Tuy nhiên hiện chỉ có một paid tool và chưa có budget total, reserve theo kế hoạch, aggregate spend, threshold hay multi-provider reconciliation.[13]

Hành động: chưa cần xây ngay. Chỉ mở project budget ledger khi provider trả phí thứ hai hoặc batch generation xuất hiện. Khi đó học pattern estimate → reserve → reconcile, nhưng giữ atomic project store, exact authorization và receipt-first recovery của PADStudio; không sao chép file JSON ghi trực tiếp/raw path của OpenMontage.

### P1 — Đích “một UI có chat thật” vẫn chưa đạt

Thiết kế hiện hành mô tả một ứng dụng với Chat và Web cùng dùng một project, nhưng triển khai tạm vẫn là Agent host bên ngoài + observer local. Đây là khoảng cách sản phẩm lớn nhất, không phải lỗi lõi.[4][5]

Hành động cần quyết định owner trước: host/SDK Agent nào, trust boundary, cách nhập attachment, streaming, approval UX và quyền mutation. Không nên tự xây chat client hoặc gắn provider vào core trước khi contract này được chốt.

### P2 — Hai project legacy còn file không thể chứng minh exact bytes

Deep doctor báo 30 file legacy unchecked tổng cộng, không có corruption. Không nên sửa ngược immutable Result hoặc giả checksum lịch sử. Nếu các file này cần tiếp tục làm nguồn cho deliverable mới, tạo Result/checkpoint mới có verification hiện tại; nếu chỉ là lịch sử thì giữ `attention` như đang làm.[14]

### P2 — Test breadth tốt nhưng branch coverage adapter/UI còn là điểm mù

Coverage tổng thể khá, nhưng `ffmpeg-video-reformatter`, thumbnail, trim, subtitle, concat, image-to-video và audio-overlay còn branch coverage khoảng 38–64%. Ba view module lớn có line coverage unit thấp; browser acceptance bù hành vi chính nhưng không chứng minh mọi lỗi render/data edge case.

Hành động: thêm matrix test theo media diversity và property/contract tests cho option combinations; browser bug-bash tập trung empty/legacy/corrupt/large/many-results states. Không đặt mục tiêu coverage số học chung chung; dùng uncovered branch để chọn case có rủi ro.

## Học OpenMontage: lấy gì và bỏ gì

### Nên học

1. Delivery promise và kiểm tra silent downgrade.
2. Pre-compose validation cho coverage audio/duration/assets trước render.
3. Reviewer checklist chính xác–đầy đủ–có cách sửa; review actual render, nhiều frame, audio và promise preservation.
4. Tool support envelope/provider menu giàu thông tin, tool liên kết skill hướng dẫn sử dụng.
5. Taste direction/variation/slideshow-risk như skill hoặc advisory finding, không phải quyết định tự động.
6. Runtime decision matrix khi PADStudio thật sự có renderer thứ hai.

### Không nên sao chép

1. Pipeline/stage bắt buộc cho mọi video.
2. Selector tự fallback provider.
3. Raw input/output path và project folder convention làm contract lõi.
4. Số lượng provider lớn như thước đo readiness.
5. Ngưỡng thẩm mỹ cứng hoặc reviewer tự chấp nhận thay người dùng.
6. Cost tracker ghi JSON trực tiếp thay cho transaction/lock/recovery hiện có.

OpenMontage checkout được đối chiếu là commit `cd9f3c1` ngày 22/08/2026. Không chạy được subset pytest vì môi trường checkout thiếu package `pytest`; vì vậy các pattern trên được đánh giá từ source, contract và test source, không tuyên bố test suite OpenMontage đã pass.

## Phần còn lại sau V1 practical

### Bắt buộc trước broad release — người dùng dùng thử và human exact-review

- Contract attestation exact Result/checksum.
- Observer hiển thị coverage và trạng thái chưa xem/nghe.
- Release evaluator nhận evidence thật.
- Chạy trên 3–5 video development corpus và người thật xem/nghe toàn bộ.

### Đã triển khai phần gate — Promise-driven QA

- Optional delivery promise trong direction: **đã làm**.
- Exact Agent review và delivery fail-closed theo blocking promise: **đã làm**.
- Pre-render promise check: chỉ làm thêm nếu dùng thử chứng minh việc phát hiện sau render gây
  lãng phí đáng kể.
- Post-render black/freeze/transition/caption-window sampling.
- Review/result giữ `passed/failed/not_measured`, không tự duyệt thẩm mỹ.

### Lát 3 — Holdout và media-diversity gates

- Holdout độc lập, version-locked, rights-cleared.
- Gold transcript/scene labels có human provenance.
- Landscape, VFR, 4K, multitrack, offset, corrupt, audio/image-only và nguồn dài.
- Đo lại 16 broad-release gate; chỉ owner quyết định release.

### Lát 4 — Chọn một nhánh sản phẩm theo ma sát thật

- Chat integration nếu mục tiêu là trải nghiệm một ứng dụng.
- Renderer motion/bespoke nếu output hiện tại bị giới hạn sáng tạo.
- Image/stock/music provider nếu project thật thiếu asset.
- Budget ledger nếu thêm paid provider/batch generation.

## Sources

1. PADStudio, [trạng thái tại thời điểm audit](../docs/build/history/PADSTUDIO-STATE-AND-NEXT.md), các mục “Kiểm chứng mới nhất” và “Automated output QA”.
2. PADStudio, [tool registry](../src/execution/tool-registry.js) và runtime `tool:list`, kiểm tra ngày 13/09/2026.
3. PADStudio, [release gates](../src/release/release-gates.js) và [manifest](../eval/release-gates/manifest.json).
4. PADStudio, [định hướng hiện tại](../docs/build/PADSTUDIO-CURRENT-DIRECTION.md), các mục “Một UI, một project”, “Chat điều khiển, web quan sát” và “Triển khai tạm thời”.
5. PADStudio, [web server](../src/web/server.js), observer GET-only và bind localhost.
6. PADStudio, [deep audit 12/09](./PADSTUDIO-DEEP-AUDIT-2026-09-12.md) và các commit sau `beb2af8` đến `5475bff`.
7. PADStudio, [Phase 7 Output QA](../docs/build/PHASE7-OUTPUT-QA-SPEC.md) và [implementation](../src/tools/local-output-quality.js).
8. Corpus owner `D:\Test\vid`, ffprobe inventory ngày 13/09/2026; 25 MP4, 6.056,723 giây.
9. PADStudio, [visual quality](../src/production/visual-quality.js) và [coverage run](../package.json) bằng Node 24 `--experimental-test-coverage`.
10. OpenMontage `cd9f3c1`, `lib/delivery_promise.py` và `tools/analysis/composition_validator.py`.
11. PADStudio, [tool discovery](../src/execution/tool-discovery.js) và [skill catalog](../skills/catalog.json).
12. OpenMontage `cd9f3c1`, `tools/tool_registry.py`, `AGENT_GUIDE.md` và `skills/meta/animation-runtime-selector.md`.
13. PADStudio, [execution authorization](../src/execution/execution-authorizations.js) và [tool executor](../src/execution/tool-executor.js); OpenMontage `tools/cost_tracker.py`.
14. PADStudio deep doctor trên bốn project local, kiểm tra ngày 13/09/2026.
