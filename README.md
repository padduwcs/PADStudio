# PAD Studio

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ sản xuất video giảng giải trực quan bằng animation.

Ứng dụng hướng đến việc giải thích thuật toán và cấu trúc dữ liệu cho người mới học bằng hình ảnh logic, dễ hiểu và đồng bộ chính xác với lời thuyết minh. Video tập trung vào bản chất của kiến thức, không hiển thị code và không phụ thuộc vào caption.

## Quy trình chính

```text
Nhập chủ đề
→ Tạo và review mạch giảng
→ Tạo và review kế hoạch voice–visual
→ Sinh và review scene Motion Canvas
→ Sinh voice
→ Đồng bộ animation
→ Chỉnh sửa bằng Layout Editor
→ Render video cuối
```

Người dùng có thể chỉnh vị trí, kích thước và thuộc tính hiển thị trực tiếp trên giao
diện; timing đã đồng bộ được giữ chỉ đọc trong Layout Editor MVP. Những scene và
component tốt có thể được lưu lại làm tài nguyên tham khảo cho các video sau.

## Trạng thái

PAD Studio đang trong giai đoạn phát triển ban đầu.

Vertical slice đầu tiên đã có thể chạy:

- Nhập chủ đề và định hướng cho video.
- Validate dữ liệu ở frontend và backend.
- Lưu project draft vào `projects/<project-id>/project.json`.
- Tự động lưu thay đổi vào project hiện tại.
- Phát hiện xung đột chỉnh sửa thay vì âm thầm ghi đè dữ liệu mới hơn.
- Đăng nhập Codex và xác minh phiên bằng kết nối thật trước khi sang mạch giảng.
- Dùng toàn bộ đầu vào để AI tóm tắt yêu cầu và đề xuất mạch giảng có cấu trúc.
- Chỉnh sửa, sắp xếp, tạo lại và chốt mạch giảng trước bước voice–visual.
- Tạo kế hoạch voice–visual theo từng ý đã chốt, gồm lời thuyết minh, visual,
  chuyển động và thời lượng của từng beat; thời lượng được PAD Studio tính từ
  chính lời đọc thay vì để AI ước lượng theo animation.
- Chỉnh sửa, sắp xếp beat, tạo lại theo góp ý và chốt kế hoạch trước khi sinh
  scene hoặc gọi dịch vụ tạo voice.
- Sinh một scene Motion Canvas cho từng section đã chốt, kiểm tra quyền import
  và biên dịch TypeScript trước khi nhận kết quả.
- Xem source, tạo lại theo góp ý và chốt bộ scene trước khi sang bước tiếp theo.
- Scene mới dùng time-event ổn định theo từng beat
  (`beat:<beat-id>:start/end`) và có metadata timing dự kiến, để bước đồng bộ
  sau này chỉ thay thời điểm event bằng timing audio thật.
- Lưu từng lần sinh vào workspace bất biến riêng của project để bản mới không
  ghi đè code scene đã có.
- Kết nối ElevenLabs bằng API key chỉ lưu ở backend và xác minh live qua
  subscription cùng model catalog trước khi báo đã xác thực.
- Đọc voice/model động từ tài khoản ElevenLabs, tìm theo tên hoặc voice ID và
  gợi lại cấu hình của những generation đã tạo thành công trong PAD Studio.
- Có thể đọc thêm cấu hình từng dùng trên web ElevenLabs khi API key được cấp
  `History → Read`; thiếu quyền này không chặn tạo voice.
- Viết narration như một bài nói liên tục xuyên section, có word budget theo
  preset thời lượng và không mở bài/kết bài lại ở mỗi ranh giới.
- Tạo TTS thật cho toàn bộ narration trong một request khi nằm trong giới hạn
  model. Bài dài được chia thành số continuity group tối thiểu; model hỗ trợ sẽ
  nhận context và request ID trước đó. Eleven v3 không dùng Request Stitching
  vì capability này hiện không được API hỗ trợ.
- Lưu một master track `audio/narration.wav`, alignment toàn bài và timing
  global của từng section/beat vào generation bất biến để review.
- Phát master track trên UI; nút nghe section chỉ seek một khoảng trên cùng
  audio, nên việc review không tạo cảm giác các file rời.
- Ánh xạ timing thật của từng beat voice vào Motion Canvas time-event và biên
  dịch workspace đồng bộ mà không cắt/ghép lại audio theo section.
- Nhúng player chỉ-đọc để xem đúng animation và narration đã ghép chạy cùng
  nhau ngay trong bước đồng bộ; timeline chi tiết được thu gọn thành thông tin
  chẩn đoán phụ.
- Chỉ cho phép chốt bản đồng bộ sau khi player đã tải thành công và người dùng
  thực sự bấm phát generation hiện hành; đồng thời vẫn cung cấp lệnh mở preview
  độc lập khi cần kiểm tra sâu.
- Lưu mỗi lần đồng bộ vào
  `projects/<project-id>/sync/generations/<generation-id>/`; thay đổi scene hoặc
  voice nguồn tự động làm bản đồng bộ trở thành bản nháp cũ.
- Chạy Sync preview, Layout preview, `sync:serve` và validator Sync trên bản sao tạm
  copy-on-write; Motion Canvas có thể cập nhật `.meta` trong session nhưng không thể
  làm sai hash generation nguồn đã chốt.
- Chỉnh trực tiếp node Motion Canvas trong Layout Editor bằng kéo, scale, xoay, opacity,
  fill/stroke, thứ tự layer, khóa và thao tác delete có thể khôi phục. Editor có undo/redo,
  copy/paste modifier, grid, snap, safe-zone, so sánh bản gốc và preview sạch.
- Tự lưu modifier vào overlay bất biến tại
  `projects/<project-id>/layout/generations/<generation-id>/`, không sao chép hoặc sửa
  source/audio của bản Sync. Manifest node, fingerprint và source hash được khóa theo đúng
  generation trước khi backend nhận commit hoặc cho phép chốt. Sync manifest v1/v2 đều
  được re-hash; artifact lịch sử không còn khớp hash phải Đồng bộ và chốt lại trước khi
  mở Layout.
- Hiển thị lượng token của lần sinh gần nhất để người dùng theo dõi.
- Liệt kê, mở lại, chỉnh sửa và xóa project cục bộ.
- Giao diện responsive cho desktop và mobile.

Thời lượng định hướng hiện dùng ba mức:

- Ngắn gọn: 1–2 phút.
- Tiêu chuẩn: 3–5 phút.
- Chuyên sâu: 6–8 phút.

Project metadata và artifact generation được giữ cạnh project để có thể
version control nội dung từng video. Chỉ thư mục render sinh ra tại
`projects/**/renders/` bị ignore.

Mỗi project có hai chỉ số độc lập:

- `version` là phiên bản cấu trúc file; dữ liệu v1 đến v8 được đọc và nâng cấp
  lên cấu trúc v9 hiện tại ở lần ghi tiếp theo. Voice/sync section-based của v7
  được chủ động vô hiệu hóa để tạo lại bằng master narration, không giả vờ
  migrate audio cũ thành audio liên tục.
- `revision` tăng sau mỗi thay đổi nội dung và được dùng với `If-Match` để
  chặn hai thao tác ghi đè lẫn nhau.

Request tạo project mang `creationId` ổn định để retry sau lỗi mạng không tạo
thêm bản trùng. Các thao tác ghi trên cùng một project được thực hiện tuần tự và
dùng file tạm riêng trước khi thay thế `project.json`. Project có dữ liệu hỏng
hoặc phiên bản chưa hỗ trợ được báo trong thư viện thay vì bị ẩn im lặng.

PAD Studio kết nối tới `codex app-server` qua stdio. Trạng thái “đã kết nối”
chỉ được trả về sau khi Codex làm mới phiên đăng nhập, đọc được rate limit và
model catalog từ dịch vụ; việc chỉ tìm thấy file credential cục bộ là chưa đủ.
Credential tiếp tục do Codex CLI quản lý và không được đọc hoặc trả về frontend.
Codex CLI tự lưu và làm mới credential nên tải lại PAD Studio không yêu cầu đăng
nhập lại. Frontend chỉ cache loại tài khoản và gói dịch vụ (không cache token
hoặc email) để nhận diện phiên cũ trong lúc xác minh nền. Cache này chỉ bị xóa
khi Codex trả về trạng thái đã đăng xuất; lỗi mạng hoặc lỗi CLI chỉ yêu cầu kiểm
tra lại.

Mạch giảng được sinh qua một thread Codex tạm thời với structured output và
sandbox chỉ đọc. PAD Studio dùng một prompt ngắn có version, không gửi lại mạch
cũ khi tạo mới, chỉ gửi khi người dùng yêu cầu AI chỉnh theo góp ý và không tự
retry làm tăng chi phí. Mỗi request có `generationId` để retry lỗi mạng không
gọi AI hai lần. Kết quả AI luôn là bản nháp; người dùng phải review và chốt
trước khi sang voice–visual.

Kế hoạch voice–visual dùng cùng cơ chế an toàn nhưng có prompt và schema riêng.
Mỗi section của mạch giảng được giữ nguyên ranh giới và chia thành các beat ngắn.
Outline phân bổ tổng thời lượng cố định theo preset: ngắn gọn 90 giây, tiêu
chuẩn 240 giây và chuyên sâu 420 giây. Từ ngân sách đó, PAD Studio tính word
budget với tốc độ mục tiêu 180 đơn vị trắng/phút; AI chỉ viết nội dung, còn
duration của beat được tính bằng mô hình kết hợp số từ và số ký tự. Mặc định hệ
thống dùng 195 đơn vị/phút và 14,5 ký tự/giây; sau khi có voice thật, median của
các generation cùng voice/model/speed được dùng làm timing calibration cho kế
hoạch mới. Người dùng chỉ có thể thêm `visualHoldSeconds` khi visual cần giữ lâu
hơn lời nói. Nếu đầu vào hoặc mạch giảng thay đổi, kế hoạch downstream được đánh
dấu cũ và phải tạo lại trước khi có thể chốt.

Scene Motion Canvas chỉ được sinh từ mạch giảng và kế hoạch voice–visual đã chốt,
qua structured output có schema riêng. Source bị giới hạn trong các package
Motion Canvas, không được dùng network, filesystem hoặc runtime API ngoài phạm
vi. Mỗi section được sinh bằng một Codex turn riêng và chạy song song có giới
hạn. Pipeline dùng model mặc định do Codex catalog công bố, chọn reasoning
`medium` cho lượt dựng đầy đủ và tự lùi về capability/default hợp lệ nếu catalog
hoặc model thay đổi; không hard-code một họ model cụ thể. Scene đã sinh thành công
được cache theo `generationId`, kể cả khi một scene timeout hoặc vòng sửa chưa
hoàn tất; retry chỉ chạy lại scene lỗi. Lỗi TypeScript
được gửi về một vòng sửa có định hướng cho đúng file lỗi, tối đa hai lần, thay
vì sinh lại toàn bộ video. Mỗi generation chỉ được lưu tại
`projects/<project-id>/motion-canvas/generations/<generation-id>/`; project chỉ
giữ metadata và con trỏ đến generation hiện hành sau khi toàn bộ scene biên dịch
thành công. Khi dữ liệu upstream đổi, bộ
scene được đánh dấu cũ và không thể chốt cho đến khi sinh lại.

Scene generation mới bắt buộc giữ đúng hai Motion Canvas time-event cho mỗi
beat và dùng `useDuration` thay vì hard-code ranh giới beat. Workspace đồng thời
ghi file `.meta` với timing dự kiến nên scene vẫn chạy độc lập trước khi có
audio. Workspace cũ không có contract này vẫn được mở và dùng để tạo voice,
nhưng UI đánh dấu `Legacy · cần sinh lại trước sync`; bước đồng bộ sau có thể
phân biệt rõ thay vì âm thầm đoán timing.

Mỗi beat đăng ký mốc đầu bằng `waitUntil(start)` và mốc cuối bằng
`useDuration(end)` đúng một lần. Không gọi thêm `waitUntil(end)`, vì API này cũng
đăng ký time-event và sẽ tạo duplicate event trong Motion Canvas. Sau visual,
scene dùng `waitFor` với phần thời gian còn lại tới `beatEndTime`, để playhead
luôn chạm đúng mốc end kể cả animation ngắn hơn beat. Generator bắt buộc mọi
visual node có semantic key tường minh, duy nhất; đồng thời từ chối node sinh qua
map/loop hoặc constructor `new`. Workspace Sync giữ nguyên semantic key hợp lệ và
chỉ thêm prefix ổn định cho key legacy/dynamic, đồng thời chuẩn hóa duplicate
`waitUntil(end)` và phần bù cuối beat của những generation timing v1 đời đầu khi
sao chép. Source bất biến không bị sửa và voice không phải tạo lại.

Voice là nhánh downstream độc lập với code Motion Canvas: đổi lời đọc làm voice
và scene trở thành cũ, nhưng chỉ chỉnh animation không buộc tạo lại audio.
PAD Studio ghép toàn bộ beat và section thành một nguồn narration chính xác rồi
gọi `POST /v1/text-to-speech/:voice_id/with-timestamps`, mặc định
`mp3_44100_128`; `eleven_v3` là lựa chọn mặc định ưu tiên chất lượng biểu cảm.
Nếu narration vượt giới hạn model, hệ thống chia tại ranh giới beat/section an
toàn với số chunk tối thiểu và gọi tuần tự. PAD Studio chỉ gửi `style`, Speaker
Boost và Request Stitching khi model công bố hỗ trợ. Audio chunk chỉ là artifact
chẩn đoán; FFmpeg trim theo alignment rồi tạo một master WAV 48 kHz stereo.
Alignment được hợp nhất thành chỉ số ký tự và thời gian global, sau đó ánh xạ
lại section/beat theo UUID.
Request có `generationId` để retry cùng thao tác không tiêu credit lần hai trong
vòng đời server; chỉ generation hoàn tất mới được trỏ từ `project.json` và xuất
hiện trong danh sách “Đã dùng thành công”. `characterCost` trong manifest là
header do request ElevenLabs trả về; tổng quota trên card subscription vẫn là
nguồn chính xác cho credit cấp tài khoản.

Bước đồng bộ không gọi AI hoặc ElevenLabs lần nữa. Backend dùng alignment đã lưu
để thay `targetTime` của các event `beat:<beat-id>:start/end`, sao chép scene vào
workspace bất biến riêng và chuẩn hóa master voice một lần thành
`audio/narration.wav` 48 kHz stereo. Không còn điểm concat tại ranh giới section.
Workspace chỉ được ghi nhận sau khi TypeScript biên dịch thành công và thời
lượng WAV khớp tổng timing voice trong sai số tối đa một frame.

Khi mở bước 06, backend khởi động một Motion Canvas player chỉ-đọc trên loopback
cho generation hiện hành. Player phát trực tiếp scene đã đồng bộ cùng
`audio/narration.wav`, có play/pause, tua, mute và toàn màn hình. PAD Studio xác
minh đúng origin, iframe và generation trước khi nhận trạng thái “đã tải/đã
phát”; vì vậy preview cũ không thể vô tình mở khóa nút chốt của generation mới.
Preview là runtime tạm thời, không sửa file `.meta` hay source trong workspace.

Project cũ vẫn mở được, nhưng generation Motion Canvas chưa có
`timingContractVersion: 1` phải được sinh lại trước khi đồng bộ. PAD Studio không
đoán timing từ source legacy vì có thể làm animation chạy sai ý.

## Chạy ở môi trường phát triển

Yêu cầu Node.js 24.12 trở lên, Codex CLI và FFmpeg có trong `PATH`.
Nếu FFmpeg không nằm trong `PATH`, cấu hình đường dẫn executable bằng
`FFMPEG_PATH` trong `.env`.

```bash
npm install
npm run dev
```

Frontend chạy tại `http://127.0.0.1:5173`, backend chạy tại
`http://127.0.0.1:4174`. Cả hai cổng đều chạy ở chế độ strict: nếu cổng đang bị
chiếm, lệnh dev báo lỗi rõ ràng thay vì âm thầm đổi port. Khi một tiến trình con
thoát hoặc nhận `Ctrl+C`, dev runner chờ dừng toàn bộ cây backend/frontend; backend
cũng đóng các keep-alive connection còn giữ cổng. Chỉ đặt `PORT` khi chủ động
muốn chạy một instance khác.

### Kết nối ElevenLabs

ElevenLabs cho phép dùng API trên cả gói Free, vì vậy chưa cần mua gói trả phí
để thử kết nối và tạo voice trong hạn mức còn lại. Tạo API key tại
[`Developers → API Keys`](https://elevenlabs.io/app/settings/api-keys), bật
các quyền tối thiểu sau:

- `Text to Speech → Access`
- `Models → Access`
- `Voices → Read`
- `User → Read`

`History → Read` là tùy chọn, chỉ cần khi muốn gợi lại voice/model đã dùng trên
web ElevenLabs. Không cần `History → Write` hoặc `Voices → Write` cho pipeline
hiện tại. Trên gói Free, các voice premade vẫn tạo TTS qua API, nhưng Voice
Library có thể vẫn xuất hiện trong tài khoản/catalog rồi bị từ chối bằng lỗi
`paid_plan_required` khi tạo audio. PAD Studio đánh dấu trước các voice này và
chuyển lỗi 402 thành thông báo cần nâng gói, thay vì báo chung là mất kết nối.

Sau đó tạo file `.env` từ file mẫu:

```bash
cp .env.example .env
```

Trên PowerShell có thể dùng:

```powershell
Copy-Item .env.example .env
```

Nếu terminal đang là Command Prompt (`D:\project\PADStudio>`), dùng:

```bat
copy .env.example .env
```

Điền key vào biến sau và khởi động lại PAD Studio:

```dotenv
ELEVENLABS_API_KEY=your_api_key_here
```

API key chỉ được đọc ở backend và không được trả về frontend. Card ElevenLabs
gọi thật `GET /v1/user/subscription` và `GET /v1/models`;
chỉ khi cả subscription hợp lệ và model catalog có Text to Speech thì trạng
thái mới là “đã xác thực”. Hai request kiểm tra này không tạo audio và không
tiêu credits. Có thể kiểm tra response nội bộ tại:

```text
GET /api/integrations/elevenlabs/status
```

Kiểm tra danh mục voice/model và khả năng đọc lịch sử:

```text
GET /api/integrations/elevenlabs/catalog
GET /api/integrations/elevenlabs/catalog?search=<tên-hoặc-voice-id>
```

Sau khi chốt Motion Canvas, mở bước 05 trên UI, chọn voice/model, nghe preview
nếu voice có `preview_url`, chỉnh settings rồi bấm **Tạo voice thật**. Preview
có sẵn không tiêu credit; thao tác tạo voice gọi TTS thật và có tiêu hạn mức.
Kết quả được lưu tại:

```text
projects/<project-id>/voice/generations/<generation-id>/
├── audio/narration.wav
├── alignments/narration.json
├── chunks/
│   ├── audio/
│   └── alignments/
└── manifest.json
```

Sau khi đã sinh scene cho một project, mở Motion Canvas editor bằng:

```bash
npm run motion:serve -- --project <project-id>
```

Kiểm tra runtime trên chính workspace đã sinh bằng:

```bash
npm run validate:motion -- --project <project-id>
```

Sau khi tạo bản đồng bộ ở bước 06, mở workspace có narration và timing thật bằng:

```bash
npm run sync:serve -- --project <project-id>
```

Kiểm tra runtime trực tiếp trên workspace đồng bộ bằng:

```bash
npm run validate:motion -- --project <project-id> --stage sync
```

Để smoke-test cả player trong Chromium/Chrome headless:

```bash
npm run validate:sync -- --browser "<đường-dẫn-tới-chrome-hoặc-chromium>"
```

Mặc định bước Motion Canvas dùng model mặc định trong Codex catalog và reasoning
`medium`. Deployment có thể yêu cầu model hoặc effort cụ thể bằng
`PAD_MOTION_CANVAS_MODEL` và `PAD_MOTION_CANVAS_REASONING_EFFORT`; generator sẽ
đối chiếu capability trước khi gửi request, nên không truyền effort mà model
không hỗ trợ.

## Kiểm tra và chạy production

```bash
npm run validate
npm run build
npm start
```

`npm run validate` kiểm tra schema/API/UI, build PAD Studio, ghép một track sync
mẫu bằng FFmpeg và khởi động runtime Motion Canvas tạm để transform cả workspace
scene lẫn workspace đồng bộ có narration. Tham số `--project` ở trên dùng cùng
phép kiểm tra đó cho workspace thật.

Để kiểm tra credential và kết nối thật mà chưa tạo nội dung:

```bash
npm run smoke:live
```

Chỉ khi chủ động chấp nhận tiêu quota, chạy thêm cờ sau. Script tạo một outline
ngắn qua đúng production path và một câu TTS ngắn trong bộ nhớ; lượng token
Codex phụ thuộc model mặc định hiện hành và có thể lên tới vài nghìn. Script
không ghi credential hay audio thử vào repository:

```bash
npm run smoke:live -- --allow-credits
```

## CI và chính sách lưu media

GitHub Actions chạy trên Node.js 24 cho mọi pull request và mỗi lần push vào
`main`. Pipeline dùng Ubuntu 24.04, cài FFmpeg tường minh, cài đúng dependency
từ lockfile, kiểm tra chính sách media, chạy toàn bộ `npm run validate`,
smoke-test sync player bằng Chrome headless và xác nhận các bước kiểm tra không
làm bẩn worktree. CI dùng workspace/audio tổng hợp, không gọi Codex hoặc
ElevenLabs và không tiêu token hay credit.

Các file audio `.wav`, `.mp3`, `.pcm` và `.opus` mới phải được lưu bằng Git
LFS. Cài Git LFS một lần trên máy phát triển trước khi stage generation có
audio:

```bash
git lfs install
git add projects/<project-id>/
node scripts/check-media-policy.mjs
```

Mười file audio đã có từ trước vẫn là Git blob thông thường và được khai báo
ngoại lệ theo đúng đường dẫn trong `.gitattributes`. Cách làm forward-only này
không renormalize binary hiện tại và không rewrite lịch sử. Nếu cần chuyển phần
legacy sang LFS, hãy thực hiện trong một thay đổi migration riêng sau khi đã
thống nhất tác động tới clone hiện có và quota LFS.

Sau khi build, backend phục vụ cả API và frontend tại
`http://127.0.0.1:4174`.
