# PAD Studio — Kiến trúc

PAD Studio chạy local-first: React/Vite ở frontend, Node.js ở backend. Project, workspace và media nằm trong `projects/`; credential không nằm trong frontend hoặc project.

## Luồng hệ thống

```text
Nội dung + cách đọc → narration ElevenLabs → scene Motion Canvas đã đồng bộ
→ editor (visual + audio) → MP4 H.264/AAC
```

Frontend gọi `/api` và gửi `If-Match` với mọi thao tác ghi. Backend là nơi duy nhất xác thực state, điều phối provider và commit workspace.

## Thành phần

| Khu vực | Trách nhiệm |
| --- | --- |
| `src/frontend` | Pages React, workflow state, editor và API client. |
| `src/backend/app.ts` | Composition root và HTTP boundary. |
| `src/backend/*Service.ts` | Narration, generation, workspace, sync và render. |
| `src/shared` | Zod schema, pipeline predicates, timing, phát âm và video rules. |
| `motion-canvas-runtime` | Preview/render runtime Motion Canvas. |

Route handler giữ mỏng: parse request → gọi workflow → trả response. Không đặt business rule hoặc invalidation trong route/repository.

## Project và tính nhất quán

`TopicProject` trong `src/shared/topic.ts` là nguồn sự thật. Mỗi lần ghi tăng `revision`; revision cũ nhận `409 PROJECT_CONFLICT` kèm project mới nhất để tránh hai tab ghi đè nhau.

`reconcileProjectState()` trong `src/backend/projectState.ts` áp dụng thay đổi và invalidation. `shared/projectPipeline.ts` chỉ chứa các predicate thuần như `current`, `ready`, `stale`. Khi nguồn narration đổi, scene, sync, layout và render phụ thuộc không được tiếp tục dùng như bản hiện hành.

Artifact và workspace đã publish là bất biến. Apply/restore tạo bản copy-forward; preview chỉ dùng bản copy tạm, không sửa canonical workspace.

## Provider, retry và media

- Codex, ElevenLabs, FFmpeg/FFprobe và Motion Canvas được bọc bởi adapter/service; domain layer nhận dữ liệu đã schema hoá.
- `generationRegistry.ts` dùng `generationId` + fingerprint để join request trùng và từ chối cùng id nhưng khác input.
- Không retry mù quáng request AI/TTS sau lỗi mơ hồ; có thể đã phát sinh chi phí.
- Final render phải được FFprobe xác thực có video H.264 và audio AAC.
- Watermark nằm trong render settings, được dùng chung cho preview và render cuối.

## Storage

```text
projects/<project-id>/
  project.json           state đã schema hoá
  voice/, sync/, layout/ workspace và generation đã publish
  renders/               MP4, manifest và report terminal
.pad-studio/credentials.json  credential được bảo vệ trên Windows
tmp/                      preview/cache có thể xoá
```

Một backend process là chủ sở hữu của `projects/`. Không chạy nhiều process cùng ghi vào đó nếu chưa có file lock hoặc transaction store.

## Bảo mật và runtime

Backend và preview mặc định bind loopback. Chỉ mở `HOST` ra mạng khi có reverse proxy và xác thực phù hợp. Mọi path từ dữ liệu lưu phải resolve dưới project root; API key chỉ đọc từ biến môi trường hoặc credential store backend.

## Kiểm chứng

```powershell
npm run build
npm test
npm run validate
```

Sau thay đổi workflow, thêm test cho schema, invalidation và route liên quan. Sau thay đổi scene/preview/render, chạy thêm `npm run validate:motion` hoặc `npm run validate:sync` trên máy có browser và FFmpeg.
