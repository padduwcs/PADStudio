# PADStudio — hướng dẫn cho người dùng

PADStudio là xưởng làm video chạy trên máy bạn. **Bạn trò chuyện với Agent ngay trong PADStudio**, xem video bên cạnh rồi yêu cầu chỉnh tiếp.
Chat tích hợp dùng Codex trên máy. Bạn vẫn có thể dùng một Agent bên ngoài (ví dụ Claude Code) trong thư mục PADStudio.

## 1. Chuẩn bị (làm một lần)

| Cần có | Ghi chú |
| --- | --- |
| Node.js 20 trở lên | Không cần cài thêm gói npm. |
| FFmpeg và ffprobe trong `PATH` | Nền tảng để ghép, cắt và xuất video. |
| Codex CLI, để dùng chat tích hợp | Dùng tài khoản Codex hiện có; nếu chưa có đăng nhập, khung chat hiện nút đăng nhập ChatGPT. |

Kiểm tra máy đã sẵn sàng chưa:

```powershell
npm run padstudio:doctor
npm run tool:list
```

Cách dễ nhất: mở trang xem (mục 2) và bấm **Công cụ** trên thanh đầu, hoặc mở thẳng **http://127.0.0.1:7603/?panel=tools**. Trang này
có ba tab:

- **Tổng quan:** công cụ nào đã sẵn sàng; chỉ những gì cần bạn mới được nói rõ (thiếu khóa, cần cài thêm) kèm nút đi thẳng tới chỗ xử lý;
- **Giọng đọc:** dán khóa API ElevenLabs, chọn model, tìm và nghe thử giọng, hoặc dán mã giọng bạn đã dùng;
- **Dịch vụ của bạn:** đánh dấu dịch vụ khác bạn có (tạo ảnh, video, nhạc bằng AI, kho ảnh trả phí, Canva…) kèm ghi chú, để Agent đề xuất cách làm
  hợp với những gì bạn có.

Muốn mở thẳng một tab: `?panel=tools&tab=voice` hoặc `?panel=tools&tab=services`.

Agent đọc cùng thông tin đó khi bắt đầu dự án. **Không dán khóa API vào cuộc trò chuyện**: Agent sẽ gửi bạn link trang Công cụ khi cần.
Trong terminal, `tool:list` cho cùng danh sách ở dạng kỹ thuật. Phần sau đều **tùy chọn**, Agent sẽ nói rõ khi một bước cần đến chúng:

- **Hiểu video/âm thanh có sẵn (cắt cảnh, phiên âm lời nói):** cần Python 3.12 và các model Whisper. Làm video từ đầu, không có
  tư liệu quay sẵn, thì không cần phần này; nhưng `padstudio:doctor` sẽ báo `attention` (kèm cách cài) cho đến khi bạn cài.
  Đó chỉ là lời nhắc, không chặn việc dựng. Cài một lần theo mục “Cài môi trường” của
  [`eval/source-understanding/README.md`](../eval/source-understanding/README.md): tạo `.runtime-tools/source-eval`, cài gói theo
  file khóa, rồi `npm run analysis:eval -- setup-model --model large-v3` (khoảng 5 GB cho hai model). Kiểm tra bằng
  `npm run analysis:doctor`.
- **Giọng đọc miễn phí trên máy (Piper):** điền `piper.pythonCommand`, `piper.modelDirectory`, `piper.defaultModel` trong
  `padstudio.local.json` (mẫu: `padstudio.local.example.json`).
- **Giọng đọc ElevenLabs (trả phí):** dán khóa ở tab **Giọng đọc**; khóa được lưu vào `padstudio.local.json`, không đưa lên Git và không
  hiện lại trên trang. Sau khi lưu khóa, cùng tab đó hiện thêm hai bước:
  - **Model:** chọn trong danh sách của chính tài khoản bạn (ví dụ Eleven v3). Model nào hỗ trợ tiếng Việt mới dùng được; model khác bị tắt.
  - **Giọng:** gõ tên để tìm trong các giọng của tài khoản, bấm ▶ nghe thử (miễn phí), bấm **Dùng giọng này** để chọn.
  - **Giọng bạn đã dùng trước đó:** mở dòng “Đã dùng một giọng trước đó?”, dán mã giọng (voice ID) rồi bấm **Tìm theo mã**. Giọng phải nằm trong My Voices của tài khoản;
    giọng ở Voice Library cần được thêm vào My Voices trước. Giọng tính credit theo hệ số riêng vẫn chọn được, nhưng số credit ước tính chỉ là mức tối thiểu (số thực tế ghi lại sau khi tạo), nên trần credit của dự án chỉ chặn được sau lần tạo vượt mức.
  Giọng và model bạn chọn là **mặc định Agent đề xuất**; Agent vẫn ghi rõ giọng và model trong mỗi lần tạo, tạo cả bài trong **một lần**
  (để giọng liền mạch), và chỉ tạo khi bạn đồng ý đúng văn bản đó. Agent chỉ tạo mẫu khi cần, và khi đó mẫu là đoạn dễ đọc sai nhất của bài
  thật. Mẫu nằm trong thư mục kết quả của dự án (tab Tư liệu chỉ hiện lời đọc mà video đang dùng).
- **Giữ credit ElevenLabs trong tầm tay:** chốt kịch bản trước khi tạo giọng (sửa chữ là tạo lại và tốn thêm); trước đó Agent soát những chỗ
  giọng có thể đọc sai (số, ký hiệu, chữ cái lẻ, từ viết tắt) và viết chúng thành lời. Ước tính credit của giọng có rate riêng chỉ là mức tối
  thiểu cho đến khi dự án có một lần tạo thật của giọng đó; sau đó nó được đo lại từ chi phí thực. Dựng lại video hay đổi hình
  không tạo lại giọng. Đặt trần cho từng dự án bằng `npm run project:credits -- <tên-dự-án> set 5000`, hoặc nhờ Agent đặt giúp: PADStudio
  từ chối mọi lần tạo vượt trần. Bạn cũng nên đặt giới hạn credit hằng tháng ngay ở tài khoản ElevenLabs.
- **Hoạt họa bằng code:** Manim, Remotion hoặc HyperFrames. Nếu máy chưa có, Agent sẽ báo và hướng dẫn thiết lập thay vì tự cài.

## 2. Mỗi lần bắt đầu

1. Mở PADStudio: chạy `npm run observer:ensure`, rồi vào **http://127.0.0.1:7603**.
2. Bấm **Trò chuyện** trên thanh đầu. Khung chat tự kết nối Codex; nếu cần, bấm **Đăng nhập ChatGPT** rồi mở trang đăng nhập được cung cấp.
3. Nhập prompt như khi mở Codex trong thư mục PADStudio ở VS Code. Bạn có thể yêu cầu tạo project mới, tiếp tục project cũ hoặc làm việc khác trong repo.

Khi chưa chọn project, PADStudio giữ màn hình chờ với **Trò chuyện với Codex** và **Mở dự án**, kể cả khi kho đã có project.
Agent có thể tạo hoặc quản lý các project từ nhiều cuộc trò chuyện; danh sách tự cập nhật nhưng không tự mở dự án nào.
Bấm logo để quay về màn hình chờ, chat đang mở vẫn được giữ. Link có `?project=<id>` mở thẳng dự án đó.
Chọn **VI / EN** trên thanh đầu để đổi ngôn ngữ giao diện. Trang tải lại, giữ tab chat/bản nháp và lượt đang chạy; không tự dịch nội dung hoặc đổi ngôn ngữ trả lời của Agent.

Trên máy tính, chat nằm cạnh video; kéo đường phân cách cạnh trái để đổi chiều rộng, nhấp đúp để đặt lại. Kích thước được nhớ cho lần mở sau.
Trên điện thoại, chat mở toàn màn hình và có nút đóng để quay lại video. Enter gửi tin, Shift + Enter xuống dòng.
Có thể gửi yêu cầu bổ sung khi Agent đang làm hoặc bấm nút dừng ■; dừng không hoàn tác công việc đã làm và
không hoàn lại chi phí công cụ đã dùng. Agent cần ý kiến hoặc quyền bổ sung sẽ hiện câu hỏi/nút cho bạn trả lời; không có lựa chọn tự đồng ý.

Chat độc lập với project đang xem. Một hội thoại có thể làm nhiều project; chọn project trong thư viện không đổi cuộc trò chuyện hay thêm
ngữ cảnh vào prompt. Tải lại trang không gửi lại tin nhắn. Bấm biểu tượng **Cuộc trò chuyện mới** trên thanh đầu để mở thêm cuộc trò chuyện song song, mỗi tab giữ bản nháp riêng.
Bấm **×** để đóng tab; Agent vẫn tiếp tục làm, và nút lịch sử ở góc trên mở lại tab đó.
Khung chat bố trí như sidebar Codex trong VS Code. Bấm **+** trong ô nhập để thêm ảnh/file (tối đa 10 MB/file) hoặc tham chiếu file/skill;
bạn vẫn có thể kéo file vào ô nhập hoặc dán ảnh. Model và chế độ/quyền nằm cùng nhóm dưới ô nhập, nút gửi ở mép phải. Mặc định kế thừa cấu hình Codex đang có.
Menu **…** có đổi tên, tìm trong chat, phân nhánh và lưu trữ/khôi phục; **Thêm thao tác…** chứa thu gọn và xuất Markdown/JSON.
Vào **… → Cài đặt Codex** để xem cài đặt, mức sử dụng hoặc phím tắt. Khi chỉ mở một tab, thanh tab được ẩn; tên hội thoại nằm ở thanh đầu.
Sửa tin hoặc gửi lại câu trả lời tạo nhánh riêng, giữ hội thoại gốc; không hoàn tác file. Nút lịch sử còn mở được hội thoại CLI/VS Code
trong cùng thư mục. Gõ `/help` để xem lệnh nhanh và phím tắt. File chat chỉ được đưa vào project khi Agent chủ động import theo yêu cầu.
Lượt chat dùng hạn mức tài khoản Codex đang kết nối. Nếu dùng Agent ngoài, mở Agent trong thư mục PADStudio như trước.

## 3. Làm video đầu tiên

Chỉ cần nói với Agent điều bạn muốn, càng cụ thể về người xem và mục đích càng tốt. Ví dụ:

> Làm một video dọc 2–3 phút giải thích thuật toán Dijkstra cho người mới học, giọng đọc tiếng Việt.

> Đây là video quay buổi họp của tôi (gửi file). Cắt thành bản tóm tắt 1 phút có phụ đề.

- **Có tài liệu:** đưa đường dẫn file/thư mục hoặc đường link vào prompt để Codex đọc như khi dùng ngoài VS Code. Agent quyết định nhập tư liệu cần dùng vào project qua CLI; cửa sổ chat không tự nhập file hay tạo Resource.
- **Chưa có tài liệu:** không sao. Agent tự viết kịch bản, tìm ảnh miễn phí có ghi nguồn, dựng hoạt họa và đọc giọng.
- **Có dịch vụ khác** (tạo ảnh, tạo nhạc, ứng dụng dựng hình): nếu Agent của bạn dùng được chúng, file tạo ra được nhập vào dự án
  kèm nhà cung cấp, prompt và bản quyền. PADStudio không tự gọi dịch vụ đó thay bạn.

Trên web, bấm **Dự án** (hoặc logo) để thấy dự án mới. Trạng thái "Đang dựng video" nghĩa là Agent đang làm; bản xem thử đầu
tiên tự hiện ở tab **Video** khi xong.

## 4. Xem và góp ý

- Xem ở tab **Video**. Có nhiều bản thì đổi hoặc so sánh được; mục **Các đoạn** cho nhảy tới từng đoạn.
- Muốn sửa đúng một chỗ: **dừng video ở chỗ đó, bấm "Sao chép mốc phản hồi"**, dán vào cuộc trò chuyện bạn muốn rồi nói điều cần đổi.
  Mốc ghi chính xác bản video, đoạn và giây, nên Agent không hiểu nhầm.
- Tab **Tư liệu** liệt kê ảnh, video, lời đọc và nhạc của dự án, nghe và xem ngay được.

## 5. Chốt và nhận video

Khi hài lòng, nói rõ với Agent là bạn **chốt** bản đang xem. Agent sẽ:

1. ghi quyết định duyệt cho đúng bản đó;
2. xuất bản giao có kiểm tra checksum, giữ nguyên từng byte;
3. **tự dọn bản nháp**: chỉ giữ video đã chốt, âm thanh và văn bản đã dùng (lời đọc, nhạc, kịch bản) và tư liệu bạn đưa vào.

Lấy video bằng nút **Tải bản đã duyệt** trên web. Muốn có bản ở thư mục khác, nhờ Agent sao chép ra vị trí bạn chọn. Dữ liệu dự án
nằm trong `.padstudio/projects/<tên-dự-án>`. Việc dọn không hoàn tác được; muốn sửa tiếp một dự án đã chốt, Agent làm lại từ bản
đã giao và tư liệu gốc.

## 6. Khi gặp sự cố

| Tình huống | Cách xử lý |
| --- | --- |
| Trang web không mở | Chạy `npm run observer:ensure`, rồi mở lại địa chỉ ở mục 2. |
| Trang báo "Mất kết nối" | Bấm **Thử lại**; nếu vẫn lỗi thì làm như dòng trên. |
| Agent nói thiếu khóa API, hoặc một công cụ "Cần cài thêm" | Bấm **Công cụ** trên thanh đầu: dán khóa rồi **Kiểm tra kết nối**, hoặc đọc dòng hướng dẫn dưới công cụ đó và nhờ Agent cài. |
| Trang thiếu nút **Công cụ** hay vẫn như bản cũ | Chạy `npm run observer:ensure`: lệnh tự thay trang đang chạy code cũ. Nếu nó báo phải tắt tay (server mở từ trước bản cập nhật 2026-10-09), đóng cửa sổ đang chạy `npm start` rồi chạy lại lệnh. |
| Agent làm dở thì máy tắt | Mở lại và nói "tiếp tục dự án X". Agent đọc trạng thái đã lưu và tiếp tục, kể cả khi một lần dựng bị đứt giữa chừng. |
| Ổ đĩa đầy | `npm run project:usage -- --all` để xem dự án nào chiếm chỗ. |
| Muốn kiểm tra sức khỏe hệ thống | `npm run padstudio:doctor` (thêm `-- --deep` để kiểm tra checksum). |

Chi tiết lệnh dành cho Agent: [`PADSTUDIO-AGENT-RUNTIME.md`](../PADSTUDIO-AGENT-RUNTIME.md). Vận hành và sao lưu:
[`OPERATIONS-RUNBOOK.md`](OPERATIONS-RUNBOOK.md).
