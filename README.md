# PAD Studio

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ sản xuất video giảng giải trực quan bằng animation.

Ứng dụng hướng đến việc giải thích thuật toán và cấu trúc dữ liệu cho người mới học bằng hình ảnh logic, dễ hiểu và đồng bộ chính xác với lời thuyết minh. Video tập trung vào bản chất của kiến thức, không hiển thị code và không phụ thuộc vào caption.

## Quy trình chính

```text
Nhập chủ đề
→ Tạo và review mạch giảng
→ Tạo và review kế hoạch voice–visual
→ Sinh, tự xem trước và chỉnh scene Motion Canvas
→ Sinh voice
→ Đồng bộ animation
→ Chỉnh sửa bằng Layout Editor
→ Chọn tốc độ/watermark và render video cuối
```

Người dùng có thể chỉnh vị trí, kích thước và thuộc tính hiển thị trực tiếp trên giao
diện; timing đã đồng bộ được giữ chỉ đọc trong Layout Editor. Bản Layout đã chốt được
dựng thành MP4 H.264/AAC, kiểm tra lại bằng FFprobe và lưu bất biến theo generation.

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
- Chỉnh sửa, sắp xếp và chốt mạch giảng trước bước voice–visual. Khi đã có
  outline, AI không còn ghi đè trực tiếp: người dùng chọn đúng section/trường
  được phép sửa, review candidate và diff rồi mới áp dụng.
- Lưu lịch sử outline bất biến, tạo checkpoint thủ công hoặc tự động trước lượt
  AI, so sánh phiên bản và khôi phục theo kiểu copy-forward nên phiên bản cũ
  không bao giờ bị sửa lại.
- Mỗi candidate được kiểm tra mạch lạc trên toàn bản đã ghép. AI được đọc toàn
  outline nhưng backend chỉ chấp nhận patch trong phạm vi đã chọn; nếu cần đụng
  phần được bảo vệ, candidate bị giữ ở trạng thái cần mở rộng phạm vi. UI có thể
  lấy đúng section/beat/scene reviewer chỉ ra, điền sẵn hướng khắc phục và chỉnh
  tiếp trên candidate hiện tại thay vì sinh lại từ bản gốc.
- Tạo kế hoạch voice–visual theo từng ý đã chốt, gồm lời thuyết minh, visual,
  chuyển động và thời lượng của từng beat; thời lượng được PAD Studio tính từ
  chính lời đọc thay vì để AI ước lượng theo animation.
- Chỉnh sửa, sắp xếp beat và chốt kế hoạch trước khi sinh scene hoặc gọi dịch
  vụ tạo voice. Góp ý AI tạo candidate theo đúng field/beat được chọn; beat và
  narration ngoài phạm vi giữ nguyên, visual-only edit không làm voice bị stale.
- Sinh một scene Motion Canvas cho từng section đã chốt, kiểm tra quyền import
  và biên dịch TypeScript trước khi nhận kết quả. Scene lỗi được sửa một lượt theo
  diagnostics, sau đó sinh sạch từ đầu một lượt nếu cần; nếu Codex vẫn trả TSX hỏng,
  PAD Studio dựng scene an toàn tại chỗ cho riêng section đó thay vì bỏ dở toàn bộ
  generation.
- Tự khởi động preview ngay trên UI sau khi sinh scene và cho chỉnh visual trước
  khi tạo voice. Các modifier này tiếp tục được đưa vào Layout Editor sau sync.
- Xem source, chọn đúng scene cần sinh lại và chốt bộ scene trước khi sang bước
  tiếp theo. Candidate có workspace/preview riêng; scene không chọn được giữ
  nguyên source, `sceneId` và `filePath`. Reviewer chỉ đánh giá sau khi candidate
  đã compile/repair xong, nên kết luận luôn thuộc đúng source cuối sẽ được áp dụng.
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
  thời lượng mục tiêu và không mở bài/kết bài lại ở mỗi ranh giới.
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
- Render trực tiếp từng frame Motion Canvas vào FFmpeg, ghép với master narration và
  xuất MP4 dọc 1080×1920, 30 fps, H.264/AAC. Trước khi render có thể chọn tốc độ
  0,25×–4×, xem trước thời lượng dự kiến và thêm watermark chữ/PNG/JPEG/WebP với
  opacity, vị trí, kích thước tùy chỉnh. Audio đổi tốc độ nhưng giữ cao độ.
  Output được hash, kiểm tra codec, kích thước và thời lượng trước khi ghi vào
  `projects/<project-id>/renders/generations/`.
- Hiển thị lượng token của lần sinh gần nhất để người dùng theo dõi.
- Liệt kê, mở lại, chỉnh sửa và xóa project cục bộ.
- Giao diện responsive cho desktop và mobile.

Thời lượng định hướng có ba lựa chọn nhanh và một lựa chọn linh hoạt:

- Ngắn gọn: 1–2 phút.
- Tiêu chuẩn: 3–5 phút.
- Chuyên sâu: 6–8 phút.
- Tùy chỉnh: từ 0,5 đến 180 phút; đây là cầu chì kỹ thuật rộng, không phải preset
  nội dung. Outline dùng khoảng ±15% quanh mục tiêu để giữ nhịp kể tự nhiên.

Số section/beat cũng không còn là preset sản phẩm. AI và người dùng chọn cấu trúc
phù hợp nội dung; các mức 64 section, 64 beat/section và 512 beat toàn bài chỉ là
cầu chì chống payload hỏng hoặc vòng lặp ngoài ý muốn.

Project metadata và toàn bộ artifact generation được giữ trong
`projects/<project-id>/` trên máy người dùng. Đây là dữ liệu runtime có thể rất
lớn (source sinh tự động, audio, alignment, watermark, preview và video cuối),
vì vậy toàn bộ `projects/` bị ignore và không được đưa vào Git. Hãy sao lưu hoặc
di chuyển project cần lưu trữ bằng cơ chế riêng, không dùng repository mã nguồn.

Lịch sử mạch giảng, voice–visual và Motion Canvas nằm riêng tại
`projects/<project-id>/history/<stage>/{versions,candidates}/`, với `<stage>` là
`outline`, `voice-visual` hoặc `motion-canvas`. Mỗi record có `manifest.json` và
`artifact.json` bất biến, được ghi artifact trước rồi mới publish manifest;
quyết định accepted/rejected cũng là record write-once riêng. Candidate không
sửa `project.json`, không tăng `revision` và không làm stale downstream; chỉ
thao tác Apply/Restore mới tạo revision nội dung mới theo đúng review gate.

Mỗi project có hai chỉ số độc lập:

- `version` là phiên bản cấu trúc file; dữ liệu v1 đến v11 được đọc và nâng cấp
  lên cấu trúc v12 hiện tại ở lần ghi tiếp theo. Voice/sync section-based của v7
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
Credential tiếp tục do Codex app-server quản lý và không được đọc hoặc trả về
frontend. Người dùng có thể đăng nhập ChatGPT trên trình duyệt hoặc nhập Codex
API key hoàn toàn từ card kết nối trong UI; không cần đăng nhập trước ở terminal.
App-server tự lưu và làm mới credential nên tải lại PAD Studio không yêu cầu đăng
nhập lại. UI lấy model catalog thật từ app-server và cho chọn model cùng mức suy
luận dùng cho các lần sinh tiếp theo. Danh sách effort phụ thuộc capability của
từng model; lựa chọn được nhớ riêng theo model và tự trở về mặc định nếu catalog
không còn hỗ trợ mức cũ. Frontend chỉ cache loại tài khoản, gói dịch vụ, model và
effort đã chọn (không cache token hoặc email) để nhận diện phiên cũ trong lúc xác minh nền. Cache này chỉ bị xóa
khi Codex trả về trạng thái đã đăng xuất; lỗi mạng hoặc lỗi CLI chỉ yêu cầu kiểm
tra lại.

Mạch giảng ban đầu được sinh qua một thread Codex tạm thời với structured output
và sandbox chỉ đọc. Sau đó mọi lượt AI là candidate hai pha: editor đọc toàn bộ
ngữ cảnh nhưng chỉ trả patch theo stable section ID và field scope; backend áp
patch, validate toàn artifact và gọi một reviewer độc lập kiểm tra logic,
transition, thuật ngữ, lặp ý và pacing trên bản đã ghép. Phần ngoài scope được
giữ byte-for-byte ở cấp dữ liệu. Mỗi request có `generationId` để retry lỗi mạng
không gọi AI hai lần; candidate không tự trở thành bản hiện hành và có thể được
chỉnh tiếp theo chuỗi parent candidate trước khi người dùng bấm áp dụng.

Kế hoạch voice–visual dùng cùng cơ chế an toàn nhưng có prompt và schema riêng.
Mỗi section của mạch giảng được giữ nguyên ranh giới và chia thành các beat ngắn.
Outline phân bổ tổng thời lượng theo lựa chọn nhanh (90/240/420 giây) hoặc mục
tiêu phút do người dùng nhập. Từ ngân sách đó, PAD Studio tính word
budget với tốc độ mục tiêu 180 đơn vị trắng/phút; AI chỉ viết nội dung, còn
duration của beat được tính bằng mô hình kết hợp số từ và số ký tự. Mặc định hệ
thống dùng 195 đơn vị/phút và 14,5 ký tự/giây; sau khi có voice thật, median của
các generation cùng voice/model/speed được dùng làm timing calibration cho kế
hoạch mới. Người dùng chỉ có thể thêm `visualHoldSeconds` khi visual cần giữ lâu
hơn lời nói. Nếu đầu vào hoặc mạch giảng thay đổi, kế hoạch downstream được đánh
dấu cũ và phải tạo lại trước khi có thể chốt.

Sau khi kế hoạch đã tồn tại, endpoint sinh toàn bộ không được phép ghi đè bản
đang dùng. Editor AI đọc toàn bộ outline/kế hoạch nhưng chỉ trả patch theo stable
`beatId` và field scope; backend từ chối patch ngoài scope, chỉ tính lại duration
khi voiceover/visual hold đổi, rồi reviewer độc lập kiểm tra câu nối, thuật ngữ,
voice–visual alignment và ranh giới với beat được bảo vệ. Candidate có diff,
checkpoint, trạng thái accepted/rejected và khôi phục copy-forward. Kết luận của
reviewer ở bước này là tư vấn: cảnh báo mạnh hoặc đề nghị mở rộng phạm vi không
được quyền chặn một thao tác Apply có chủ ý của người dùng; chỉ lỗi cấu trúc hoặc
context nền đã thay đổi mới ngăn việc áp dụng. Người dùng cũng có thể chạy review
độc lập trên bản hiện tại hoặc candidate đang xem; thao tác này không tạo
candidate, không đổi revision và chỉ chuẩn bị beat/field cùng góp ý khi người dùng
chọn xử lý. Candidate con dùng candidate trước làm nền nhưng auto-scope không
mang lại các field vừa được sửa; chúng được giữ khóa cho tới khi người dùng tự
chọn cho phép sửa lại. UI hiển thị cả diff của lượt mới và diff tích lũy từ bản
đang dùng.

Scene Motion Canvas chỉ được sinh từ mạch giảng và kế hoạch voice–visual đã chốt,
qua structured output có schema riêng. Source bị giới hạn trong các package
Motion Canvas, không được dùng network, filesystem hoặc runtime API ngoài phạm
vi. Mỗi section được sinh bằng một Codex turn riêng và chạy song song có giới
hạn. Pipeline dùng model/effort người dùng chọn từ Codex catalog; khi chưa chọn
thì dùng mặc định do model công bố và không hard-code một họ model cụ thể. Nếu
capability thay đổi trước lúc chạy, backend từ chối rõ ràng để người dùng chọn
lại thay vì âm thầm hạ mức reasoning. Scene đã sinh thành công
được cache theo `generationId`, kể cả khi một scene timeout hoặc vòng sửa chưa
hoàn tất; retry chỉ chạy lại scene lỗi. Lỗi TypeScript
được gửi về đúng một vòng sửa có định hướng cho file lỗi. Nếu vẫn sai, hệ thống
sinh lại riêng scene đó từ context gốc thay vì tiếp tục chắp vá source; sau cùng,
một fallback local giữ đúng time-event của beat được dùng mà không tốn thêm token.
Mỗi generation chỉ được lưu tại
`projects/<project-id>/motion-canvas/generations/<generation-id>/`; project chỉ
giữ metadata và con trỏ đến generation hiện hành sau khi toàn bộ scene biên dịch
thành công. Khi dữ liệu upstream đổi, bộ
scene được đánh dấu cũ và không thể chốt cho đến khi sinh lại.

Khi workspace hiện hành còn khớp upstream, sinh lại trực tiếp bị khóa. Người
dùng chọn một hay nhiều scene để tạo candidate; generator chỉ gọi Codex cho các
section tương ứng, ghép source mới với source cũ nguyên byte, giữ stable
`sceneId`/`filePath`, review tính liên tục của toàn chuỗi và biên dịch vào một
workspace candidate bất biến. UI cho xem preview/source candidate trước Apply.
Version cũ vẫn trỏ tới workspace bất biến; Restore tạo một workspace generation
mới theo copy-forward, vì vậy có thể qua lại mà không sửa lịch sử.

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

Yêu cầu Node.js 24.12 trở lên, Codex CLI, FFmpeg/FFprobe và Chrome hoặc Edge.
Final render tự tìm Chrome/Edge ở các vị trí cài đặt phổ biến; có thể đặt
`PAD_RENDER_BROWSER_PATH` nếu browser nằm ở vị trí khác.
Nếu FFmpeg không nằm trong `PATH`, cấu hình đường dẫn executable bằng
`FFMPEG_PATH` trong `.env`.

```bash
npm install
npm run dev
```

Frontend chạy tại `http://127.0.0.1:5173`, backend chạy tại
`http://127.0.0.1:4174`. Cả hai cổng đều chạy ở chế độ strict: nếu cổng đang bị
chiếm, lệnh dev báo lỗi rõ ràng thay vì âm thầm đổi port. Backend và frontend chỉ
được tạo trong thời gian `npm run dev` đang chạy. Nhấn `Ctrl+C` hoặc đóng terminal
sẽ dừng cả hai; supervisor và từng tiến trình con cùng theo dõi lẫn nhau để không
để lại tiến trình nền giữ cổng nếu một lớp bị đóng bất thường. Backend vẫn tự khởi
động lại khi mã trong `src/backend` hoặc `src/shared` thay đổi. Chỉ đặt `PORT` và
`PAD_FRONTEND_PORT` khi chủ động muốn chạy một instance khác.

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

Khuyến nghị nhập key ngay trên card ElevenLabs trong UI. Backend gọi thật
subscription và model catalog trước khi lưu; nếu xác minh thất bại thì key cũ
vẫn được giữ nguyên. Trên Windows, key được mã hóa bằng DPAPI theo tài khoản hiện
tại và lưu ngoài project ở `.pad-studio/credentials.json`; frontend không bao giờ
nhận lại giá trị key. Người dùng có thể nhập hoặc thay key ngay cả khi đang kết
nối; key mới chỉ thay thế sau khi xác minh live thành công. Xóa key đã lưu trên
UI sẽ quay về dùng biến môi trường nếu có.

File `.env` vẫn được hỗ trợ như một cấu hình dự phòng cho môi trường phát triển:

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

Sau khi sinh scene, preview/editor tự mở ngay trong bước Motion Canvas trên UI.
Lệnh sau chỉ còn là công cụ dành cho việc chẩn đoán sâu của lập trình viên:

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

Mặc định các bước AI dùng model và reasoning mặc định trong Codex catalog; người
dùng có thể đổi cả hai ngay trên card Codex và lựa chọn được truyền vào từng
request. Card hiển thị khoảng thời gian tham khảo theo loại tác vụ, effort và số
batch scene; sau mỗi lần thành công, khoảng này tự hiệu chỉnh bằng lịch sử cục bộ
trên máy. Effort cao có timeout lớn hơn để không hủy sớm: từ 15 phút ở `low` tới
120 phút ở `ultra`. Deployment có thể yêu cầu model hoặc effort cụ thể bằng
`PAD_MOTION_CANVAS_MODEL` và `PAD_MOTION_CANVAS_REASONING_EFFORT`; generator sẽ
đối chiếu capability trước khi gửi request. `PAD_CODEX_GENERATION_TIMEOUT_MS`
chủ động thay thế cơ chế timeout thích ứng khi deployment cần một hard guard.
TTS mặc định có guard thích ứng 2–30 phút theo độ dài text; deployment có mạng
đặc thù có thể đặt `PAD_ELEVENLABS_GENERATION_TIMEOUT_MS`. POST TTS tốn phí không
bao giờ được tự gửi lại khi timeout hoặc mất kết nối khiến kết quả chưa rõ.

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

Chỉ khi chủ động chấp nhận tiêu token Codex, chạy cờ riêng sau. Script tạo một
outline ngắn qua đúng production path và không gọi ElevenLabs:

```bash
npm run smoke:live -- --allow-codex
```

Để chạy riêng production path hai lượt của scoped editor và coherence reviewer
trên một outline nhỏ (không ghi project), dùng cờ tường minh:

```bash
npm run smoke:live -- --allow-codex-revision
```

Hai scoped path Voice & Visual và Motion Canvas có cờ smoke riêng. Motion smoke
sinh lại đúng một scene rồi review toàn chuỗi hai scene:

```bash
npm run smoke:live -- --allow-codex-voice-visual-revision
npm run smoke:live -- --allow-codex-voice-visual-review
npm run smoke:live -- --allow-codex-motion-revision
```

Phép thử TTS được tách thành `--allow-elevenlabs` để không thể vô tình tiêu credit
khi chỉ kiểm tra Codex. Không dùng cờ này nếu tài khoản ElevenLabs đã hết hạn mức.
Script không ghi credential hay audio thử vào repository.

## CI và chính sách lưu media

GitHub Actions chạy trên Node.js 24 cho mọi pull request và mỗi lần push vào
`main`. Pipeline dùng Ubuntu 24.04, cài FFmpeg tường minh, cài đúng dependency
từ lockfile, kiểm tra chính sách media, chạy toàn bộ `npm run validate`,
smoke-test sync player bằng Chrome headless và xác nhận các bước kiểm tra không
làm bẩn worktree. CI dùng workspace/audio tổng hợp, không gọi Codex hoặc
ElevenLabs và không tiêu token hay credit.

Thư mục `projects/` là dữ liệu runtime cục bộ và không được stage. Kiểm tra chính
sách repository trước khi commit bằng:

```bash
node scripts/check-media-policy.mjs
```

Script sẽ báo lỗi nếu artifact trong `projects/` bị track trở lại. Quy tắc Git
LFS cho `.wav`, `.mp3`, `.pcm` và `.opus` vẫn được giữ như một hàng rào an toàn
cho media nào được chủ động đặt ngoài thư mục runtime và thực sự cần version
control.

Sau khi build, backend phục vụ cả API và frontend tại
`http://127.0.0.1:4174`.
