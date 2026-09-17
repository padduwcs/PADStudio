# PADStudio

PADStudio là kho project và bộ thực thi local cho quy trình làm video do Agent dẫn dắt. Người dùng chat với Agent ở host bên ngoài; web PADStudio là observer chỉ đọc. Project giữ input, artifact có revision, workflow, Run/Result, quyết định, feedback, QA và provenance để có thể mở lại và tiếp tục.

## Dùng PADStudio

Agent vận hành chỉ cần đọc [`PADSTUDIO-AGENT-RUNTIME.md`](PADSTUDIO-AGENT-RUNTIME.md), sau đó bắt đầu bằng context cô đọng:

```powershell
npm run project:create -- demo "Video thử nghiệm"
npm run project:resume -- demo
npm start
```

Observer chạy tại `http://127.0.0.1:7603/?project=demo`.

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

Một render/preview không phải file final. Bản bàn giao chính thức chỉ được tạo từ exact Result đã được người dùng duyệt và qua QA bằng `video.export-delivery`; không lấy file sao chép thủ công ngoài project làm nguồn sự thật.

Gate tương tác dành cho người dùng chỉ còn ở exact render cuối: `npm run project:accept -- ...`.
Code animation được Agent validate, preflight, preview, sửa và render trong workspace được quản lý;
người dùng không phải duyệt từng source code trung gian.

## Phát triển PADStudio

Coding Agent làm theo router trong [`AGENTS.md`](AGENTS.md). Điểm vào tài liệu phát triển là [`docs/build/README.md`](docs/build/README.md); không dùng tài liệu Phase/Package lịch sử làm trạng thái hiện hành.

```powershell
npm test
npm run assets:acceptance
npm run production:acceptance
npm run operations:acceptance
npm run release:acceptance
```

Trạng thái V1 và giới hạn bằng chứng thực: [`docs/build/PADSTUDIO-V1-COMPLETION.md`](docs/build/PADSTUDIO-V1-COMPLETION.md). Hướng dẫn vận hành/backup/khôi phục: [`docs/OPERATIONS-RUNBOOK.md`](docs/OPERATIONS-RUNBOOK.md).
