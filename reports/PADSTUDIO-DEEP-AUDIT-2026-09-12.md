# Rà soát sâu hiện trạng và hướng triển khai PADStudio

> Cập nhật sau triển khai cùng ngày: F1 và F2 đã được xử lý trong `pilot-preview` r10 / `result-mty1pb0w-d6598cd6`. Nhánh `phase4-piper-revision` đã retire; project chỉ còn một current sequence. Pilot trở lại 12 giây, có lời Piper ở concept card, đuôi im lặng đo được 0,355 giây, footer là `Đợt 4`. Store, UI, renderer và acceptance đã có contract current/candidate/history cùng silence diagnostics. Người dùng đã duyệt exact Result r10; Đợt 4 đã đóng. Các finding bên dưới được giữ nguyên như bằng chứng tại thời điểm audit; F3–F6 vẫn là backlog.

## Kết luận điều hành

PADStudio đã vượt xa một demo ghép video đơn giản. Ở commit `beb2af8`, hệ thống đã có kho project bền vững, provenance theo Run/Result, artifact có revision, workflow thích nghi, source analysis có freshness/recovery, 19 capability qua 20 tool, TTS local/cloud có kiểm soát credit, sequence renderer 1.1 và observer chỉ đọc. Toàn bộ 163 test repository chạy lại ngày 12/09/2026 đều đạt. Đây là một prototype local có nền dữ liệu và an toàn thực thi khá tốt, không cần viết lại lõi.[1][2][3]

Tuy nhiên, chưa nên coi Đợt 4 đã hoàn tất về sản phẩm. Bản pilot mới chỉ đạt kỹ thuật và chưa có user approval. Rà soát này tìm thấy hai lỗi logic trực tiếp trong pilot: bản sửa tạo 4,075 giây im lặng ở cuối và lệch tiêu chí direction 12 giây; đồng thời nó dùng một artifact key mới nên project hiện có hai sequence cùng `active`, thay vì một chuỗi revision/candidate được phân biệt rõ. Cổng acceptance hiện tại không phát hiện được cả hai lỗi này.[4][5][6]

Ưu tiên đúng không phải mở thêm provider hoặc chuyển ngay sang Đợt 5. Cần đóng một lát sửa Đợt 4: làm rõ bản canonical, sửa audio/typography theo exact feedback, thêm preflight và review về audio coverage/promise preservation, rồi người dùng xem-nghe đúng Result. Sau đó mới mở Đợt 5, trước hết xử lý payload observer/context và trải nghiệm so sánh-phản hồi theo phiên bản.

## Phạm vi và căn cứ

Rà soát đối chiếu:

- thiết kế, định hướng, roadmap, build outline, protocol và đặc tả capability hiện hành;
- code, test, Git history, report nghiệm thu và ba project runtime local;
- output thật của pilot Đợt 4, gồm Result record, hai review-frame và đo silence bằng FFmpeg;
- corpus tại `D:\Test\vid` và báo cáo benchmark đã có;
- checkout OpenMontage `cd9f3c1f03368be87b140af494914b8ee4e3c7a4` tại `D:\OpenMontage`, chỉ dùng làm nguồn tham khảo kiến trúc/QA, không chạy provider và không nhập code.

Working tree sạch trước và sau audit. Không sửa project runtime, không gọi dịch vụ trả phí và không đọc credential local.

## Hệ thống hiện có

### Kiến trúc vận hành

PADStudio đang vận hành theo mô hình Agent host bên ngoài điều khiển qua CLI; web local quan sát cùng project store. Chat thật trong cùng UI vẫn là đích sản phẩm, chưa phải chức năng đã triển khai. Web không có mutation/chat endpoint, đúng ranh giới “chat điều khiển, web quan sát”.[1][3]

| Lớp | Đã có | Độ chín hiện tại |
| --- | --- | --- |
| Project store | Project, Resource, Run, Result, authorization, Decision, Checkpoint; output workspace; ghi file nguyên tử | Dùng tốt cho local single-writer; recovery và path safety có test mạnh |
| Project intelligence | Artifact revision, brief/proposal/direction/source profile/assessment, review, workflow có dependency và approval | Đủ cho workflow thích nghi; chưa có một khái niệm canonical deliverable/candidate rõ khi nhiều sequence cùng active |
| Execution | Registry → availability → prepare → execute → verify → commit Result/finish Run; rollback và finalization recovery | Nền tốt; đặc biệt mạnh ở paid TTS exact authorization và receipt-first recovery |
| Source understanding | Probe, scene, frames/contact sheet, audio analysis, ASR, preview, query/search, correction, freshness | Practical trên máy owner; release-wide quality gate vẫn chưa đo |
| Asset/TTS | Graphic, audio prepare, public HTTPS acquire, Piper và ElevenLabs contract | Piper chạy thật; ElevenLabs chỉ integration giả lập vì chưa có credential |
| Production | Sequence 1.0/1.1; trim/concat/reformat/thumbnail/audio overlay/subtitle/image-to-video; sequence composition | Dựng tuần tự có overlay/caption/transition/music/ducking; chưa phải timeline nhiều lớp tổng quát |
| Observer | Source, creative và production view; preview, result trace, timeline/seek, responsive smoke | Dùng được nhưng polling/payload không scale |

Registry hiện báo 19 capability và 20 tool; 19 capability khả dụng vì `tts.synthesize` còn Piper dù ElevenLabs riêng lẻ unavailable. Môi trường thực tế có FFmpeg/ffprobe 8.1.2, browser local, Piper tiếng Việt và faster-whisper GPU FP16 sẵn sàng.[3][7]

### Trạng thái theo lộ trình

| Đợt | Trạng thái chính xác | Phần chưa được phép suy diễn là hoàn tất |
| --- | --- | --- |
| 1. Phân tích và hiểu tư liệu | Hoàn thành practical trên máy owner | `releaseDefault` vẫn `null`; chưa có holdout/gold, 2h, 4K/VFR/offset và benchmark release rộng |
| 2. Định hướng sáng tạo và duyệt mẫu | Hoàn thành practical; pilot r2 có exact user approval | Chưa chứng minh mọi loại project hoặc creative quality tự động |
| 3. Chuẩn bị nguyên liệu | Hoàn thành practical-local với graphic/audio/acquire/Piper và contract ElevenLabs | Chưa gọi ElevenLabs thật; chưa có image AI hay stock search tự động |
| 4. Dựng hình và âm thanh | Implementation và technical acceptance đã có | Creative acceptance của pilot mới chưa đạt; còn lỗi audio/direction/current-version nêu dưới đây |
| 5. Xem và phản hồi | Có observer nền ở cả source/creative/production | Chưa có trải nghiệm xuyên project tối ưu, chat tích hợp, delta update hoặc feedback binding trong UI |
| 6. Kiểm tra, xuất và vận hành | Có verify, recovery, MP4 và nhiều acceptance gate | Chưa có final-delivery contract/export bundle/preset bàn giao và operational hardening rộng |

Không nên quy đổi thành phần trăm tuyến tính. Đợt 1–3 đã đóng trong phạm vi đã chốt; Đợt 4 mới đạt technical slice chứ chưa đạt outcome người dùng.[2][8]

## Kiểm chứng mới trong lần rà soát

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 163/163 pass, 0 fail, 0 skip; khoảng 15,9 giây |
| Git | `main` tại `beb2af8`; working tree sạch |
| Project runtime | 3 project: phase2 pilot, phase3/4 pilot và source package-C verification |
| Pilot Đợt 4 | Checkpoint `current`, không workflow active, không pending approval record, không blocker dependency, không pending finalization |
| Exact Result | `result-mtxwm791-d9384eff`, 1080×1920, 30 fps, 8 giây, user approval `false` |
| Audio kỹ thuật | `-17,57 LUFS`, true peak `-4,88 dBTP`; silence từ `3,924687s` đến `8,000000s`, tổng `4,075312s` |
| Full context payload | phase2: 242.041 byte; phase3/4: 385.798 byte; source verification: 346.417 byte |
| Agent summary payload | phase3/4: 98.772 byte minified; riêng analysis 58.375 byte, capabilities 24.802 byte, active artifacts 13.499 byte |

Các số payload đo trực tiếp từ `ProjectContextAssembler.build()`/`buildSummary()`. UI hiện tải full context sau mỗi lần lấy project list, lặp mỗi 2 giây. Riêng pilot phase3/4 tương đương khoảng 694 MB JSON/giờ trước overhead nếu tab giữ mở và project không đổi.[9][10]

## Findings ưu tiên

### F1 — Cao: bản sửa Đợt 4 vẫn có hụt âm thanh và lệch direction

User feedback cũ nói đoạn 4–8 giây chỉ còn tiếng gốc nhỏ và gây hụt. Script sửa bằng cách rút segment nguồn từ 8 xuống 4 giây, tắt tiếng gốc và giữ graphic 4 giây không narration/music. Kết quả là 50,9% video mới im lặng hoàn toàn. Đây không chỉ là vấn đề thẩm mỹ: mục tiêu checkpoint có “khoảng trống”, nhưng acceptance không đo hoặc cảnh báo audio gap.[4][5]

Direction đang active vẫn yêu cầu sample 12 giây và review criterion “Preview 12 giây render thành công”. Bản mới 8 giây vẫn tham chiếu direction đó; không có revision direction hoặc decision xác nhận thay đổi thời lượng. Vì vậy provenance tồn tại nhưng ý nghĩa giữa direction và output đã lệch. Đây là trường hợp “đúng schema, sai lời hứa”.[4][11]

Hành động đề xuất:

1. Chọn lại sound plan cho 4 giây graphic: nối narration, dùng audio nguồn có chủ đích, dùng music/SFX, hoặc xác nhận im lặng là chủ ý. Không để renderer tự đoán.
2. Nếu output thực sự đổi từ 12 xuống 8 giây, tạo revision direction/decision có lý do và user-visible approval boundary.
3. Bổ sung audio coverage diagnostics cho Result: các khoảng silence đáng kể, coverage của narration/music/source audio và tail gap. Cảnh báo, không mặc định fail, vì im lặng đôi khi là chủ ý.
4. Acceptance của pilot phải assert đúng outcome đã hứa, không chỉ duration “khớp sequence hiện tại”.

### F2 — Cao: bản “revision” tạo một nhánh active không được mô hình hóa

Script Đợt 4 dùng key `phase4-piper-revision` thay vì tiếp tục key sequence `pilot-preview`. Bởi active state được tính theo từng key, project hiện có hai active sequence: `pilot-preview` r9 (12 giây) và `phase4-piper-revision` r2 (8 giây). Old Result đã nhận `changes_requested`, nhưng old sequence vẫn active. UI hiển thị hai nhóm riêng; hệ thống không nói bản nào là canonical deliverable.[4][9][12]

Điều này cũng làm mất lợi ích tự nhiên của revision chain: `supersedes`, compare và reuse của sequence mới không nối với baseline gốc. “Giữ bản cũ” không cần key mới vì revision store đã giữ lịch sử bất biến.

Hành động đề xuất:

- Nếu đây là sửa tiếp cùng sản phẩm: dùng cùng key `pilot-preview`, `expectedRevision: 9`, để bản mới supersede đúng revision trước.
- Nếu đây là phương án song song: trước hết bổ sung contract candidate/branch và một selection/canonical decision rõ; không dùng nhiều active key như một cơ chế branch ngầm.
- Sau khi chọn mô hình, migrate/retire artifact thử nghiệm sai semantics nhưng phải giữ lịch sử và Result cũ.

### F3 — Cao về khả năng mở rộng: observer poll full project mỗi 2 giây

UI gọi `/api/projects`, rồi tải full `/api/projects/:id`, cứ 2 giây. Full context nhúng toàn bộ runs/results/artifacts và analysis summary; payload pilot hiện đã 385.798 byte dù chỉ là project nhỏ. Ngoài băng thông localhost, server còn đọc, parse, join và serialize nhiều file JSON lặp lại. Browser smoke chỉ chứng minh player không bị reset, không đặt budget payload hoặc số lần đọc.[9]

`buildSummary()` đã được cải thiện về freshness/resume/production so với review cũ, nhưng vẫn không thật sự gọn: 98.772 byte minified và CLI pretty-print đủ lớn để output audit bị cắt. Nó nhúng full active artifact data, full tool schemas và full analysis source/result-set summaries.[10]

Hành động đề xuất cho đầu Đợt 5:

- Project list trả một revision/generation/updatedAt rẻ; chỉ tải context khi generation đổi.
- Hỗ trợ `ETag`/`If-None-Match` hoặc endpoint delta/event nhẹ; chưa cần WebSocket nếu polling có conditional request là đủ.
- Tách summary dành cho Agent khỏi data dành cho UI: IDs, summaries, blockers, pending decisions, exact current pointers và capability availability ngắn; lazy-load artifact/tool schema/analysis result-set khi cần.
- Đặt regression budget cho serialized bytes và test “unchanged project does not reload full context”.

### F4 — Trung bình-cao: technical acceptance chưa phải output QA

Mỗi segment chỉ sinh một frame ở giữa. Cách này dễ bỏ sót frame đầu/cuối, transition, caption animation, overlay timing và black/frozen frame tại biên. Review pilot mới chỉ có một criterion “file hợp lệ và đúng thời lượng”; report vẫn pass dù 4,075 giây cuối im lặng và direction bị lệch. Audio measurement chỉ giữ LUFS/true peak/LRA toàn file, không giữ silence/coverage.[5][6][13]

Nên bổ sung một lớp pre-compose/post-render QA có cấu trúc:

- preflight: source range, narration/music coverage, gap/tail, output promise/criteria và asset readiness;
- post-render: probe, duration/frame count, 3–4 frame spotcheck gồm boundary/transition, silence/black/freeze heuristic, subtitle safe area và exact reference/direction alignment;
- review record phân biệt rõ auto technical, Agent creative spotcheck và user acceptance.

Không nên biến heuristic thành “AI tự duyệt thẩm mỹ”. Nó chỉ tạo evidence và finding cụ thể để Agent/người dùng quyết định.

### F5 — Trung bình: tài liệu trạng thái có mâu thuẫn thời gian

Roadmap mở đầu vẫn nói “bước tiếp theo là chọn sản phẩm để mở Đợt 4”, nhưng cuối file có cập nhật Đợt 4 đã triển khai. `PADSTUDIO-STATE-AND-NEXT.md` ghi cập nhật 11/09 nhưng chứa mục ngày 12/09. TTS/asset docs còn dùng số 160 test trong khi HEAD hiện là 163. Các ghi chú lịch sử có thể giữ nguyên, nhưng câu tự nhận là “hiện tại” cần một nguồn trạng thái canonical để Agent không chọn sai bước.[2][8][14]

Tab IDE `docs/build/PADSTUDIO-STATE-AND-NEXT-RESEARCH-2026-09-11.md` không tồn tại trong working tree; bản hiện hành là `PADSTUDIO-STATE-AND-NEXT.md`. Có thể đó là tab từ file đã đổi tên/xóa hoặc buffer chưa lưu.

### F6 — Trung bình, chưa chặn local: mutation artifact/workflow chưa có CAS thật

`recordArtifact()` kiểm `expectedRevision` sau khi đọc revision hiện tại rồi ghi một file ID mới. Hai writer đồng thời có thể cùng đọc revision N, cùng qua check và cùng tạo revision N+1. `writeWorkflow()` cũng dùng read-check-write và tên file theo revision. Analysis job đã có single-writer lease, nhưng mutation intelligence chung chưa có khóa/CAS xuyên tiến trình.[15]

Trong mô hình local một Agent hiện tại, đây chưa phải lỗi ưu tiên hơn F1–F4. Trước khi cho chat/UI/Agent khác mutation đồng thời ở Đợt 5+, cần khóa theo project/key hoặc một journal/transaction boundary thật và test race đa tiến trình.

## Học OpenMontage có chọn lọc

OpenMontage có nhiều tool/provider và pipeline hơn, nhưng số lượng file không phải bằng chứng chất lượng hoặc readiness trong môi trường PADStudio. Không nên sao chép pipeline stage cố định, selector tự fallback, raw path hay provider breadth. PADStudio hiện mạnh hơn ở managed project media, exact Result provenance, recovery sau commit và authorization credit gắn exact request.

Các ý đáng học là những cơ chế kiểm tra outcome:

| Cơ chế OpenMontage | Áp dụng phù hợp cho PADStudio |
| --- | --- |
| Delivery promise được khóa từ proposal; compose không được âm thầm hạ lời hứa | Không nhập enum pipeline cố định. Thêm generic `delivery/acceptance contract` trong brief/direction: duration intent, motion/source/audio/caption requirements và quality floor; render/review trỏ exact revision |
| Composition validator cảnh báo narration/music duration và “no audio” trước render | Mở rộng preflight của sequence để tạo finding audio coverage/tail gap; intentional silence phải được khai báo hoặc chấp nhận |
| Final self-review yêu cầu nhiều frame, audio spotcheck, subtitle check và promise preservation | Bổ sung review evidence có sampling plan; không coi một midpoint frame/segment là đủ |
| Slideshow/variation/typography review nằm trong skill | Mở rộng skill `video-editing-craft`/`result-review`, không nhúng gu thẩm mỹ cứng vào project core |
| Local export bundle sinh video + metadata + subtitle + thumbnail + publish log | Dùng làm tham khảo Đợt 6 cho `delivery.export`; vẫn resolve bằng Result ID và ghi output trong workspace PADStudio |
| Cost estimate → reserve → reconcile | PADStudio đã có hướng an toàn hơn cho ElevenLabs: exact single-use authorization + receipt-first recovery; chỉ mở rộng sang budget/project khi provider trả phí thứ hai chứng minh nhu cầu |

Nguồn OpenMontage đặc biệt hữu ích là `delivery_promise.py`, `composition_validator.py`, meta reviewer và `export_bundle.py`.[16][17][18][19] Chúng nên được học như pattern, không copy implementation, vì phần lớn API nhận raw path và giả định pipeline stage—trái ranh giới lõi PADStudio.

## Cách dùng `D:\Test\vid`

Corpus có 25 MP4 dọc 1080×1920, tổng 6.056,725 giây (100 phút 56,7 giây), dài 85,589–369,082 giây. Toàn bộ 25 video đã được dùng cho baseline ASR và scene detection nên không còn là holdout chưa nhìn thấy. Large-v3 GPU FP16 xử lý toàn corpus với RTF khoảng 0,06694; chất lượng vẫn chỉ được review mẫu, chưa có gold transcript/scene do người xác nhận.[20][21]

Thư mục hiện còn chứa `CV_NguyenHoangNguyen.pdf`, không phải video và có thể chứa dữ liệu cá nhân. Không bulk-import cả folder vào project video. Luôn chọn exact path của từng MP4 cần dùng.

Corpus phù hợp cho các pilot tiếp theo về:

- video giáo dục dọc, code-switch Việt/Anh và thuật ngữ kỹ thuật;
- subtitle readability, timing theo lời, pacing giữa các ý và sửa cục bộ;
- kiểm tra khác biệt giữa nguồn nhiều chữ và graphic bổ sung.

Corpus không chứng minh reframe ngang→dọc, đa dạng camera/giọng/nhiễu, video dài, 4K/VFR hay release quality. Khi mở project mục tiêu mới, nên chọn một video chưa dùng làm creative pilot (dù đã dùng benchmark), thay vì nhập lại cả 25 file.

## Kế hoạch triển khai đề xuất

### Lát 4B — đóng Đợt 4 đúng outcome

1. Chốt semantics “revision hay candidate”; sửa current sequence pointer/key.
2. Chốt lại duration và sound plan dựa trên feedback; cập nhật direction/decision nếu thay lời hứa.
3. Sửa graphic stale footer “Pilot local • Đợt 3” trong bản Đợt 4 và review typography trên exact frame/video.
4. Thêm audio coverage/silence evidence, boundary frame sampling và direction/promise check vào acceptance.
5. Render Result mới, ghi technical + creative review; người dùng xem/nghe và quyết định exact Result.

Tiêu chí đóng: chỉ một deliverable/candidate được nhận diện là current; không có audio gap ngoài chủ ý đã ghi; output khớp exact direction revision; acceptance không thể pass lại fixture lỗi hiện tại; approval không kế thừa.

### Đợt 5A — observer/context hiệu quả và rõ phiên bản

1. Generation/ETag để không tải full context khi không đổi.
2. Compact Agent resume summary và lazy-load analysis/tool schema/artifact detail.
3. UI biểu diễn current/candidate/historical rõ; so sánh exact Result và finding theo segment/time range.
4. Thiết kế đường chat/Agent-host binding sau khi contract phản hồi exact target rõ, không thêm mutation tùy tiện vào observer.

### Đợt 6A — bàn giao local tối thiểu

Sau khi một video thật được user approve, thêm export bundle local theo Result ID: file video, hash, metadata, subtitle/thumbnail nếu có, manifest nguồn và approval/review exact. Chưa cần uploader mạng.

### Việc để sau khi có nhu cầu thật

- image generation, stock search và nhiều provider;
- timeline kéo-thả hoặc keyframe editor tổng quát;
- multi-user/cloud/worker;
- vector search/OCR/speaker identification;
- release-wide analysis benchmark và concurrency hardening, trừ khi phạm vi deploy thay đổi sớm.

## Sources

1. PADStudio, [Thiết kế](../docs/build/PADSTUDIO-DESIGN.md), [Định hướng hiện tại](../docs/build/PADSTUDIO-CURRENT-DIRECTION.md), truy cập 12/09/2026.
2. PADStudio, [Roadmap](../docs/build/PADSTUDIO-ROADMAP.md), [Trạng thái và bước tiếp theo](../docs/build/PADSTUDIO-STATE-AND-NEXT.md), truy cập 12/09/2026.
3. PADStudio, [README](../README.md), [Agent runtime](../PADSTUDIO-AGENT-RUNTIME.md), [tool registry](../src/execution/default-tool-registry.js), checkout `beb2af8`.
4. PADStudio, [phase4 pilot script](../scripts/phase4-pilot.mjs), Result `result-mtxwm791-d9384eff` và runtime project `phase3-vd04-asset-pilot`, local access 12/09/2026.
5. PADStudio, [phase4 pilot report](phase4-pilot.json); đo FFmpeg `silencedetect=noise=-50dB:d=0.25` trên exact preview, 12/09/2026.
6. PADStudio, [phase4 acceptance](phase4-production-acceptance.json), [acceptance runner](../scripts/phase4-acceptance.mjs).
7. PADStudio, output `npm run tool:list`, 12/09/2026; [TTS capability](../docs/build/TTS-CAPABILITY.md), [asset capability](../docs/build/ASSET-CAPABILITIES-SPEC.md).
8. PADStudio, [Phase 4 production spec](../docs/build/PHASE4-PRODUCTION-SPEC.md).
9. PADStudio, [UI polling](../ui/app.js), [web server](../src/web/server.js); payload đo bằng `ProjectContextAssembler.build()` trên ba project local.
10. PADStudio, [project context assembler](../src/intelligence/project-context-assembler.js), [analysis reader](../src/analysis/analysis-reader.js); payload đo bằng `buildSummary()`.
11. PADStudio, active artifact `creative.direction` `artifact-mtxat6v7-1e339382`, runtime project `phase3-vd04-asset-pilot`.
12. PADStudio, [project intelligence store](../src/intelligence/project-intelligence-store.js), [production context](../src/production/production-context.js).
13. PADStudio, [sequence compositor](../src/tools/sequence-compositor.js), [sequence composition test](../test/sequence-composition.test.js).
14. PADStudio, [TTS capability](../docs/build/TTS-CAPABILITY.md), [asset capability](../docs/build/ASSET-CAPABILITIES-SPEC.md), wording/status compared with HEAD tests.
15. PADStudio, [project intelligence store](../src/intelligence/project-intelligence-store.js), methods `recordArtifact()` and `writeWorkflow()`.
16. OpenMontage, `D:\OpenMontage\lib\delivery_promise.py`, checkout `cd9f3c1`, local access 12/09/2026.
17. OpenMontage, `D:\OpenMontage\tools\analysis\composition_validator.py`, checkout `cd9f3c1`.
18. OpenMontage, `D:\OpenMontage\skills\meta\reviewer.md`, checkout `cd9f3c1`.
19. OpenMontage, `D:\OpenMontage\tools\publishers\export_bundle.py`, checkout `cd9f3c1`.
20. PADStudio, [baseline report](../eval/source-understanding/BASELINE-REPORT.md), [baseline summary](../eval/source-understanding/reports/2026-09-08/baseline-summary.json).
21. PADStudio, [practical source review](../eval/source-understanding/PRACTICAL-REVIEW.md), [corpus audit](../eval/source-understanding/reports/2026-09-08/corpus-audit.json).
