# PAD Studio — Project Context

Tài liệu này lưu bối cảnh và định hướng lâu dài của PAD Studio. Agent nên đọc tài liệu này trước khi đề xuất kiến trúc, triển khai tính năng hoặc tạo nội dung cho project.

## PAD Studio là gì?

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ bán tự động quá trình sản xuất video giảng giải trực quan bằng animation.

Project hướng đến việc kết hợp khả năng lập kế hoạch của AI, scene được tạo bằng code, voice tổng hợp và công cụ chỉnh sửa trực quan. Người dùng giữ quyền review và điều chỉnh ở các bước quan trọng.

PAD Studio không phải công cụ tạo video hoàn toàn tự động từ một prompt. Đây là một studio có AI hỗ trợ, trong đó chất lượng giảng giải và độ chính xác vẫn do người dùng kiểm soát.

## Trọng tâm nội dung

Giai đoạn đầu tập trung vào:

- Thuật toán và cấu trúc dữ liệu.
- Người mới học hoặc chưa có mô hình tư duy rõ về chủ đề.
- Video giải thích bản chất bằng hình ảnh logic và trực quan.

Video không hiển thị source code và không phụ thuộc vào caption để truyền đạt nội dung chính. Voice và animation là hai phương tiện giải thích trung tâm.

## Nguyên tắc giảng giải

- Giải thích bản chất và trực giác trước khi đi vào chi tiết.
- Mỗi hình ảnh phải có vai trò truyền đạt thông tin, không chỉ để trang trí.
- Chia kiến thức thành các bước vừa đủ để người mới có thể theo dõi.
- Voice nói đến đâu, visual cần hỗ trợ đúng ý ở thời điểm đó.
- Tránh đưa quá nhiều đối tượng, chuyển động hoặc ý tưởng lên màn hình cùng lúc.
- Ưu tiên sự rõ ràng và chính xác hơn hiệu ứng phức tạp.
- AI tạo đề xuất; người dùng review và quyết định nội dung cuối cùng.

## Quy trình sản xuất định hướng

```text
Nhập chủ đề
→ AI phân tích và tạo mạch giảng
→ Người dùng review nội dung
→ AI tạo kế hoạch voice–visual
→ Người dùng review kịch bản
→ Codex sinh scene Motion Canvas
→ Người dùng review scene
→ ElevenLabs tạo voice
→ Đồng bộ animation theo voice
→ Render bản nháp
→ Người dùng chỉnh bằng Layout Editor
→ Render video cuối
→ Lưu tài nguyên tốt vào kho tham khảo
```

Quy trình có thể được điều chỉnh trong quá trình phát triển, nhưng cần giữ các điểm review trước những bước tốn chi phí hoặc khó sửa.

## Mạch giảng và kế hoạch voice–visual

Hai lớp kế hoạch cần được phân biệt:

- **Mạch giảng** xác định nội dung cần giải thích, thứ tự các ý và mô hình tư duy muốn xây dựng cho người xem.
- **Kế hoạch voice–visual** xác định lời thuyết minh, hình ảnh tương ứng, hành động animation và timing của từng ý.

Một hình ảnh đẹp nhưng không hỗ trợ đúng mạch giảng không được xem là kết quả tốt. Tương tự, voice đúng nội dung nhưng không có visual đồng bộ cũng chưa đạt mục tiêu của PAD Studio.

Triển khai đầu tiên dùng `codex app-server` để đọc toàn bộ đầu vào, tạo bản tóm
tắt cách AI hiểu yêu cầu và đề xuất mạch giảng có cấu trúc. Nội dung người dùng
nhập luôn được giữ nguyên; kết quả AI là bản nháp riêng, có thể chỉnh tay hoặc
yêu cầu AI làm lại và chỉ trở thành đầu vào cho voice–visual sau khi người dùng
chốt. Provider cụ thể có thể thay đổi về sau mà không làm thay đổi ranh giới
review này.

Bước voice–visual hiện chia từng ý đã chốt thành các beat có bốn phần: lời
thuyết minh, visual cần thấy, chuyển động và thời lượng. Lời đọc phải được viết
như một bài nói xuyên suốt: section sau tiếp tục nhịp và ý của section trước,
không chào lại, không mở bài hoặc kết luận nhỏ lặp lại. Thứ tự section tiếp tục
theo mạch giảng; người dùng chỉ sắp xếp beat bên trong từng section để không vô
tình thay đổi logic giảng giải.

Thời lượng video được dẫn dắt bởi narration, không bởi độ dài animation mà AI
tự đoán. Outline phân bổ ngân sách thời lượng tổng theo preset, rồi chuyển thành
word budget cho từng section. AI viết nội dung trong ngân sách đó; PAD Studio
tính duration beat từ số từ và số ký tự, cộng thêm `visualHoldSeconds` do người
dùng chủ động đặt. Khi đã có voice thật, tốc độ đọc đo từ alignment của cùng
voice/model/speed được dùng để hiệu chỉnh những kế hoạch mới. Timing bắt đầu
được tính nối tiếp từ duration, không lưu hai loại mốc có thể mâu thuẫn. AI tạo
bản nháp có cấu trúc, còn người dùng chỉnh sửa và chốt trước khi hệ thống sinh
scene hoặc gọi dịch vụ voice.

Hiện tại Codex sinh một scene cho mỗi section từ kế hoạch đã chốt. Các section
được tách thành những Codex turn độc lập và chạy song song có giới hạn. Pipeline
theo model mặc định của Codex catalog, chọn mức reasoning chất lượng cao khi
capability cho phép (`medium` cho lượt dựng đầy đủ) và tự lùi về default hợp lệ
thay vì phụ thuộc tên model.
Kết quả được giới hạn bằng structured output và chính sách source, sau đó phải
biên dịch TypeScript thành công trước khi trở thành bản nháp có thể review.
Retry giữ lại scene đã thành công; compiler chỉ gửi file lỗi qua tối đa hai vòng
sửa có định hướng. Mỗi lần sinh được lưu thành workspace bất biến riêng trong
project; thay đổi mạch giảng hoặc kế hoạch voice–visual làm scene downstream
trở thành dữ liệu cũ và buộc sinh lại. Người dùng vẫn là người chốt scene trước
bước sản xuất tiếp theo.

## Master narration

Voice là một track toàn bài, không phải tập hợp file section. PAD Studio ghép
nguyên văn toàn bộ beat bằng các ranh giới xuống dòng ổn định và ưu tiên gửi
trong một request ElevenLabs để cùng một lần suy diễn quyết định voice,
prosody và nhịp đọc từ đầu đến cuối. Nếu giới hạn ký tự của model bắt buộc phải
chia, hệ thống chọn số continuity group tối thiểu tại ranh giới beat/section an
toàn; model có capability phù hợp nhận context và request ID trước đó.

Các chunk thô và alignment gốc vẫn được giữ trong generation bất biến để chẩn
đoán. FFmpeg trim từng chunk theo alignment rồi tạo
`voice/.../audio/narration.wav`; alignment toàn bài lưu chỉ số ký tự và thời
gian global của section/beat. UI chỉ có một master player. Thao tác “nghe
section” seek một khoảng trên cùng track, không phát một file TTS độc lập.

Narration có `narrationRevision` riêng. Chỉnh lời hoặc cấu trúc beat làm voice
trở thành cũ; chỉ chỉnh visual/animation giữ nguyên narration revision và không
buộc tiêu credit để tạo lại audio. Project schema v7 dùng audio theo section
được nâng lên v8 bằng cách giữ nội dung nhưng yêu cầu tạo lại voice/sync, vì
không thể biến các lần suy diễn cũ thành một giọng liên tục một cách trung thực.

## Đồng bộ animation theo voice

Bước đồng bộ hiện hành là một phép biến đổi cục bộ, xác định và không gọi thêm
AI hoặc ElevenLabs. Đầu vào bắt buộc là Motion Canvas và voice cùng tham chiếu
kế hoạch voice–visual hiện hành, đều đã được người dùng chốt. Mỗi scene mới có
timing contract v1 với đúng cặp event `beat:<beat-id>:start/end`; alignment voice
thật thay các mốc dự kiến trong file `.meta`, còn source scene tiếp tục lấy thời
lượng bằng `useDuration`.

Trong source, mốc start được đăng ký bởi `waitUntil(start)` và mốc end bởi
`useDuration(end)`; không đăng ký lại end bằng `waitUntil`. Scene lưu
`beatEndTime` và chờ phần thời gian còn lại sau visual, bảo đảm duration runtime
khớp narration trong sai số một frame. JSX key sinh từ mảng phải có prefix tĩnh
riêng. Khi đồng bộ generation timing v1 đời đầu, workspace sync chuẩn hóa các lỗi
tương thích này trên bản sao để player không gặp duplicate event/node key hoặc
kết thúc beat sớm, còn source Motion Canvas gốc vẫn bất biến.

Mỗi generation đồng bộ được lưu bất biến tại
`projects/<project-id>/sync/generations/<generation-id>/`. Workspace chứa bản
sao scene, metadata timing thật, bản chuẩn hóa của master track tại
`audio/narration.wav` và `project.ts` đã gắn audio. Sync không ghép lại theo
section và không gọi AI/ElevenLabs. Trước khi được đưa ra review, workspace phải
biên dịch TypeScript thành công và thời lượng audio phải khớp tổng timing voice
trong sai số tối đa một frame. Scene và voice nguồn không bị sửa hoặc ghi đè.

Review đồng bộ lấy player animation + narration làm bề mặt chính, không lấy
timeline làm đại diện cho trải nghiệm video. Backend dựng một Motion Canvas
player chỉ-đọc, cục bộ và tạm thời cho đúng generation; UI nhúng player này để
play/pause, tua, mute và xem toàn màn hình. Timeline section/beat vẫn còn nhưng
được thu gọn dưới dạng dữ liệu chẩn đoán. Nút chốt chỉ mở sau khi đúng iframe,
origin và generation báo render sẵn sàng, rồi người dùng thực sự bấm phát. Player
không có editor plugin nên không thể ghi ngược vào workspace bất biến.

Bundle đồng bộ lưu revision của cả hai nguồn cùng mapping section/scene/beat.
Nếu scene, event hoặc timing voice thay đổi, bundle tự trở thành draft cũ và
không thể chốt cho đến khi đồng bộ lại. Workspace legacy chưa có timing contract
v1 phải sinh lại Motion Canvas; hệ thống không suy đoán timing từ code cũ.

## Scene và component

Mỗi video có scene và component riêng để có thể tùy biến theo cách giải thích của chủ đề đó. Không nên ép mọi video phụ thuộc vào một thư viện component dùng chung quá sớm.

Code scene đã sinh nằm trong
`projects/<project-id>/motion-canvas/generations/<generation-id>/`, tách khỏi
code của Studio nhưng vẫn thuộc project và được quản lý cùng metadata video.

Những scene, component, animation pattern hoặc asset đã hoạt động tốt sẽ được lưu vào kho tham khảo. Khi làm video mới, chúng được sao chép và điều chỉnh theo ngữ cảnh thay vì mặc định trở thành dependency dùng chung.

Chỉ nên chuẩn hóa thành thành phần dùng chung khi pattern đã được kiểm chứng qua nhiều video và ranh giới tái sử dụng thực sự rõ ràng.

## Layout Editor

Layout Editor cho phép người dùng chỉnh trực tiếp những phần thường cần tinh chỉnh sau khi scene được sinh:

- Vị trí và kích thước.
- Thuộc tính hiển thị.
- Bố cục các đối tượng.
- Timing và các mốc đồng bộ.

Editor bổ sung cho code chứ không thay thế hoàn toàn code. Codex vẫn hỗ trợ sinh và sửa logic scene; người dùng dùng editor để thực hiện các điều chỉnh trực quan và timing một cách nhanh chóng.

## Vai trò của các thành phần

- **AI**: phân tích chủ đề, đề xuất mạch giảng và lập kế hoạch voice–visual.
- **Người dùng**: review nội dung, quyết định cách giảng, chỉnh layout và timing.
- **Codex**: cung cấp model cho mạch giảng, kế hoạch voice–visual và sinh code
  scene Motion Canvas qua app-server; tiếp tục hỗ trợ sửa scene, triển khai và
  bảo trì project.
- **Motion Canvas**: nền tảng tạo animation bằng code.
- **ElevenLabs**: tạo voice phục vụ video.
- **PAD Studio**: kết nối các bước trên thành một quy trình sản xuất nhất quán.

Các dịch vụ hoặc công nghệ cụ thể có thể thay đổi. Vai trò và ranh giới trách nhiệm quan trọng hơn tên công cụ.

## Nguyên tắc phát triển

- Giữ giải pháp gọn và dễ hiểu.
- Xây theo nhu cầu thực tế của pipeline, tránh tổng quát hóa quá sớm.
- Ưu tiên hoàn thiện một luồng sản xuất xuyên suốt trước khi mở rộng.
- Tách nội dung, voice, visual, layout và timing đủ rõ để có thể chỉnh độc lập.
- Không để thay đổi của video mới vô tình làm hỏng video đã hoàn thiện.
- Những quyết định ảnh hưởng đến workflow hoặc chất lượng giảng giải cần được người dùng review.
- Cấu trúc kỹ thuật phải phục vụ việc sản xuất video, không trở thành mục tiêu tự thân.

Các ranh giới kỹ thuật đang bảo vệ những nguyên tắc trên:

- API cập nhật project tổng quát chỉ được sửa đầu vào chủ đề và quay về bước
  outline. Mọi artifact downstream phải đi qua endpoint chuyên biệt có kiểm tra
  revision, nguồn hiện hành và review gate; không mở rộng generic update để
  triển khai nhanh một bước mới.
- Trạng thái `ready`/`stale` và phép đối chiếu section/beat/event dùng predicate
  chung ở `src/shared/projectPipeline.ts`. Backend bổ sung kiểm tra hash narration
  khi quyết định voice có còn đúng nguồn hay không.
- JSON request bị giới hạn ở 1 MiB và tiếp tục phải qua schema strict. Mức này
  đủ cho kế hoạch voice–visual tối đa hiện tại nhưng vẫn chặn payload bất thường.
- `npm run validate` là quality gate cục bộ chuẩn. CI chạy cùng gate trên
  Node.js 24 và smoke-test player bằng trình duyệt headless, không gọi dịch vụ
  live hoặc tiêu quota.
- Audio `.wav`/`.mp3`/`.pcm`/`.opus` mới được lưu bằng Git LFS. Mười file audio
  legacy đã pin blob theo chính sách forward-only; chỉ migration riêng mới được
  thay đổi lịch sử hoặc chuyển các blob cũ.

## Cách agent sử dụng tài liệu này

Khi làm việc với PAD Studio, agent cần:

1. Dùng tài liệu này làm bối cảnh chung trước khi đưa ra đề xuất.
2. Ưu tiên mục tiêu giảng giải trực quan và đồng bộ voice–visual.
3. Không mặc định tự động hóa hoàn toàn các bước cần con người đánh giá.
4. Không thiết kế hệ thống phức tạp hơn nhu cầu hiện tại nếu chưa có lý do rõ ràng.
5. Phân biệt code của Studio với scene, component và tài nguyên thuộc từng video.
6. Hỏi hoặc nêu rõ giả định khi một quyết định có thể làm thay đổi định hướng sản phẩm.
