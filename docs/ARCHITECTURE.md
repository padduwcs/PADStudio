# PAD Studio — Kiến trúc dành cho người phát triển

PAD Studio là ứng dụng local-first để biến một chủ đề thành video giảng dạy:

```text
Chủ đề → Outline → Voice–visual plan → Motion Canvas + Voice
       → Animation sync → Layout → Final MP4
```

Ứng dụng chạy frontend React/Vite và backend Node trên máy người dùng. Dữ liệu
project, artifact sinh ra và lịch sử phiên bản nằm dưới `projects/`; bí mật
không nằm trong project hay frontend.

## Mục tiêu thiết kế

- Không để artifact đã duyệt được dùng khi input của nó đã thay đổi.
- Cho phép retry request mà không sinh AI/TTS trùng hoặc ghi đè âm thầm.
- Giữ workspace sinh ra bất biến; khôi phục là copy-forward, không sửa lịch sử.
- Chạy được chủ yếu ở local, không cần database hay dịch vụ backend riêng.
- Tách phần nghiệp vụ khỏi provider và renderer để test được không cần mạng.

## Sơ đồ thành phần

```text
React pages + hooks
        │ HTTP/JSON, If-Match revision
        ▼
Node HTTP application (`src/backend/app.ts`)
        │
        ├── feature workflows: outline, voice–visual, motion, voice, sync,
        │   layout, render
        │
        ├── project state reconciliation (`projectState.ts`)
        │        └── dependency predicates (`shared/projectPipeline.ts`)
        │
        ├── file repository + immutable history/workspaces
        └── adapters: Codex, ElevenLabs, FFmpeg/FFprobe, Motion Canvas/Vite
```

`app.ts` hiện là composition root và HTTP boundary: khởi tạo dependency, kiểm
tra request và gọi workflow. Route parser thuần nằm trong `projectRoutes.ts`;
nghiệp vụ invalidation không còn nằm trong file repository mà tập trung ở
`projectState.ts`.

## Project là aggregate nguồn sự thật

`TopicProject` trong `src/shared/topic.ts` là aggregate duy nhất có thể quyết
định artifact nào còn hợp lệ. Các schema Zod vừa là hợp đồng API vừa là cơ chế
migration project cũ.

Một project có `revision` tăng đơn điệu. Mọi thao tác ghi từ client phải gửi
`If-Match: "<revision>"`. Nếu revision đã cũ, API trả `409 PROJECT_CONFLICT`
kèm project mới nhất. Cách này ngăn hai tab ghi đè nhau im lặng.

Mỗi artifact lưu tối thiểu:

- `status`: draft, approved hoặc completed tùy artifact.
- `contentRevision`: identity của nội dung artifact.
- các `source…Revision`/hash/generation id: dấu vết chính xác của nguồn.
- `generation`: provider, tool, model và thời điểm sinh.

Đường dẫn workspace được schema kiểm tra chặt để ngăn path traversal. Chúng là
metadata runtime, không phải input người dùng tự do.

## Quy tắc pipeline và invalidation

Các quan hệ nguồn là:

```text
topic → outline → voiceVisual → motionCanvas ─┐
                         └──────→ voice ──────┤→ sync → layout → render
motionCanvas → visualDesign ──────────────────┘
```

`shared/projectPipeline.ts` chỉ trả lời các câu hỏi thuần: artifact có current,
ready hoặc stale hay không. `backend/projectConsistency.ts` kiểm tra nguồn cần
đọc nội dung thật, ví dụ narration hash.

`reconcileProjectState()` trong `backend/projectState.ts` là nơi duy nhất áp
dụng một thay đổi project và lan truyền invalidation. Ví dụ đổi topic sẽ đưa
outline/plan/motion/voice/sync/layout về draft và bỏ final render không còn
khớp. Artifact trên đĩa vẫn được giữ làm lịch sử; chỉ tính đủ điều kiện dùng
trong pipeline thay đổi.

Repository chỉ thực hiện các trách nhiệm lưu trữ:

- serialize thao tác theo project trong tiến trình;
- read/parse/migrate project;
- ghi file tạm rồi rename nguyên tử;
- kiểm tra optimistic revision;
- gọi reconciliation trước khi ghi.

Không thêm luật invalidation mới vào route handler hoặc repository. Khi có
stage mới, trước hết thêm dependency predicate và reconciliation test.

## Generation, retry và lịch sử

`generationRegistry.ts` chuẩn hóa idempotency ngắn hạn trong backend:

- cùng `generationId` và cùng fingerprint sẽ join Promise đang chạy;
- cùng id với fingerprint khác bị từ chối rõ ràng;
- failure có thể được giữ lại khi provider trả kết quả mơ hồ, nhờ đó tránh
  retry AI/TTS tốn phí;
- entry chỉ là trạng thái trong RAM; kết quả bền vững nằm trong workspace,
  history store hoặc render report.

Outline, voice–visual và Motion Canvas có history store/candidate/version riêng.
Apply/restore luôn tạo bản mới copy-forward. Voice lưu checkpoint theo chunk để
khôi phục sau restart thay vì gọi lại toàn bộ TTS. Final render lưu report trạng
thái terminal trong project để UI đọc lại sau khi backend khởi động lại.

## Workspace và adapter runtime

Các service workspace chịu trách nhiệm tạo/kiểm tra file sinh ra:

- `motionCanvasWorkspace.ts`: source scene và workspace Motion Canvas.
- `voiceWorkspace.ts`: narration master, alignment toàn cục và chunk checkpoint.
- `animationSyncWorkspace.ts`: track WAV và timing event từ voice thật.
- `layoutWorkspace.ts`: overlay/manifest bất biến trên nguồn sync.
- `finalRenderService.ts`: render frame bằng Motion Canvas và encode MP4 qua FFmpeg.

Preview dùng Vite runtime cục bộ trên loopback, workspace copy tạm và nonce
session. Preview không được quyền sửa workspace canonical. Layout Editor chỉ
gửi commands/manifest hợp lệ quay về backend; backend vẫn xác minh mọi source
hash, generation và target trước khi commit.

Codex và ElevenLabs là provider adapter. Chỉ adapter biết chi tiết HTTP/stdio
provider; domain layer làm việc với result đã được schema hóa. FFmpeg/FFprobe và
browser render được kiểm tra trước các bước tốn quota khi có thể.

## HTTP và frontend

Frontend chỉ giao tiếp với `/api`. Client gửi revision cho mọi thao tác thay đổi
project và hiện conflict thay vì tự ghi đè. Các hook theo feature giữ draft,
poll render, preview session và navigation guard; backend vẫn là nơi quyết định
gate pipeline.

API trả lỗi có code ổn định (`VALIDATION_ERROR`, `PROJECT_CONFLICT`,
`GENERATION_ID_REUSED`, …) cùng message có thể hiển thị. Route static chỉ dùng
SPA fallback cho URL không có extension; asset thiếu trả 404 JSON thay vì HTML
200, tránh lỗi module khó chẩn đoán sau deploy/cache.

Backend mặc định bind `127.0.0.1`. Preview runtime cũng bind loopback. Không mở
host ra mạng LAN trừ khi chủ động cấu hình `HOST`; khi làm vậy cần đặt reverse
proxy/authentication phù hợp vì đây là ứng dụng local-first, không phải
multi-tenant web service.

## Storage

```text
projects/<project-id>/
  project.json                     aggregate đã schema hóa
  outline/, voice-visual/, motion-canvas/  history/generation tương ứng
  voice/generations/               audio, alignment, checkpoints
  sync/generations/                workspace đồng bộ
  layout/generations/              overrides, manifest, workspace
  renders/generations/             MP4 và render manifest
  renders/jobs/                    report render terminal
.pad-studio/credentials.json       secret được DPAPI bảo vệ trên Windows
tmp/                                preview/cache có thể xóa
```

Không giả định nhiều process backend cùng ghi một `projects/` directory. Một
process backend là đơn vị sở hữu workspace hiện tại. Nếu cần triển khai
multi-process, bổ sung file lock/transaction store trước khi chạy song song;
không cố mở rộng bằng cách dựa vào Map trong RAM.

## Test và kiểm chứng

`npm test` gồm unit/domain, API integration, workspace validation và test runtime
Motion Canvas. Một số test integration thực sự cần FFmpeg và Windows DPAPI:

- Cài FFmpeg/FFprobe hoặc đặt `FFMPEG_PATH`/`FFPROBE_PATH` để test audio/render.
- DPAPI cần Windows user profile thực; môi trường sandbox/CI impersonation có
  thể không hỗ trợ và phải được cấu hình/skipped rõ ràng.

Các lệnh chính:

```text
npm run build          typecheck + frontend production build
npm test               test suite
npm run check:media    kiểm tra media policy
npm run validate       kiểm tra đầy đủ, gồm Motion Canvas runtime
npm run dev            chạy frontend + backend local
```

Khi sửa workflow, tối thiểu chạy build, test của feature và `app.test.ts`. Khi
sửa source/preview/render, chạy thêm `validate:motion` hoặc `validate:sync`
trên máy có browser và FFmpeg.

## Quy ước phát triển tiếp

1. Thêm command/workflow mới trước, không mở generic project update cho artifact.
2. Thêm schema và migration trước khi ghi field mới vào `project.json`.
3. Mọi dependency mới phải có predicate current/ready/stale và test invalidation.
4. Mọi provider request trả phí phải có generation id + fingerprint + retry policy.
5. Workspace được publish bất biến; preview luôn dùng bản copy tạm.
6. Mọi đường dẫn từ persisted data phải resolve dưới project root và được kiểm tra.
7. Giữ route handler mỏng: parse → workflow → response. Không nhân bản business
   rules vào HTTP layer.

Theo các quy ước này, hệ thống có thể phát triển thêm stage hoặc provider mà vẫn
giữ được logic dữ liệu nhất quán và hành vi retry có thể giải thích được.
