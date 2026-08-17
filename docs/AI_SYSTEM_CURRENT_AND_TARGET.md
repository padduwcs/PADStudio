# Hệ thống AI của PAD Studio

Tài liệu này mô tả ranh giới AI hiện tại và nguyên tắc để phát triển tiếp. Nguồn dữ liệu chuẩn luôn là `project.json` cùng artifact đã publish; thread Codex không phải bộ nhớ dài hạn.

## Hiện trạng

```text
Nội dung + cách đọc
  ├─ Codex: tạo nội dung/scene có cấu trúc
  ├─ ElevenLabs: narration + alignment
  └─ Deterministic: sync → editor → render
```

Mỗi request Codex được dựng lại từ snapshot dữ liệu project hiện hành. AI chỉ tạo hoặc đánh giá dữ liệu; backend validate schema, kiểm soát phạm vi chỉnh sửa và quyết định dữ liệu nào được publish.

| Công việc | Đầu vào chính | Đầu ra |
| --- | --- | --- |
| Gợi ý nội dung | dữ liệu đang nhập | gợi ý chưa tự lưu |
| Sinh/sửa nội dung | project snapshot + scope + góp ý | artifact hoặc patch có schema |
| Sinh scene | narration/visual brief + scene cần tạo | Motion Canvas source |
| Review AI | artifact nền và bản đề xuất | report, không tự sửa dữ liệu |
| Tạo voice | narration đã chốt | master audio, alignment, checkpoint |

Sync, preview, editor và render không dùng AI tạo nội dung. Narration là mốc thời gian nguồn cho scene.

## Quy tắc an toàn

- Input của mỗi lần gọi phải đến từ snapshot project rõ ràng, không dựa vào trí nhớ hội thoại.
- Request có `generationId` và fingerprint để tránh gọi lại gây tốn quota khi retry.
- Candidate không tự thành bản hiện hành. Chỉ thao tác apply/approve mới thay đổi project revision.
- Chỉnh sửa hẹp phải nêu scope; dữ liệu ngoài scope được backend bảo vệ.
- Source scene phải qua schema, policy và compile/validation trước khi publish.
- Timeout hoặc mất kết nối mơ hồ không được retry tự động với provider tính phí.
- Khi nguồn thay đổi, downstream artifact phải được invalidation thay vì được dùng tiếp như còn khớp.

## Kiến trúc đích

Giữ một broker generation thống nhất cho Codex và các provider: nhận snapshot bất biến, tạo job có trạng thái rõ ràng, lưu log/artefact tối thiểu cần thiết và trả lỗi có thể hành động. Mỗi job cần:

```text
queued → running → succeeded | failed | cancelled
```

Job lưu provider/model, input fingerprint, thời điểm, artefact đã publish và lỗi đã chuẩn hoá. UI chỉ hiển thị tiến độ, kết quả và lựa chọn tiếp theo; không tự đoán trạng thái từ thread hoặc file tạm.

## Khi mở rộng

1. Thêm schema và migration trước khi thêm field vào project.
2. Xác định dependency và invalidation trước khi nối UI.
3. Tạo workflow/service có test trước khi thêm route.
4. Với nguồn sinh mới, thêm validate, history/copy-forward và retry policy.
5. Kiểm tra full flow bằng project ngắn có quota thật khi thay đổi provider, narration hoặc render.

Xem [kiến trúc](ARCHITECTURE.md) cho state, workspace và runtime; xem [bối cảnh sản phẩm](PROJECT_CONTEXT.md) cho nguyên tắc UX.
