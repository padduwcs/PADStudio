# PADStudio — bootstrap ngắn cho Agent vận hành

Đây là tài liệu mặc định khi **dùng PADStudio để làm video**. Không đọc tài liệu build, test, report hay project khác để bắt đầu một project.

Chat và quyết định sáng tạo nằm ở Agent host bên ngoài. Web PADStudio chỉ quan sát. Mọi thay đổi đi qua CLI/tool contract và được lưu vào đúng project.

## Bắt đầu an toàn

Luôn làm việc với một project ID tường minh.

```powershell
# Project mới
npm run project:create -- <project-id> "<tiêu đề>"
npm run project:resume -- <project-id>

# Project đã có
npm run project:resume -- <project-id>
```

`project:resume` là context mặc định. Nó chỉ trả checkpoint, việc hiện hành, artifact active cần tiếp tục, sequence/render mới nhất, feedback, health, budget và trạng thái phân tích cô đọng. Không dùng full context theo thói quen.

Chỉ khi resume thiếu dữ kiện cho việc cụ thể:

```powershell
npm run project:context -- <project-id> --view summary
npm run analysis:read -- <project-id> '<query-json>'
```

Full `project:context` là công cụ chẩn đoán cuối cùng, không phải bootstrap.

Project đã hoàn thành chỉ được đưa khỏi danh sách active khi người dùng yêu cầu, PADStudio/Agent khác đã dừng và không còn Run đang chạy:

```powershell
npm run project:archive -- archive <project-id> "<lý do>" --confirm-stopped
npm run project:archive -- list
npm run project:archive -- restore <project-id> --confirm-stopped
```

Archive di chuyển nguyên project và ghi manifest; không xóa lịch sử. Không archive project đang được một Agent khác sử dụng.

## Đọc theo nhu cầu

- Đọc đúng các skill trong `work.relevantSkillIds` bằng `npm run skill:read -- <skill-id> <project-id>`.
- Khi chọn tool, lọc capability cụ thể bằng `npm run tool:list -- --capability <capability>`; chỉ dùng `--view full` khi cần schema.
- Transcript, scene, frame và audio phải được đọc theo `resultId`/`sourceKey`, range, cursor và limit; không nạp toàn bộ JSONL.
- Không đọc `docs/build/`, `reports/`, `test/`, project khác hoặc lịch sử Git trong một phiên vận hành bình thường.

## Thực thi và lưu dấu vết

- Import file/folder bằng `project:import`; URL/asset web đã chọn dùng tool phù hợp để giữ nguồn và quyền sử dụng.
- Request chạy phải nêu exact `capability`, `tool`, `purpose` và inputs. Không fallback ngầm.
- Tool trả phí cần budget và authorization chính xác trước khi gọi provider.
- Ý tưởng, brief, direction, sequence và workflow quan trọng phải được lưu thành artifact/workflow; không chỉ nằm trong chat.
- Kết quả, lỗi, quyết định và feedback phải gắn đúng Resource/Result/Artifact revision.
- Sau thay đổi quan trọng, cập nhật checkpoint ngắn với goal, constraints, selectedResources, pending và next.

## Dựng, review và delivery

1. Tạo hoặc cập nhật `video.sequence` với revision và `changeReason`.
2. Render exact artifact bằng `video.render-sequence`; chỉ reuse Result khi contract/hash khớp.
3. Chạy `video.inspect-output` trên exact render.
4. Agent review đúng Result; người dùng xem trong observer và phản hồi trong chat.
5. Chỉ ghi Decision/attestation thay người dùng khi người dùng thực sự đã quyết định hoặc xem/nghe đầy đủ.
6. `video.export-delivery` chỉ dùng exact Result đã duyệt và có QA hợp lệ.

Nguồn thiếu, evidence stale, QA fail hoặc finalization dang dở phải được báo rõ; không tự bỏ qua. Dùng lệnh recovery hiện có để hoàn tất output đã bảo toàn mà không chạy lại provider.

## Khi cần chi tiết

Tra cứu [`PADSTUDIO-AGENT-REFERENCE.md`](PADSTUDIO-AGENT-REFERENCE.md) theo đúng mục đang làm. Không đọc toàn bộ reference nếu chỉ cần một lệnh hay contract. Trạng thái thực của project luôn đến từ `project:resume`, không đến từ tài liệu hoặc ký ức cuộc chat.
