# PADStudio — quy ước tạm thời cho Agent host

Trong prototype này, chat nằm trong Agent host mà người dùng đang dùng. Web
PADStudio chỉ quan sát project local; nó không gửi lệnh cho Agent.

## Bắt đầu hoặc tiếp tục project

Mỗi project hợp lệ là một thư mục trong `.padstudio/projects/` có
`project.json`. Khi bắt đầu project mới, tạo rõ danh tính:

```powershell
npm run project:create -- <project-id> "<tiêu đề>"
```

Trước khi tiếp tục một project, đọc context:

```powershell
npm run project:context -- <project-id>
```

Không suy luận trạng thái chỉ từ tên file hoặc trí nhớ cuộc chat.

## Nhập tư liệu

Khi người dùng upload file/folder trong chat và Agent có đường dẫn local thật:

```powershell
npm run project:import -- <project-id> <file-hoặc-folder-nguồn>
```

Nếu project chưa tồn tại, lệnh import tạo project với tiêu đề suy ra từ id.
Nên dùng `project:create` trước khi cần tiêu đề chính xác.

Import:

- không sửa nguồn;
- không ghi đè file đã có;
- từ chối symbolic link, junction không an toàn và đường dẫn chồng lên project;
- chỉ tạo resource sau khi bản sao hoàn chỉnh đã vào `inputs/`;
- luôn giữ run thành công hoặc thất bại khi yêu cầu import hợp lệ đã bắt đầu.

Folder được ghi là một resource; các file bên trong là items của resource đó,
không bị hiểu thành nhiều lần import độc lập. Với path hoặc URL bên ngoài,
Agent chỉ nhập phần đã xem và quyết định cần dùng.

Nếu lệnh thất bại, nói rõ trong chat và không tuyên bố rằng resource đã được lưu.

## Đọc và ghi hiểu biết về nguồn

Đọc skill trước khi đánh giá tư liệu:

```powershell
npm run skill:read -- source-understanding <project-id>
```

Để tiếp tục nhanh, dùng context summary; chỉ đọc full context khi cần toàn bộ lịch sử:

```powershell
npm run project:context -- <project-id> --view summary
npm run analysis:read -- <project-id> '{"view":"summary"}'
```

Reader hỗ trợ các view `transcript`, `scenes`, `frames`, `audio`, `assessment`,
`search` và `job`. View dataset cần `sourceKey` hoặc `resultId`, có thể thêm `range`,
`limit`, `cursor`; transcript có `transcriptMode` là `raw`, `corrected` hoặc `both`.
Không tự đọc hàng loạt JSONL hoặc giữ toàn bộ transcript trong checkpoint.

```powershell
npm run analysis:read -- <project-id> '{"view":"transcript","resultId":"result-...","limit":50}'
npm run analysis:read -- <project-id> '{"view":"search","text":"cụm cần tìm","diacriticInsensitive":true}'
```

Search chỉ dùng index đã verify. Khi index chưa sẵn sàng hoặc stale:

```powershell
npm run analysis:verify -- <project-id>
```

Verify hash source và file hiện hành nhưng không sửa Result lịch sử. Phân biệt
`verified_current`, `stale`, `missing` và `unchecked`; không bỏ qua warning freshness.

Ba artifact chuyên biệt được ghi qua CLI:

```powershell
$profile | npm run project:source-profile -- <project-id> -
$assessment | npm run project:source-assessment -- <project-id> -
$edit | npm run project:transcript-edit -- <project-id> -
```

- `source.profile` ghi vai trò, mục đích, ràng buộc và nguồn gốc.
- `source.assessment` tách observation/inference, certainty, limitation/open question,
  usable range và coverage thật sự đã xem/nghe/đọc.
- `source.transcript-edit` chỉ phủ correction lên raw transcript; phải giữ
  `originalText` và dẫn segment đã nghe.

Mọi nhận xét có hệ quả phải dẫn Result/item/file/range tồn tại và nằm trong
`evidenceReviewed`. Không ghi `watched`/`listened` nếu chỉ đọc transcript hoặc xem
contact sheet. Khi sửa artifact, đọc revision mới nhất và truyền `expectedRevision`
cùng `changeReason`. Contract đầy đủ:
[SOURCE-UNDERSTANDING-PACKAGE-D.md](docs/build/SOURCE-UNDERSTANDING-PACKAGE-D.md).

## Dùng project intelligence và workflow thích nghi

Sau khi đọc context, xem skill và workflow template đang có:

```powershell
npm run skill:list -- <project-id>
npm run skill:read -- <skill-id> <project-id>
npm run workflow:list
```

Skill hướng dẫn cách làm và tiêu chuẩn review; không phải lệnh tự chạy. Template
chỉ là điểm khởi đầu:

```powershell
npm run project:workflow:init -- <project-id> quick-media-task
```

Agent có thể ghi artifact hiểu biết hoặc sáng tạo qua standard input:

```json
{
  "key": "project-brief",
  "type": "project.brief",
  "name": "Brief hiện hành",
  "summary": "Video ngắn giới thiệu không gian và con người.",
  "status": "active",
  "data": {
    "purpose": "Tạo cảm giác gần gũi",
    "audience": "Khách địa phương"
  },
  "references": [],
  "createdBy": "agent"
}
```

```powershell
$artifact | npm run project:artifact -- <project-id> -
```

Ghi workflow riêng bằng `project:workflow`. Mỗi item phải có `id`, `title`,
`purpose`, `status`, `dependsOn`, `skillIds`, `inputReferences`,
`expectedOutputs`, `outputReferences`, `review` và `approval`. Khi sửa,
gửi lại snapshot đầy đủ với cùng workflow `id` và `changeReason`; PADStudio tự
tạo revision kế tiếp.

```powershell
$workflow | npm run project:workflow -- <project-id> -
$review | npm run project:review -- <project-id> -
```

Không đánh dấu item `completed` khi dependency chưa xong. Nếu review là bắt buộc,
ghi review pass trước. Nếu approval là `required`, ghi decision do người dùng
quyết định trước:

Luồng chuẩn là `in_progress → awaiting_review → awaiting_approval → completed`.
Chỉ đưa item vào `awaiting_approval` sau khi đã có output reference và review bắt
buộc đã pass. Một project chỉ có một workflow `active` tại một thời điểm.

Review chỉ được ghi khi work item đang `awaiting_review` và đã có output. Approval
chỉ được ghi khi item đang `awaiting_approval`. Review và approval được khóa theo
đúng tập output; thay output hoặc đổi ý nghĩa item bắt buộc phải review/duyệt lại.

```json
{
  "target": {
    "kind": "work_item",
    "workflowId": "workflow-...",
    "workItemId": "choose-direction"
  },
  "category": "creative_direction_approval",
  "subject": "Duyệt hướng sáng tạo",
  "outcome": "approved",
  "options": [
    { "id": "warm", "label": "Ấm áp", "description": "Gần gũi và đời thường" },
    { "id": "graphic", "label": "Đồ họa", "description": "Nhanh và trừu tượng" }
  ],
  "selected": "warm",
  "reason": "Phù hợp hơn với khán giả đã chọn.",
  "decidedBy": "user",
  "userVisible": true,
  "confidence": "high"
}
```

Decision lựa chọn của Agent dùng `outcome: "recorded"`, ít nhất hai option và
selection có lý do. Không ghi approval `decidedBy: "user"` nếu người dùng chưa
thực sự xác nhận.

Contract đầy đủ:
[PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md](docs/build/PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md).

## Cấu trúc video và bản dựng có phiên bản

Đọc skill `video-sequence-planning` khi cần tổ chức và sửa một video.
Lưu sequence qua `npm run project:sequence -- <project-id> <json-file|->`.
Mỗi lần sửa cần `expectedRevision` vừa đọc và `data.changeReason`.

Dựng bằng `video.render-sequence` / `ffmpeg-sequence`, truyền `artifactId`
chính xác; `reuseResultId` tùy chọn để dùng lại các đoạn thực sự khớp.
Nguồn còn thiếu sẽ được báo, không tự tạo hoặc bỏ qua. Không có API tính phí.

Đọc `context.production` trước khi tiếp tục: phân biệt revision đang active,
các dependency đã đổi và review/decision của đúng result. Xem/nghe preview và
khung hình đã đăng ký trước khi review; kiểm tra kỹ thuật không chứng minh
đúng lời đọc, phụ đề hay chất lượng sáng tạo.

Xem contract và ví dụ tại
[VIDEO-SEQUENCE-PRODUCTION.md](docs/build/VIDEO-SEQUENCE-PRODUCTION.md).

## Dùng công cụ

Xem các capability và công cụ thực sự dùng được trên máy:

```powershell
npm run tool:list
```

Để chạy một công cụ, chuẩn bị request JSON:

```json
{
  "capability": "media.inspect",
  "tool": "ffprobe",
  "purpose": "Đọc thông số kỹ thuật của video nguồn",
  "inputs": {
    "resourceId": "resource-..."
  }
}
```

Nếu resource là folder, thêm `itemPath` đúng với file bên trong resource. Agent có
thể truyền JSON qua standard input, không cần tạo file tạm:

```powershell
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = '{"capability":"media.inspect","tool":"ffprobe","purpose":"Đọc thông số kỹ thuật","inputs":{"resourceId":"resource-..."}}'
$request | npm run tool:run -- <project-id> -
```

Dòng `OutputEncoding` bảo toàn Unicode khi Agent chạy trong Windows PowerShell 5.

Cách truyền đường dẫn tới file request JSON vẫn được hỗ trợ khi cần:

```powershell
npm run tool:run -- <project-id> <file-request-json>
```

Agent phải chọn rõ capability và tool từ danh mục; hệ thống không tự fallback sang
tool khác. Lệnh thành công lưu một result và run liên kết với nhau. Lệnh thất bại
vẫn lưu failed run sau khi một yêu cầu hợp lệ đã bắt đầu.

Nếu tool trả `status: "finalization_pending"`, Result và file output đã được bảo
toàn nhưng record Run chưa đóng xong. Không chạy lại tool. Đọc context để lấy Run
đang recoverable rồi hoàn tất dấu vết:

```powershell
npm run project:run:recover -- <project-id> <run-id>
```

Nếu context báo `checkpointFreshness.status: "stale"`, Agent phải đọc các hoạt động
mới hơn và ghi checkpoint mới trước khi dựa vào trường `next` cũ.

### Cắt video

`video.trim` tạo một clip mới; Agent chỉ tham chiếu nguồn và mốc cắt, không truyền
đường dẫn file hệ thống hay đường dẫn output:

```json
{
  "capability": "video.trim",
  "tool": "ffmpeg-trim",
  "purpose": "Cắt đoạn mở đầu đã chọn",
  "inputs": {
    "source": {
      "kind": "resource",
      "id": "resource-...",
      "itemPath": null
    },
    "startSeconds": 2,
    "endSeconds": 8
  }
}
```

Nguồn cũng có thể là clip từ result trước:

```json
{
  "source": {
    "kind": "result",
    "id": "result-...",
    "file": "primary"
  },
  "startSeconds": 0,
  "endSeconds": 3
}
```

Mốc thời gian là số giây, `startSeconds >= 0`, `endSeconds > startSeconds` và
không vượt quá thời lượng nguồn. PADStudio tự cấp vùng output, chỉ ghi result sau
khi file MP4/H.264 đã qua ffprobe; nếu lỗi, file tạm hoặc output chưa hoàn tất bị
thu hồi. Tool không sửa file nguồn và không tự chuyển sang stream copy.

### Ghép video

`video.concat` ghép từ 2 clip trở lên theo thứ tự đã cho; mỗi phần tử của
`sources` có cùng hình dạng như `source` của `video.trim` (resource hoặc result):

```json
{
  "capability": "video.concat",
  "tool": "ffmpeg-concat",
  "purpose": "Ghép cảnh mở đầu và cảnh sản phẩm",
  "inputs": {
    "sources": [
      { "kind": "resource", "id": "resource-...", "itemPath": null },
      { "kind": "result", "id": "result-...", "file": "primary" }
    ],
    "transition": "crossfade",
    "transitionSeconds": 0.5
  }
}
```

`transition` là `cut` (mặc định), `crossfade` hoặc `fadeBlack`; `transitionSeconds`
chỉ được truyền khi có transition, trong khoảng 0.1-3 giây. Nếu các clip đã cùng
định dạng và không có transition, PADStudio tự ghép kiểu lossless tức thì; nếu
không, PADStudio tự đưa các clip về cùng khung hình/tốc độ khung hình (không méo
hình) và tự chèn track im lặng cho clip nào thiếu audio trước khi ghép — Agent
không cần kiểm tra tương thích trước. Result ghi rõ có dùng đường lossless không
và clip nào bị chèn tiếng im lặng (`losslessFastPath`, `audioSynthesizedIndexes`).

### Đổi khung hình video

`video.reformat` đổi tỷ lệ khung hình hoặc độ phân giải của một video, dùng
`preset` (`portrait`, `square`, `landscape`, `cinematic`, `vertical4x5`) hoặc
`width`+`height` tường minh — chỉ được chọn đúng một trong hai cách:

```json
{
  "capability": "video.reformat",
  "tool": "ffmpeg-reformat",
  "purpose": "Đổi sang khung dọc cho mạng xã hội",
  "inputs": {
    "source": { "kind": "resource", "id": "resource-...", "itemPath": null },
    "preset": "portrait",
    "fit": "pad"
  }
}
```

`fit` là `pad` (mặc định, giữ nguyên toàn khung hình, thêm viền đen khi cần) hoặc
`crop` (lấp đầy khung, có thể mất mép hình). Thời lượng và audio của nguồn được
giữ nguyên; chỉ khung hình thay đổi.

### Trích ảnh đại diện

`video.thumbnail` trích chính xác một khung hình tại `atSeconds` (nhỏ hơn thời
lượng nguồn) thành ảnh PNG:

```json
{
  "capability": "video.thumbnail",
  "tool": "ffmpeg-thumbnail",
  "purpose": "Lấy ảnh đại diện cho video giới thiệu",
  "inputs": {
    "source": { "kind": "result", "id": "result-...", "file": "primary" },
    "atSeconds": 4.5
  }
}
```

### Chèn âm thanh

`audio.overlay` chèn một track âm thanh *có sẵn* (nhạc nền hoặc file giọng đọc,
chưa phải TTS) vào video; track được tự lặp hoặc cắt cho khớp đúng thời lượng
video, Agent không cần tính trước:

```json
{
  "capability": "audio.overlay",
  "tool": "ffmpeg-audio-overlay",
  "purpose": "Thêm nhạc nền cho video",
  "inputs": {
    "video": { "kind": "result", "id": "result-...", "file": "primary" },
    "audio": { "kind": "resource", "id": "resource-...", "itemPath": null },
    "mode": "duck",
    "audioVolume": 0.4,
    "fadeInSeconds": 1,
    "fadeOutSeconds": 1
  }
}
```

`mode` là `mix` (mặc định, lớp âm thanh mới ở nguyên mức `audioVolume`) hoặc
`duck` (tự giảm âm thanh mới xuống còn `duckLevel`, mặc định 0.15, khi video
gốc đang có tiếng — video gốc luôn là track được giữ rõ, không phải chiều
ngược lại). Nếu video gốc không có audio, `duck` tự chuyển thành `mix`; result
ghi rõ `duckApplied` có thật sự áp dụng không. `loudnessTargetLufs` (tùy chọn)
chuẩn hóa độ to cuối cùng — dùng -16 cho giọng nói/podcast, -14 cho mạng xã
hội/YouTube, chỉ chuẩn hóa một lần ở bước cuối.

### Ghim phụ đề

`subtitle.burn` nhận danh sách `cues` đã có sẵn văn bản và mốc thời gian (Agent
tự quyết định cách chia câu; PADStudio không tự nhận dạng giọng nói) rồi ghim
cứng lên video:

```json
{
  "capability": "subtitle.burn",
  "tool": "ffmpeg-subtitle-burn",
  "purpose": "Ghim phụ đề tiếng Việt",
  "inputs": {
    "source": { "kind": "result", "id": "result-...", "file": "primary" },
    "cues": [
      { "text": "Chào mừng bạn", "startSeconds": 0, "endSeconds": 1.8 },
      { "text": "đến với quán cà phê của chúng tôi", "startSeconds": 1.8, "endSeconds": 4 }
    ]
  }
}
```

Cues phải theo thứ tự thời gian, không chồng lấp và không kết thúc sau thời
lượng nguồn. Cỡ chữ và margin tự chọn theo khung dọc/ngang của video (`fontSize`,
`marginV` có thể ghi đè khi cần).

### Video từ ảnh

`image.to-video` biến một ảnh tĩnh thành đoạn video trong `durationSeconds`
cho trước (0.1-300 giây), có thể giữ nguyên khung hình hoặc thêm chuyển động
máy quay nhẹ:

```json
{
  "capability": "image.to-video",
  "tool": "ffmpeg-image-to-video",
  "purpose": "Mở đầu video bằng ảnh chụp không gian quán",
  "inputs": {
    "source": { "kind": "resource", "id": "resource-...", "itemPath": null },
    "durationSeconds": 3,
    "motion": "kenBurns"
  }
}
```

`motion` là `static` (mặc định, giữ nguyên khung hình), `zoomIn`, `zoomOut`,
`panLeft`, `panRight` hoặc `kenBurns` (zoom kèm lia chéo nhẹ). Biên độ zoom/lia
cố định ở mức dè dặt, không đẩy tới sát mép crop nên không lộ viền — Agent chọn
kiểu chuyển động, không tự chỉnh tay mức độ. Clip quá ngắn để nội suy chuyển
động sẽ tự quay lại `static`; result ghi rõ `motion` thực sự đã dùng. Nếu cần
đổi tỷ lệ khung hình, ghép nối hay thêm âm thanh, dùng tiếp `video.reformat`,
`video.concat` hoặc `audio.overlay` trên kết quả này.

## Ghi quyết định về kết quả

Chỉ ghi decision khi người dùng đã phản hồi rõ về một result. Chuẩn bị JSON:

```json
{
  "resultId": "result-...",
  "outcome": "changes_requested",
  "note": "Giữ bản này nhưng thay câu kết"
}
```

Sau đó truyền trực tiếp qua standard input:

```powershell
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$decision = '{"resultId":"result-...","outcome":"changes_requested","note":"Giữ bản này nhưng thay câu kết"}'
$decision | npm run project:decide -- <project-id> -
```

`outcome` là `accepted`, `changes_requested` hoặc `rejected`. Khi yêu cầu sửa,
`note` là bắt buộc. Decision mới được ghi nối tiếp lịch sử; không sửa hay xóa result
và không ngầm loại result khác. Nếu quyết định làm thay đổi trạng thái tổng thể của
project, Agent cập nhật checkpoint bằng một hành động riêng.

## Ghi checkpoint

Agent chắt lọc bối cảnh có ý nghĩa vào một file JSON tạm, ví dụ:

```json
{
  "goal": "Video giới thiệu quán cà phê, dài 30 giây",
  "constraints": ["Tông ấm", "Không dùng nhạc có bản quyền"],
  "selectedResources": ["resource-..."],
  "pending": ["Chờ người dùng chọn giọng đọc"],
  "next": "Phân tích video nguồn"
}
```

Sau đó ghi vào project:

```powershell
npm run project:checkpoint -- <project-id> <file-json>
$checkpoint | npm run project:checkpoint -- <project-id> -
```

`selectedResources` chỉ được tham chiếu resource đang tồn tại.
`next` là quyết định của Agent, không do PADStudio tự suy ra.
`overview.md` được sinh lại từ checkpoint để con người đọc nhanh; không sửa
file này thay cho checkpoint.

Checkpoint giữ các sự thật còn hiệu lực, không giữ full transcript, chuỗi
approve/reject, suy nghĩ nội bộ hay một pipeline cố định.

## Ranh giới

Agent dùng CLI để thay đổi project. Web chỉ đọc project, preview tư liệu và
hiển thị checkpoint, kết quả và lần chạy. Agent không dùng web để gửi lệnh,
import hay cập nhật checkpoint.
