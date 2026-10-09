# PADStudio

<p><img src="ui/brand/padstudio-emblem-transparent.png" alt="PADStudio" width="280" /></p>

**Precise Animated Demonstration Studio**

PADStudio là kho project và bộ thực thi local cho quy trình làm video do Agent dẫn dắt. Người dùng chat với Agent ở host bên ngoài; web PADStudio là observer chỉ đọc. Project giữ input, artifact có revision, workflow, Run/Result, quyết định, feedback, QA và provenance để có thể mở lại và tiếp tục.

**Mới bắt đầu?** Đọc [`docs/HUONG-DAN.md`](docs/HUONG-DAN.md): chuẩn bị máy, làm video đầu tiên, góp ý, chốt và nhận file.

[Bộ nhận diện PADStudio](ui/brand/README.md) dùng chung cho web và tài liệu của dự án.

## Dùng PADStudio

Agent vận hành chỉ cần đọc [`PADSTUDIO-AGENT-RUNTIME.md`](PADSTUDIO-AGENT-RUNTIME.md), sau đó bắt đầu bằng context cô đọng:

```powershell
npm run project:create -- demo "Video thử nghiệm"
npm run project:resume -- demo
npm start
```

Observer chạy tại `http://127.0.0.1:7603/?project=demo` (chỉ bind localhost, chỉ phục vụ `GET`).
`npm run observer:ensure -- [project-id]` tái dùng server đang chạy hoặc khởi động một server mới.

Các nhóm khả năng chính gồm phân tích source, transcript/scene/frame/audio, creative artifact và workflow, tìm/nhập/chuẩn bị asset, graphic, TTS local/cloud, hoạt họa project-native bằng Manim/Remotion/HyperFrames, trim/concat/reformat/subtitle/audio overlay, image-to-video, sequence composition, exact-output QA và delivery có checksum. Xem tool thực tế trên máy bằng:

```powershell
npm run tool:list
npm run tool:list -- --capability video.render-sequence
npm run system:profile
```

`project:resume` tự kèm một planning environment cô đọng cho Agent: CPU/RAM/GPU khi dò được,
dung lượng, runtime composition, capability đang dùng được, cảnh báo và setup offer không chứa secret.
`system:profile` mở cùng dữ kiện ở mức hệ thống khi cần kiểm tra riêng.

Tài liệu lệnh/contract đầy đủ chỉ tra cứu khi cần: [`PADSTUDIO-AGENT-REFERENCE.md`](PADSTUDIO-AGENT-REFERENCE.md). README dài trước đây được giữ tại [`PADSTUDIO-REFERENCE.md`](PADSTUDIO-REFERENCE.md).

Project hoàn thành có thể được đưa khỏi danh sách active mà không xóa dữ liệu bằng `npm run project:archive -- archive ... --confirm-stopped`; xem bootstrap runtime trước khi dùng.

Một render/preview không phải file final. Bản bàn giao chính thức được tạo từ exact Result người dùng đã duyệt bằng `video.export-delivery`, giữ nguyên byte và checksum; QA sâu là kiểm tra trước duyệt hoặc bằng chứng advisory, không phải blocker hậu duyệt.

Người dùng duyệt exact render ngay trong chat; Agent ghi quyết định bằng `project:accept -- ... --from-agent-host`. Terminal tương tác chỉ là lựa chọn cho full-view/full-listen attestation.
Code animation được Agent validate, preflight, preview, sửa và render trong workspace được quản lý;
người dùng không phải duyệt từng source code trung gian.

## Phát triển PADStudio

Coding Agent làm theo router trong [`AGENTS.md`](AGENTS.md). Điểm vào tài liệu phát triển là [`docs/build/README.md`](docs/build/README.md); không dùng tài liệu Phase/Package lịch sử làm trạng thái hiện hành.

PADStudio vẫn đang trong quá trình phát triển và chỉnh chu. Baseline code/test gần nhất cùng cách
phân biệt tài liệu hiện hành với snapshot lịch sử nằm tại
[`docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md`](docs/build/PADSTUDIO-DEVELOPMENT-STATUS.md).

```powershell
npm run check                     # cú pháp, import thừa/thiếu, link tài liệu và tên script (vài giây)
npm test
npm run observer:ui:empty-test    # observer trên kho trống/project mới (Node, kho tạm)
npm run observer:ui:live-test     # tiến độ trực tiếp: preview đầu tiên, giữ player (Node, kho tạm)
npm run observer:ui:test -- --url http://127.0.0.1:7603 --project <project-id>   # browser smoke nhiều viewport (Node, cần Chrome/Edge)
npm run assets:acceptance
npm run production:acceptance
npm run operations:acceptance
npm run release:acceptance
```

Báo cáo mốc V1 ngày 2026-09-14 được giữ để truy vết tại
[`docs/build/history/PADSTUDIO-V1-COMPLETION.md`](docs/build/history/PADSTUDIO-V1-COMPLETION.md); đó không phải
tuyên bố trạng thái sản phẩm hiện tại. Hướng dẫn vận hành/backup/khôi phục:
[`docs/OPERATIONS-RUNBOOK.md`](docs/OPERATIONS-RUNBOOK.md).
