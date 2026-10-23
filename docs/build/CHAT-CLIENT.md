# Chat client local — 2026-10-23

Theo yêu cầu của chủ dự án, người dùng chat với agent ngay trong PADStudio như một IDE extension. Đây là client cho Codex có sẵn,
không phải agent loop mới hoặc MCP server. Quyết định thay thế phần “không tích hợp chat” trước đây trong
[`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md). Kho project, workflow thích nghi, Executor và Delivery giữ contract hiện có.

## Kết nối và quyền

- [`CodexClient`](../../src/chat/codex-client.js) khởi động Codex App Server qua stdio, `shell: false`, cửa sổ ẩn trên Windows. Hỗ trợ executable
  native và JS entry point của bản cài npm; `PADSTUDIO_CODEX_PATH` là cấu hình tin cậy từ môi trường, không chỉnh từ trình duyệt.
- Handshake `initialize`/`initialized`, request ID, thời hạn RPC, đóng child process và từ chối pending call khi mất kết nối. Không chuyển stderr ra UI.
- Kết nối chỉ bắt đầu khi mở chat. Xem video không khởi động agent và không tạo inference. Chat dùng tài khoản/cấu hình Codex hiện có;
  khi cần, `account/login/start` cung cấp URL OAuth chính thức để người dùng tự mở. Không đọc hoặc chuyển auth token cho browser.
- Thread chạy với `workspace-write`, `on-request`, reviewer `user`. UI chỉ cho phép từng yêu cầu; không cung cấp nút tự đồng ý hoặc toàn quyền.
  Command/file approval, permission request, câu hỏi và elicitation form đơn giản có renderer riêng. Request không hỗ trợ bị từ chối.
- App Server là giao thức thử nghiệm của nhà cung cấp; đã kiểm chứng bản Codex CLI 0.163.0 trên Windows. Không tuyên bố tương thích với
  mọi bản Codex hoặc mọi agent. Xem [tài liệu chính thức](https://learn.chatgpt.com/docs/app-server).

## Project, lịch sử và thao tác

- [`ChatService`](../../src/chat/chat-service.js) bind từng hội thoại với đúng project đã tồn tại. Nhiều hội thoại có thể hoạt động đồng thời;
  mỗi hội thoại giữ thread, turn, câu hỏi, model và biên nhận riêng. Developer instructions chỉ rõ project,
  runtime bootstrap và CLI. Host ngoài vẫn vận hành như trước. `PADSTUDIO_PROJECT_ROOT` được truyền vào child đúng gốc đang phục vụ.
- Transcript do Codex lưu. `.padstudio/chat/<digest-của-gốc-project>/` chỉ giữ liên kết project/hội thoại/thread và 200 biên nhận cho mỗi hội thoại.
  Metadata v2 tự đọc liên kết v1, bảo toàn các thread cũ và ghi nguyên tử theo hàng đợi để các tab không ghi đè nhau.
  Gốc project thay đổi thì liên kết được phân vùng riêng. Không ghi transcript/reasoning vào core project store. Bản nháp ở sessionStorage,
  tách theo project và hội thoại; không xóa draft khi lỗi mạng. Các tab đang mở và tab được chọn ở sessionStorage của từng cửa sổ trình duyệt.
  Chỉ nhận ID hội thoại đã liên kết với chính project đó; HTTP/SSE mang ID tường minh để cửa sổ khác không chuyển đích gửi tin, dừng hay phê duyệt.
- Ghi biên nhận **trước** `turn/start`/`turn/steer`, bind client message ID và fingerprint. Yêu cầu trùng không chạy lần nữa, kể cả sau restart.
  RPC lỗi khi chưa rõ agent nhận chưa được ghi `uncertain`; không tự retry một lượt có thể đã tốn hạn mức. Không tự replay khi reload/SSE reconnect.
- `turn/steer` chỉ bổ sung đúng active turn; `turn/interrupt` chỉ yêu cầu dừng agent, không nói rằng mọi tool ngoài đã hoàn tác hoặc hoàn tiền.
- Lịch sử được đọc lại bằng `thread/resume`; hỗ trợ thread legacy và trang 50 lượt gần nhất của thread paginated. Giới hạn hiển thị 500 item;
  UI báo khi chỉ có phần gần nhất. Raw reasoning không được đưa lên UI.
- Tạo dự án dùng ProjectStore; upload stream (100 MB/file, 12 Resource/tin) được staging tạm rồi nhập qua `importProjectInput`, giữ Run/Resource
  và xử lý trùng tên hiện có. Upload hoàn tất là input đã thuộc project, kể cả khi người dùng bỏ file khỏi tin nhắn.
- Chỉ khi bấm **Góp ý trong chat**, exact Result/revision/playhead được đính kèm vào bản nháp của tab đang chọn (có nút bỏ mốc). Metadata cho agent
  được đánh dấu trong input; UI hiển thị tên tư liệu và thông báo kèm mốc, không đổ ID/path kỹ thuật vào hội thoại.
- Acceptance trong UI chat vẫn là lời chốt của người dùng qua kênh `agent_host`, được Agent ghi bằng CLI. Nút cho phép chạy lệnh không phải
  acceptance video. Không sửa video sau chốt; Delivery giữ nguyên byte theo contract hiện có.

## HTTP và giao diện

[`chat-api.js`](../../src/web/chat-api.js) chỉ có route ứng dụng cụ thể dưới `/api/chat/`: status, connect, login/cancel, tạo project,
đọc hội thoại, gửi tin, interrupt, answer, new/conversation, attachments và events (SSE). Không có gateway RPC, arbitrary path hoặc shell.
Host localhost, cùng Origin, Content-Type và `X-PADStudio-Intent: chat` bảo vệ các POST; GET từ Origin/cross-site khác bị từ chối. Không CORS.
JSON có giới hạn riêng; filename không có path; stream có heartbeat, coalescing và ngắt slow consumer. Trạng thái active/prompt thuộc backend,
không thuộc một tab trình duyệt nên reload không đánh mất câu hỏi đang chờ. `frame-ancestors 'none'` và X-Frame-Options DENY ngăn trang ngoài
nhúng UI để đánh lừa người dùng bấm xác nhận quyền.

[`chat-view.js`](../../ui/chat-view.js) dùng DOM text nodes và Markdown có giới hạn; không thực thi HTML model trả về. Giao diện chỉ có đầu trang,
thanh tab, tin nhắn và ô nhập. Nút **+** mở tab mới ngay; mỗi tab có nút đóng. Đóng tab không dừng agent hay xóa lịch sử; nút lịch sử mở lại tab cũ.
Thanh tab có phím trái/phải, Home/End, Delete và tự giữ tab được chọn trong vùng nhìn khi đổi kích thước. Chuyển tab giữ bản nháp, tư liệu,
câu trả lời đang nhập và các phần chi tiết đã mở; model/đính kèm ở chân ô nhập, tạo dự án nằm trong menu lịch sử. Chat là cột cạnh video
trên desktop, dialog toàn màn hình ở ≤900 px, có focus trap và Esc. Tools/Library giữ modal riêng. Đóng chat không dừng agent; SSE ngừng khi
tab ẩn và nối lại khi mở. Model lấy từ catalog runtime, không suy ra quyền model chỉ từ tên trong catalog. Chưa tích hợp Claude/Gemini, import
folder từ browser, chuyển nguyên phiên đang mở ở ứng dụng khác, hay triển khai cloud/nhiều người dùng.

## Xác minh

- `node --test test/codex-client.test.js test/chat-service.test.js test/chat-api.test.js`: peer stdio thật và runtime giả xác định, không gọi model;
  kiểm stream Unicode, vòng đời, lỗi, chống gửi trùng, restart, phê duyệt, phân tách project, lịch sử, upload và ranh giới HTTP.
- `npm run chat:ui:test`: browser thật, HTTP/SSE thật, ProjectStore và file import thật, runtime giả; kiểm gửi/nhận, reload, draft, video anchor,
  câu hỏi, approval, steer/stop, nhiều tab cùng chạy, kết quả nền, đóng/mở lại, bản nháp/câu hỏi riêng từng tab, lịch sử, project, offline
  và 320/390/768/1024/1440 px ở sáng/tối. Ảnh ở `.cache/chat-ui/` là evidence phát triển.
- Kiểm tra live Codex dùng project tạm, gửi một lượt trả token rồi đóng/mở process để đọc lại lịch sử; thêm một lượt đọc nonce checkpoint qua CLI,
  xác nhận đúng hai lệnh chỉ đọc (hướng dẫn và resume). Không tự thêm inference vào `npm test`.
  Không gọi provider media trả phí để nghiệm thu khung chat.
