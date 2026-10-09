# PADStudio — tài liệu tham khảo đầy đủ

> Đây là README lịch sử đầy đủ. Điểm vào ngắn hiện hành nằm tại [`README.md`](README.md); Agent vận hành dùng [`PADSTUDIO-AGENT-RUNTIME.md`](PADSTUDIO-AGENT-RUNTIME.md).

Prototype hiện tại kiểm tra các phần của một vòng project có thể mở lại và tiếp tục;
đây không phải pipeline bắt buộc cho mọi project:

1. Agent tạo hoặc mở project local.
2. Agent nhập tư liệu; PADStudio giữ file, resource và run tương ứng.
3. Agent xem các capability đang có và yêu cầu một công cụ cụ thể qua Bộ thực thi.
4. PADStudio giữ run, result, kiểm tra và dấu vết từ đầu vào đến công cụ đã dùng.
5. Khi người dùng phản hồi rõ về một result, Agent ghi decision tương ứng.
6. Agent ghi checkpoint về mục tiêu, ràng buộc và việc tiếp theo, rồi đọc lại
   toàn bộ context có cấu trúc khi tiếp tục.
7. Web quan sát cùng dữ liệu project, không gửi lệnh hay tự thay đổi trạng thái.

Chat vẫn nằm trong Agent host mà người dùng đang dùng. Các endpoint local chỉ
phục vụ observer trong trình duyệt; chúng không phải cầu nối điều khiển Agent.

Trạng thái bàn giao V1: [PADSTUDIO-V1-COMPLETION.md](docs/build/history/PADSTUDIO-V1-COMPLETION.md).

## Cấu trúc project

```text
.padstudio/projects/<project-id>/
├── project.json
├── checkpoint.json
├── overview.md
├── inputs/
├── resources/
│   └── resource-*.json
├── results/
│   └── result-*.json
├── outputs/
│   └── run-*/
│       └── clip.mp4
├── decisions/
│   └── decision-*.json
├── artifacts/
│   └── artifact-*.json
├── workflows/
│   └── workflow-*-r*.json
├── reviews/
│   └── review-*.json
├── analysis/
│   ├── jobs/
│   ├── indexes/
│   ├── cancellations/
│   └── leases/
├── authorizations/        # credit authorization của tool trả phí
├── budget.json            # chính sách ngân sách USD (nếu đã đặt)
├── prunes/                # bản ghi append-only của mỗi lần project:prune --apply
├── skills/
├── .locks/                # khóa mutation tạm thời, không phải dữ liệu project
└── runs/
    └── run-*.json
```

Project mới chỉ có `project.json`; các thư mục con được tạo khi lần đầu có dữ liệu để ghi, nên một
project cụ thể thường chỉ có một phần cây trên.

- `project.json`: danh tính ổn định của project.
- `resources/`: tư liệu đã được nhập thành công và các file thuộc mỗi resource.
- `results/`: kết quả bền vững do công cụ tạo ra, kèm đầu vào, công cụ và bằng
  chứng kiểm tra.
- `outputs/`: file media do công cụ tạo, tách theo run; chỉ file đã được result đăng ký
  mới được web phục vụ hoặc dùng lại làm đầu vào.
- `decisions/`: lịch sử phản hồi nối tiếp của người dùng đối với từng result.
- `artifacts/`: hiểu biết và lựa chọn sáng tạo có revision, không ghi đè lịch sử.
- `workflows/`: đồ thị công việc thích nghi; mỗi thay đổi là một revision có lý do.
- `reviews/`: đánh giá creative/technical có tiêu chí và bằng chứng.
- `analysis/`: job phân tích kỹ thuật có thể resume, source snapshot, lease và cache/index dẫn
  xuất. Project cũ chưa có thư mục này vẫn mở bình thường.
- `authorizations/`: bản ghi phê duyệt credit dùng một lần, gắn SHA-256 của đúng request.
- `budget.json`: chính sách `observe`/`cap`, reserve và ngưỡng cần authorization.
- `skills/`: catalog skill riêng của project khi cần; skill hệ thống nằm ở `skills/` cạnh `src/`.
- `runs/`: dấu vết từng thao tác import hoặc chạy công cụ, gồm cả lỗi, thời lượng
  và chi phí khi có.
- `checkpoint.json`: phần bối cảnh có ý nghĩa do Agent chắt lọc.
- `overview.md`: bản đọc nhanh được sinh từ checkpoint, không phải nguồn sự thật riêng.

Mỗi file trạng thái được ghi qua file tạm rồi thay thế nguyên tử. Project cũ
không có `project.json` không được coi là project hợp lệ.

## Cấu trúc mã nguồn

```text
src/
├── analysis/    # Source identity/timebase, contract Result, job/lease/resume/cancel, reader
├── animation/   # animation.composition, animation.choreography, source package, preview range
├── config/      # Đọc padstudio.local.json (Piper, ElevenLabs)
├── project/     # Lưu trữ, đường dẫn, khóa file, archive và tính toàn vẹn của project
├── intelligence/# Artifact, adaptive workflow, review, skill và context assembler
├── operations/  # Doctor, project health, recovery, machine profile
├── production/  # Hợp đồng video.sequence, dependency/stale, visual quality, policy catalog
├── quality/     # Điều phối automated output QA
├── release/     # Gate phát hành rộng, holdout, release evidence
├── resources/   # Nhập và lập chỉ mục tài nguyên
├── execution/   # Danh mục công cụ, Bộ thực thi, authorization và budget
├── tools/       # Logic của từng công cụ cụ thể
├── cli/         # Các lệnh để Agent thao tác với project
└── web/         # Observer API và web server chỉ đọc (GET-only)
ui/              # Observer vanilla ES module, không có build step
runtime/analysis # Python helper có khóa phiên bản cho ASR và scene detection
```

Agent quyết định mục tiêu, tài nguyên cần dùng và nội dung checkpoint.
PADStudio cung cấp cơ chế nhập an toàn, khám phá và chạy công cụ, lưu
resource/run/result/decision/checkpoint, rồi đọc lại context. Web chỉ quan sát,
không điều khiển Agent hay sửa project.

## Lệnh dành cho Agent

Tạo project:

```powershell
npm run project:create -- coffee-video "Video giới thiệu quán cà phê"
```

Nhập file hoặc folder:

```powershell
npm run project:import -- coffee-video "D:\Footage\coffee.mp4"
```

Ghi checkpoint từ file JSON hoặc standard input:

```powershell
npm run project:checkpoint -- coffee-video "D:\Temp\coffee-checkpoint.json"
$checkpoint | npm run project:checkpoint -- coffee-video -
```

Đọc toàn bộ context:

```powershell
npm run project:context -- coffee-video
npm run project:context -- coffee-video --view summary
```

Xem capability và công cụ hiện có:

```powershell
npm run tool:list
npm run tool:list -- --capability tts.synthesize
npm run tool:list -- --tool elevenlabs
npm run tool:list -- --view full
$recommendation = @{ capability = "tts.synthesize"; priorities = @{ quality = 5; reliability = 5 } } | ConvertTo-Json -Compress
$recommendation | npm run tool:recommend -- -
```

Mặc định lệnh trả về bản tóm tắt phục vụ việc chọn công cụ: availability, provider, chi phí,
approval, side effect và loại output. Dùng `--view full` khi cần contract đầy đủ gồm input schema;
`--capability` và `--tool` chỉ nhận tên khớp chính xác, không tự fallback sang lựa chọn khác.
Recommendation chỉ xếp hạng các lựa chọn đang dùng được; request chạy vẫn phải nêu exact tool.

Cấu hình hoặc xem ngân sách USD cấp project:

```powershell
npm run project:budget -- coffee-video show
npm run project:budget -- coffee-video set '{"mode":"cap","totalUsd":25,"reserveUsd":2,"singleActionApprovalUsd":3}'
```

Catalog production ở `production-catalogs/` cung cấp 4 output profile local (`local-portrait-h264-v1`,
`local-portrait-720p24-h264-v1`, `local-landscape-h264-v1`, `local-square-h264-v1`) và 5 style playbook.
Việc dùng policy luôn **optional-explicit**: `profileId` của delivery là tùy chọn và chỉ ghi ý định/advisory
(không ép chuyển mã sau acceptance); bỏ `playbookId` thì không playbook nào được chọn, và PADStudio không
suy ra profile/playbook từ tỷ lệ khung hình hay provider.

Chạy một công cụ bằng request JSON từ standard input hoặc từ file:

```powershell
$request | npm run tool:run -- coffee-video -
npm run tool:run -- coffee-video D:\Temp\tool-request.json
```

Nếu output và Result hoặc pending Result draft đã được bảo toàn nhưng bước lưu/đóng
Run lỗi, lệnh trả `finalization_pending`. Hoàn tất Result, authorization và Run mà
không chạy lại tool hoặc provider trả phí:

```powershell
npm run project:run:recover -- coffee-video run-...
```

Vận hành, chẩn đoán và phục hồi (chi tiết ở [OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md)):

```powershell
npm run padstudio:doctor -- [--deep] [project-id]   # exit 0 ready/attention, 2 blocked, 1 lỗi gọi
npm run system:profile                              # hồ sơ máy + capability menu, read-only
npm run project:recover -- coffee-video [--apply]   # mặc định chỉ lập plan
npm run project:usage -- --all | <project-id> [--full]   # dung lượng và phần thu hồi được, chỉ đọc
npm run project:prune -- <project-id> | --all [--apply]  # xóa scratch không thuộc Result nào (mặc định chỉ lập kế hoạch)
npm run project:run:abandon -- coffee-video run-... "<lý do>" --confirm-stopped
npm run project:archive -- list | archive <id> "<lý do>" --confirm-stopped | restore <id> --confirm-stopped
npm run observer:ensure -- [project-id] [--port 7603]   # tái dùng hoặc khởi động observer local
```

Chấp nhận video và hoạt họa bằng code:

```powershell
npm run project:accept -- coffee-video result-... --from-agent-host [--resolves decision-...]
npm run animation:preview-range -- coffee-video <composition-id-or-key> <start-seconds> <end-seconds>
```

`animation:preview-range` là lối tắt cho composition Remotion đang active: nó tìm preflight đã pass đúng
revision rồi gọi `animation.preview` / `remotion-preview` với một khoảng tối đa 30 giây.

Registry mặc định hiện có 29 capability do 36 tool cung cấp (số thực tế lấy từ `npm run tool:list`;
availability phụ thuộc máy). 23 capability media/asset/analysis/delivery:

- `media.inspect` / `ffprobe`: đọc metadata audio/video, không tạo file.
- `video.trim` / `ffmpeg-trim`: cắt chính xác video bằng re-encode và tạo `video.clip`.
- `video.concat` / `ffmpeg-concat`: ghép nhiều clip theo thứ tự, tự chọn ghép nhanh không mất
  chất lượng khi các clip đã cùng định dạng, hoặc tự đưa về cùng khung hình và chèn tiếng im
  lặng khi cần, có thể chuyển cảnh mờ dần hoặc qua đen.
- `video.reformat` / `ffmpeg-reformat`: đổi tỷ lệ khung hình/độ phân giải theo preset
  (`portrait`, `square`, `landscape`, `cinematic`, `vertical4x5`) hoặc kích thước tùy chọn.
- `video.thumbnail` / `ffmpeg-thumbnail`: trích chính xác một khung hình làm ảnh đại diện.
- `audio.overlay` / `ffmpeg-audio-overlay`: chèn một track âm thanh có sẵn (nhạc nền hoặc
  giọng đọc, gồm cả Result từ `tts.synthesize`) vào video, tự lặp/cắt cho khớp thời lượng, có thể tự giảm âm
  lượng track mới khi video đã có tiếng (ducking).
- `subtitle.burn` / `ffmpeg-subtitle-burn`: ghim cứng phụ đề đã có sẵn văn bản và mốc thời
  gian lên video, tự chọn cỡ chữ theo khung dọc/ngang.
- `image.to-video` / `ffmpeg-image-to-video`: biến một ảnh tĩnh thành đoạn video trong thời
  lượng cho trước, giữ nguyên khung hình hoặc thêm chuyển động máy quay nhẹ (`zoomIn`,
  `zoomOut`, `panLeft`, `panRight`, `kenBurns`).
- `video.render-sequence` / `ffmpeg-sequence`: dựng đúng revision cấu trúc video, giữ từng
  đoạn và khung hình review; dùng lại đoạn khớp spec/hash khi sửa cục bộ.
- `source.probe` / `ffprobe-source`: metadata và kiểm tra decode có source identity/coverage.
- `video.detect-scenes` / `pyscenedetect-scenes`: phát hiện shot và giữ boundary score.
- `source.extract-frames` / `ffmpeg-source-frames`: frame, mapping thời gian và contact sheet.
- `audio.analyze` / `ffmpeg-audio-analysis`: waveform, khoảng lặng, loudness và clipping candidate.
- `audio.transcribe` / `faster-whisper-transcribe`: raw transcript/word timestamp theo chunk.
- `source.preview` / `ffmpeg-source-preview`: proxy browser-safe có mapping về source time.
- `audio.prepare` / `ffmpeg-audio-prepare`: tách/cắt, fade và chuẩn hóa loudness cho audio tái sử dụng.
- `graphic.render` / `browser-graphic`: tạo thẻ chữ, biểu đồ và sơ đồ bước có layout được kiểm tra.
- `media.acquire` / `https-media`: tải exact HTTPS asset đã chọn với attribution và checksum.
- `media.search-stock` / `wikimedia-stock`: tìm image/video/audio candidate, giữ creator, license và source page; chưa tự nhập asset.
- `media.register-generated` / `external-generated-media`: đăng ký exact asset do Agent/provider ngoài tạo với provider, model, prompt, rights và cost provenance.
- `tts.synthesize` / `piper-local`, `elevenlabs`: cùng contract giọng đọc, lựa chọn provider tường minh và không fallback ngầm.
- `video.inspect-output` / `local-output-quality`: full decode, evidence, timeline samples, black/freeze, audio và ASR trên exact render. Dùng trước khi trình người dùng; sau acceptance nó chỉ là bằng chứng advisory.
- `video.export-delivery` / `local-delivery`: đóng gói nguyên byte exact Result đã được người dùng chấp nhận (probe tối thiểu, copy, kiểm checksum). Không render lại, không ép profile.

Sáu capability hoạt họa project-native (xem [CODE-ANIMATION-SPEC.md](docs/build/CODE-ANIMATION-SPEC.md)):

- `animation.source` / `code-animation-source`: tạo hoặc revise source package bất biến, không chạy code.
- `animation.props` / `code-animation-props`: tạo hoặc revise JSON props bất biến.
- `animation.validate` / `code-animation-validator`: kiểm tra tĩnh đúng package (không phải sandbox).
- `animation.preflight` / `manim-ce-preflight`, `remotion-local-preflight`, `hyperframes-local-preflight`.
- `animation.preview` / `remotion-preview`, `hyperframes-preview`, `hyperframes-motion-preview`.
- `animation.render` / `manim-ce`, `remotion-local`, `hyperframes-local`: tạo Result video dùng trực tiếp trong `video.sequence`.

Ghi Decision sau khi người dùng phản hồi rõ về một Result:

```powershell
$decision | npm run project:decide -- coffee-video -
```

Với `video.sequence-render`, Decision mới bắt buộc bind exact `resultId` cùng `feedbackTarget.artifactId` và `feedbackTarget.revision`; có thể thêm `segmentId`/`timeRange`. Result được chấp nhận chỉ đóng feedback cũ khi liệt kê tường minh `resolvesDecisionIds`. Xem [đặc tả Đợt 5B](docs/build/PHASE5B-EXACT-FEEDBACK-SPEC.md).

Project intelligence và adaptive workflow:

```powershell
npm run skill:list -- coffee-video
npm run skill:read -- creative-direction coffee-video
npm run workflow:list
npm run project:workflow:init -- coffee-video creative-production
$artifact | npm run project:artifact -- coffee-video -
$workflow | npm run project:workflow -- coffee-video -
$review | npm run project:review -- coffee-video -
```

Contract chi tiết nằm trong
[PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md](docs/build/PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md).

Chi tiết contract và cách Agent dùng các lệnh nằm trong
[PADSTUDIO-AGENT-RUNTIME.md](PADSTUDIO-AGENT-RUNTIME.md).

## Creative Direction — Đợt 2

Đợt 2 đã hoàn thành ở phạm vi practical: hợp đồng brief/proposal/direction, pilot `keys-first`,
mẫu r2 có reuse 6/7 đoạn, exact user approval và workspace observer chỉ đọc cho toàn bộ mạch
creative. Mốc Đợt 2 đạt 138/138 tại thời điểm đó; số test hiện hành nằm ở
[PADSTUDIO-DEVELOPMENT-STATUS.md](docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md).

```powershell
npm run creative:acceptance -- --project phase2-brute-force-pilot --report reports/phase2-creative-direction-acceptance.json
```

Kết quả và giới hạn: [Gói D](docs/build/history/CREATIVE-DIRECTION-PACKAGE-D.md) và
[Gói E](docs/build/history/CREATIVE-DIRECTION-PACKAGE-E.md).

## Source Understanding — gói B–F

Gói B/C đã có contract, coordinator và sáu adapter production:

```powershell
$request | npm run project:analyze -- <project-id> -
npm run analysis:resume -- <project-id> <analysis-id>
npm run analysis:cancel -- <project-id> <analysis-id>
```

Gói D bổ sung đường đọc/verify và ba artifact hiểu biết:

```powershell
npm run analysis:read -- <project-id> '{"view":"summary"}'
npm run analysis:verify -- <project-id>
$profile | npm run project:source-profile -- <project-id> -
$assessment | npm run project:source-assessment -- <project-id> -
$edit | npm run project:transcript-edit -- <project-id> -
```

Reader hỗ trợ transcript/scene/frame/audio/assessment/search theo range và cursor; raw transcript
không bị sửa bởi correction. CLI, context và observer dùng chung đường đọc. Contract và giới hạn:
[gói B](docs/build/history/SOURCE-UNDERSTANDING-PACKAGE-B.md),
[gói C](docs/build/history/SOURCE-UNDERSTANDING-PACKAGE-C.md),
[gói D](docs/build/history/SOURCE-UNDERSTANDING-PACKAGE-D.md).

Gói E thêm workspace observer chỉ đọc để chọn nguồn/Result set, phát nguồn hoặc proxy theo source
time, xem coverage/freshness và lazy-load transcript, scene, frame, audio, assessment, search.
Contract UI và browser acceptance: [gói E](docs/build/history/SOURCE-UNDERSTANDING-PACKAGE-E.md).

Gói F đã đóng nghiệm thu practical trên máy hiện tại bằng acceptance runner tổng hợp test, harness,
doctor, verify và browser gate mở rộng. Chạy lại và ghi report bằng:

```powershell
npm run analysis:acceptance -- --browser-project <project-id> --report <report-path>
```

Project browser acceptance cần có preview/transcript, nhiều Result set và đủ transcript để phân
trang. Không truyền project sẽ trả trạng thái `incomplete`. Kết quả và các gate release còn
`not_measured`: [gói F](docs/build/history/SOURCE-UNDERSTANDING-PACKAGE-F.md).

Kiểm tra 16 broad-release gate fail-closed và chạy acceptance của chính evaluator bằng:

```powershell
npm run release:gates
npm run release:gates -- --evidence path/to/release-evidence.json
npm run release:acceptance
```

Không có evidence, `release:gates` chủ ý thoát mã 2 với `not_measured`. Fixture acceptance chỉ
kiểm chứng cơ chế evaluator; không chứng nhận release và không thay đổi `releaseDefault: null`.

Khóa corpus holdout, ghi review xem/nghe đầy đủ và ráp evidence thật:

```powershell
npm run release:holdout:lock -- holdout-source.json D:\Corpora\padstudio
# Người dùng tự chạy trong terminal tương tác (không thêm --from-agent-host);
# lệnh hiển thị exact Result/SHA-256 và ghi human review xem/nghe đầy đủ cùng acceptance:
npm run project:accept -- coffee-video result-...
npm run release:evidence:assemble -- coffee-video benchmark-evidence.json locked-holdout.json result-...
```

Các lệnh này fail-closed: chúng không tự tạo gold label, không tự nhận đã xem/nghe và không
biến fixture thành release candidate. `project:attest` dạng JSON đã ngừng nhận dữ liệu; human
attestation chỉ được tạo qua `project:accept` tương tác.

## Cấu trúc video và sửa từng phần

Agent có thể lưu cấu trúc video có revision qua `npm run project:sequence -- <project-id> <json-file|->`,
sau đó dùng `video.render-sequence` / `ffmpeg-sequence` để dựng preview local.
Context và observer cho biết đoạn thay đổi, phụ thuộc cần xem lại và các bản dựng.
Đoạn không đổi có thể được dùng lại sau khi kiểm tra spec/hash; bản mới không kế thừa approval cũ.

Contract, ví dụ và giới hạn: [VIDEO-SEQUENCE-PRODUCTION.md](docs/build/VIDEO-SEQUENCE-PRODUCTION.md).

## Chạy observer

```powershell
npm start
```

Mở `http://127.0.0.1:7603`.

Có thể mở thẳng project bằng `http://127.0.0.1:7603/?project=<project-id>`. Với một project
đã có preview/timeline/transcript, chạy browser acceptance bằng:

```powershell
npm run observer:browser-test -- -ProjectId <project-id>
```

Để nghiệm thu snapshot/ETag, lazy loading, bảo toàn player, mốc phản hồi và race protection của Đợt 5A:

```powershell
npm run observer:acceptance
```

Để nghiệm thu toàn bộ vòng feedback exact Result, pending/resolution, Agent summary và browser comparison của Đợt 5B:

```powershell
npm run feedback:acceptance
```

## Kiểm tra

```powershell
npm test
```

Kiểm tra exact render trước khi xuất delivery:

```powershell
$qa = '{"resultId":"result-...","profileId":"spoken-video-v1","language":"vi","reuse":"verified"}'
$qa | npm run quality:inspect -- <project-id> -
```

Lệnh trả exit code 2 khi report được tạo hợp lệ nhưng gate chất lượng không đạt
(`data.gate.deliveryEligible !== true`). QA là bằng chứng cho Agent trước khi xin duyệt: sau khi người
dùng đã chấp nhận exact render, local delivery chỉ yêu cầu acceptance, SHA-256 nguồn còn khớp, media probe
tối thiểu và checksum bản copy; QA có sẵn được đóng gói trong `metadata/quality.json` ở trạng thái advisory.

Test bao phủ persistence, import thành công/thất bại, path safety, context khi
mở lại, danh mục công cụ, Bộ thực thi, ffprobe/ffmpeg thật, output rollback,
analysis lifecycle/adapter/reader, evidence validation, search/freshness,
result dùng lại result trước, observer API, byte ranges và việc web không có
endpoint thay đổi project.

## Nguyên liệu dùng chung — Đợt 3, gói đầu

Đã bổ sung graphic.render (thẻ chữ/biểu đồ/sơ đồ bước), audio.prepare (tách/cắt, fade, loudness) và media.acquire (file HTTPS đã chọn, có attribution). Capability `tts.synthesize` có Piper local và ElevenLabs cloud, cùng tạo Result audio có thể nghe/dùng trong video; cloud bắt buộc authorization credit dùng một lần. Xem [asset contract](docs/build/ASSET-CAPABILITIES-SPEC.md) và [hướng dẫn TTS](docs/build/TTS-CAPABILITY.md).

Pilot local `phase3-vd04-asset-pilot` đã đi trọn nguồn → direction → graphic/Piper → sequence r9 →
render/review, không gọi provider trả phí. Trạng thái và kế hoạch tiếp theo:
[PADSTUDIO-STATE-AND-NEXT.md](docs/build/history/PADSTUDIO-STATE-AND-NEXT.md). Báo cáo:
[phase3-vd04-pilot-acceptance.json](reports/phase3-vd04-pilot-acceptance.json).

```powershell
npm run tts:acceptance
npm run assets:acceptance
npm run creative:acceptance
```

## Đợt 4 — composition

Sequence 1.1 bổ sung timing, audio, typography, overlays, animation preset,
transition, music và timeline chỉ đọc. Sequence 1.0 tiếp tục được hỗ trợ.
Contract và nghiệm thu: [Đợt 4](docs/build/PHASE4-PRODUCTION-SPEC.md).
