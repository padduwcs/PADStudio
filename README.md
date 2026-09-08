# PADStudio prototype

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
├── skills/
└── runs/
    └── run-*.json
```

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
- `skills/`: catalog skill riêng của project khi cần; skill hệ thống nằm ở `skills/`.
- `runs/`: dấu vết từng thao tác import hoặc chạy công cụ, gồm cả lỗi, thời lượng
  và chi phí khi có.
- `checkpoint.json`: phần bối cảnh có ý nghĩa do Agent chắt lọc.
- `overview.md`: bản đọc nhanh được sinh từ checkpoint, không phải nguồn sự thật riêng.

Mỗi file trạng thái được ghi qua file tạm rồi thay thế nguyên tử. Project cũ
không có `project.json` không được coi là project hợp lệ.

## Cấu trúc mã nguồn

```text
src/
├── analysis/    # Source identity/timebase, contract Result, job/lease/resume/cancel
├── project/     # Lưu trữ, đường dẫn và tính toàn vẹn của project
├── intelligence/# Artifact, adaptive workflow, review, skill và context assembler
├── resources/   # Nhập và lập chỉ mục tài nguyên
├── execution/   # Danh mục công cụ và Bộ thực thi dùng chung
├── tools/       # Logic của từng công cụ cụ thể
├── cli/         # Các lệnh để Agent thao tác với project
└── web/         # Observer API và web server chỉ đọc
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
```

Xem capability và công cụ hiện có:

```powershell
npm run tool:list
```

Chạy một công cụ bằng request JSON từ standard input hoặc từ file:

```powershell
$request | npm run tool:run -- coffee-video -
npm run tool:run -- coffee-video D:\Temp\tool-request.json
```

Nếu kết quả đã được bảo toàn nhưng bước đóng Run lỗi, lệnh trả
`finalization_pending`. Hoàn tất lại dấu vết mà không chạy lại tool:

```powershell
npm run project:run:recover -- coffee-video run-...
```

Prototype hiện có chín capability thật:

- `media.inspect` / `ffprobe`: đọc metadata audio/video, không tạo file.
- `video.trim` / `ffmpeg-trim`: cắt chính xác video bằng re-encode và tạo `video.clip`.
- `video.concat` / `ffmpeg-concat`: ghép nhiều clip theo thứ tự, tự chọn ghép nhanh không mất
  chất lượng khi các clip đã cùng định dạng, hoặc tự đưa về cùng khung hình và chèn tiếng im
  lặng khi cần, có thể chuyển cảnh mờ dần hoặc qua đen.
- `video.reformat` / `ffmpeg-reformat`: đổi tỷ lệ khung hình/độ phân giải theo preset
  (`portrait`, `square`, `landscape`, `cinematic`, `vertical4x5`) hoặc kích thước tùy chọn.
- `video.thumbnail` / `ffmpeg-thumbnail`: trích chính xác một khung hình làm ảnh đại diện.
- `audio.overlay` / `ffmpeg-audio-overlay`: chèn một track âm thanh có sẵn (nhạc nền hoặc
  giọng đọc, không phải TTS) vào video, tự lặp/cắt cho khớp thời lượng, có thể tự giảm âm
  lượng track mới khi video đã có tiếng (ducking).
- `subtitle.burn` / `ffmpeg-subtitle-burn`: ghim cứng phụ đề đã có sẵn văn bản và mốc thời
  gian lên video, tự chọn cỡ chữ theo khung dọc/ngang.
- `image.to-video` / `ffmpeg-image-to-video`: biến một ảnh tĩnh thành đoạn video trong thời
  lượng cho trước, giữ nguyên khung hình hoặc thêm chuyển động máy quay nhẹ (`zoomIn`,
  `zoomOut`, `panLeft`, `panRight`, `kenBurns`).
- `video.render-sequence` / `ffmpeg-sequence`: dựng đúng revision cấu trúc video, giữ từng
  đoạn và khung hình review; dùng lại đoạn khớp spec/hash khi sửa cục bộ.

Ghi decision sau khi người dùng phản hồi rõ về một result:

```powershell
$decision | npm run project:decide -- coffee-video -
```

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

## Source Understanding — vòng đời gói B

Gói B đã có contract và coordinator bền vững:

```powershell
$request | npm run project:analyze -- <project-id> -
npm run analysis:resume -- <project-id> <analysis-id>
npm run analysis:cancel -- <project-id> <analysis-id>
```

Sáu adapter phân tích media thuộc gói C chưa được đăng ký vào default tool registry. Vì vậy CLI
hiện giữ job và báo `blocked` khi tool chưa có; nó không tự tải model, không dùng fallback và không
coi harness gói A là production tool. Contract và giới hạn cụ thể nằm trong
[SOURCE-UNDERSTANDING-PACKAGE-B.md](docs/build/SOURCE-UNDERSTANDING-PACKAGE-B.md).

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

## Kiểm tra

```powershell
npm test
```

Test bao phủ persistence, import thành công/thất bại, path safety, context khi
mở lại, danh mục công cụ, Bộ thực thi, ffprobe/ffmpeg thật, output rollback,
result dùng lại result trước, observer API, byte ranges và việc web không có
endpoint thay đổi project.
