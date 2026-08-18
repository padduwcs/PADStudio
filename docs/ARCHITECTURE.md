# PAD Studio — Kiến trúc

## Hợp đồng hệ thống

Project dùng schema **v16**. Frontend chỉ có năm bước: **Nội dung → Cách đọc →
Sản xuất → Chỉnh scene → Xuất video**. Backend là nơi duy nhất quyết định bước
tiếp tục và kiểm tra artifact nào còn hợp lệ; các route workflow cũ không còn
được hỗ trợ.

```text
app.ts
  → appContext.ts
  → apiDispatcher.ts
  → các feature route
  → repository / workspace / provider service
```

`app.ts` là composition root và quản lý cleanup. `appContext.ts` khởi tạo
dependency và generation registry. `apiDispatcher.ts` gọi tuần tự các handler
System, Project CRUD, Motion, Voice, Sync, Render, Pronunciation, Narration và
Production.

| Module | Trách nhiệm |
| --- | --- |
| `httpTransport.ts` | Đọc body, `If-Match`, JSON response, HEAD và byte range. |
| `appErrors.ts` | Ánh xạ lỗi domain/provider thành hợp đồng lỗi HTTP ổn định. |
| `frontendStatic.ts` | Phục vụ frontend build và SPA fallback. |
| `appRouteSupport.ts` | Helper artifact dùng chung giữa các feature route. |
| `*Routes.ts` | Parse và điều phối đúng một nhóm endpoint. |
| `projectRepository.ts` | Lưu project, revision và cập nhật nguyên tử trên filesystem. |
| `*Workspace.ts` / `*Service.ts` | Provider, media, preview và artifact bất biến. |

## Project và tính nhất quán

`TopicProject` trong `src/shared/topic.ts` là nguồn sự thật. Mỗi lần ghi tăng
`revision`. Frontend gửi ETag bằng `If-Match`; revision cũ nhận
`409 PROJECT_CONFLICT` thay vì ghi đè thay đổi từ tab khác.

```text
Narration đã duyệt
  → TeachingOutline / VoiceVisualPlan xác định
  → Voice + Motion Canvas
  → Animation Sync
  → Visual Design / Layout
  → Final Render
```

`TeachingOutline` và `VoiceVisualPlan` là artifact nội bộ xác định, không phải
hai bước UI legacy. `reconcileProjectState()` và predicate trong
`projectPipeline.ts` đánh dấu stale hoặc loại artifact phụ thuộc khi source
revision, mapping, timing hay generation đã duyệt thay đổi.

Workspace đã publish là bất biến. Apply/restore tạo phiên bản copy-forward;
preview chỉ làm việc trên bản sao tạm, không sửa canonical workspace.

## Generation, retry và restart

Generation ID luôn gắn với fingerprint đầu vào. Request đang chạy có cùng ID và
fingerprint được join; dùng lại ID cho đầu vào khác bị từ chối. Registry của
Narration, Motion, Voice và Sync nằm trong process để điều phối request đồng
thời, còn artifact đã publish nằm trên filesystem.

Voice lưu checkpoint theo chunk. Không retry mù một POST TTS có kết quả mơ hồ vì
provider có thể đã tính phí. Final Render chạy background trong process nhưng
lưu terminal report, nhờ đó trạng thái completed/failed có thể đọc lại sau khi
backend khởi động lại. Chi tiết retry cho từng loại job nằm trong
[OPERATIONS.md](OPERATIONS.md).

## Storage và bảo mật

```text
projects/<project-id>/
  project.json
  motion-canvas/, voice/, sync/, layout/
  renders/
.pad-studio/credentials.json
tmp/
```

Project, workspace, media, credential và cache là dữ liệu runtime, không phải
source asset. Backend mặc định bind loopback. Không chạy nhiều backend process
cùng ghi một thư mục `projects/` vì repository chưa có multi-process lock hoặc
transaction manager.

Frontend không đọc credential và không gọi provider trực tiếp. Mọi path lưu trữ
phải resolve bên dưới project root. FFmpeg, FFprobe, browser, Motion Canvas,
Codex và ElevenLabs đều đi qua adapter/service backend.

## Kiểm chứng

```powershell
npm run doctor -- --allow-missing-runtime
npm test
npm run build
npm run validate
```

`npm run validate` cần đầy đủ FFmpeg, FFprobe và browser. Thay đổi workflow phải
có regression test cho schema, transition và invalidation; thay đổi scene/media
phải chạy thêm validation Motion/Sync.
