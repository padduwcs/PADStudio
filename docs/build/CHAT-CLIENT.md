# Cửa sổ Codex theo thư mục — 2026-10-24

Người dùng prompt Codex trong PADStudio thay cho VS Code. Chat mở tại thư mục repo, độc lập với project video đang xem.
Một hội thoại có thể tạo hoặc tiếp tục nhiều project theo yêu cầu. Nhiều tab có thể chạy đồng thời.
Project viewer, CLI, Resource/Run/Result và Delivery giữ contract hiện có.

## Contract với Codex

- [`CodexClient`](../../src/chat/codex-client.js) chạy Codex App Server qua stdio, `shell: false`, ẩn cửa sổ trên Windows.
  Hỗ trợ bản native hoặc npm; `PADSTUDIO_CODEX_PATH` là cấu hình máy tin cậy, không chỉnh qua browser.
- Thread mới mặc định chỉ nhận `{cwd}`; thêm `model` khi người dùng chọn. Không tự override approval policy, sandbox, instructions,
  tools hay biến môi trường project. Codex tự đọc cấu hình, AGENTS.md và skill của thư mục như host ngoài.
- Catalog model, mức suy luận, mode, permission profile và skill lấy từ runtime. Catalog tùy chọn không có thì ẩn điều khiển tương ứng,
  vẫn dùng chat thường. Chỉ các lựa chọn người dùng đã chọn mới được chuyển vào `turn/start`.
- Plan/Default dùng preset Codex qua `collaborationMode`, `developer_instructions: null` để dùng preset gốc; không có prompt do PADStudio soạn.
  Permission profile chỉ nhận ID `allowed` từ Codex, không có fallback tự nâng quyền. Chọn “Mặc định của Codex” bỏ override, không reset thiết lập sticky của thread.
- Gửi nguyên văn text, kể cả khoảng trắng và chuỗi trông giống metadata. Không trim, chèn project ID, thêm video context hay dựng prompt wrapper.
  Không tự gọi `project:resume`, tạo project hoặc import Resource. Lệnh nhanh chỉ xử lý khi toàn bộ ô nhập khớp một lệnh đã hỗ trợ.
- Thread resume chỉ nhận ID, không override cấu hình/chỉ dẫn đã lưu. Lịch sử Codex trên máy được lọc đúng cwd trước phân trang; mở từ CLI/VS Code
  là thao tác chủ động. Metadata chat cũ gắn project không tự nhập hay resume. Thread đã mở có thể đổi tên, lưu trữ và khôi phục qua API gốc.
- Sửa tin nhắn tạo fork **trước cả lượt** chứa tin nhắn, điền lại để người dùng sửa rồi gửi. “Gửi lại” ở câu trả lời tạo fork tương tự và gửi lại
  yêu cầu gốc. Hội thoại gốc giữ nguyên; thao tác không hoàn tác file trên máy. Fork toàn hội thoại không chạy inference.
- Gửi bổ sung, dừng, thu gọn ngữ cảnh và approval dùng giao thức gốc. Không tự duyệt. Quyết định một lần/trong phiên/hủy và quy tắc lệnh/mạng
  chỉ lấy từ lựa chọn mà Codex đưa ra; quy tắc trả về giữ đúng giá trị do server đề xuất. Permission bổ sung trả đúng tập quyền đã yêu cầu.
- Không truyền token tài khoản hoặc stderr lên browser. Chỉ chuyển public reasoning **summary**, không chuyển raw reasoning `content` hay `textDelta`.

Theo [OpenAI Docs: Codex App Server](https://learn.chatgpt.com/docs/app-server) và schema do CLI **0.163.0** đang cài sinh ra.
Client bật capability `experimentalApi` để đọc/dùng preset collaboration; catalog lỗi thì tính năng tương ứng không hiện.
Đây là client cửa sổ chat, không nhúng extension hoặc toàn bộ editor VS Code. Không cung cấp terminal tương tác, chạy cloud,
quản lý plugin hoặc chỉnh toàn bộ config TOML trong UI.

## File, ảnh và skill do người dùng chọn

- [`ChatAttachments`](../../src/chat/chat-attachments.js) nhận file qua picker, kéo/thả vào ô nhập hoặc dán ảnh. Tối đa 10 file/tin, 10 MB/file.
  Lưu tại `.padstudio/chat/workspace/attachments/<cwd-digest>/` bằng ID ngẫu nhiên và tên đã làm sạch, không ghi project store.
- PNG/JPEG/GIF/WebP nhận diện theo byte và gửi bằng `localImage`. File khác gửi đường dẫn tuyệt đối trong một text input riêng,
  để agent đọc bằng công cụ bình thường; không tự đọc/chèn nội dung file. UI hiện chip cho từng file người dùng chọn.
- Chỉ ảnh được phục vụ preview, kiểm lại magic bytes, `nosniff` và CSP sandbox. Không có download/preview HTML tùy ý hay endpoint đọc một path bất kỳ.
- Nút `@` tìm file bằng fuzzy search gốc của Codex tại cwd, kiểm đường dẫn thật còn trong thư mục (kể cả symlink) trước khi chuyển tham chiếu.
  Tham chiếu file gửi path, skill dùng `UserInput.skill` với name/path từ catalog Codex. Không chèn skill PADStudio riêng.
- File chat tồn tại để Codex đọc và resume về sau; xóa chip chỉ bỏ khỏi tin sắp gửi, không xóa file. Không tự dọn file còn được transcript tham chiếu.
  Nếu cần dùng file làm đầu vào video, agent vẫn phải import vào đúng project theo contract hiện hành.

## Lịch sử và phục hồi

- Transcript do Codex giữ. `.padstudio/chat/workspace/<cwd-digest>.json` chỉ giữ liên kết ID, tiêu đề, model, lựa chọn UI, cờ lưu trữ và
  200 biên nhận/từng hội thoại. Không lưu transcript vào metadata hay có ProjectStore trong ChatService. Ghi metadata có hàng đợi nguyên tử.
- Lịch sử hỗ trợ legacy và paginated; tải 50 lượt gần nhất trước, thêm 25 lượt mỗi lần. View giới hạn 5.000 item để giữ UI hữu hạn.
  Xuất Markdown/JSON đi qua các trang gốc, tối đa 10.000 lượt, chỉ xuất các trường được phép hiển thị.
- Bản nháp gồm text, attachments, references, skill và lựa chọn; lưu theo tab tại sessionStorage riêng từng cửa sổ browser.
  Đóng tab không dừng agent. Chuyển project viewer không chuyển chat, không đổi input và không sinh inference.
- Biên nhận ID/fingerprint lưu trước RPC chống gửi trùng, gồm cả input/tùy chọn mới. Hỗ trợ fingerprint cũ cho gửi text thường.
  Lỗi gửi không rõ thì không tự retry; reload/kết nối lại không replay.
- Dữ liệu metadata cũ gắn project giữ nguyên trên đĩa. Những thread ấy có cấu hình hạn chế từ host cũ nên không tự resume vào chat workspace.
  Mở lịch sử native là lựa chọn của người dùng và giữ đúng cấu hình của thread đó.

## HTTP và giao diện

- Trang gốc không có `project` giữ màn hình chờ ngay cả khi kho có dự án hoặc Agent tạo thêm dự án. Chọn thư viện/link mới mở viewer;
  logo quay về màn hình chờ và giữ chat. Project mất khỏi danh sách cũng quay về đó, không tự chọn project khác.
- VI/EN dùng catalog giao diện tập trung trong [`i18n.js`](../../ui/i18n.js) và [`messages-en.js`](../../ui/messages-en.js), gồm shell, chat,
  thư viện, video/tư liệu và công cụ. Chỉ copy do ứng dụng sở hữu được dịch; tên/file, prompt, transcript, câu hỏi/lựa chọn gốc và chẩn đoán native giữ nguyên.
  Đổi ngôn ngữ lưu browser preference và `lang` trong URL rồi reload UI; tab/draft/chiều rộng được khôi phục, không dừng hoặc replay lượt Codex.
- [`chat-api.js`](../../src/web/chat-api.js) chỉ có thao tác cụ thể: status/connect/login/cancel, conversations, messages/interrupt/answer,
  rename/archive/unarchive/fork/compact/older/export, native history/resume/restore, attachments/image và tìm file.
  Không có route project/import hoặc arbitrary RPC. ID tường minh giữ các cửa sổ/tab độc lập.
- Host localhost, cùng Origin/intent/JSON cho POST; GET foreign Origin/cross-site cũng bị từ chối. JSON thông thường 128 KiB,
  chỉ upload có giới hạn 14 MiB cho base64. SSE heartbeat/coalescing, ngắt slow consumer; chống iframe bằng CSP và X-Frame-Options.
- [`chat-view.js`](../../ui/chat-view.js) giữ tab/transcript/composer, [`chat-controls.js`](../../ui/chat-controls.js) giữ menu hành động,
  lịch sử, thiết lập, tham chiếu, upload và tìm trong chat. Bố cục theo sidebar Codex trong VS Code: header gọn, ô nhập có **+**, mode/quyền và model/effort
  nằm cùng một nhóm, nút gửi tròn ở mép phải. Header có chat mới, lịch sử, menu phụ và đóng; cài đặt ở menu phụ. Một tab thì ẩn thanh tab, hiện tên hội thoại ở header.
- Transcript và vùng nhập dùng chung cột tối đa 720 px, lề 20 px (16 px khi màn hình ≤600 px); trừ chính xác bề rộng scrollbar để hai mép cột khớp nhau.
  Vùng nhập gom câu hỏi, trạng thái, thông báo, composer và tên thư mục thành một cụm. Viewer căn giữa diện tích còn lại khi màn hình lớn.
  Menu bám nút nguồn và tự đặt trên toàn bộ composer khi có nhiều dòng/attachments; ResizeObserver cập nhật khi đổi kích thước, không chồng lên ô nhập.
  Ở viewport thấp, giới hạn chiều cao draft/attachments để vẫn còn chỗ đọc và gửi; đã kiểm trường hợp 390×420 px có file và nhiều dòng.
- Lịch sử local/native gộp thành một danh sách, dedup bằng thread ID; chỉ lọc trong cwd. Metadata conversation trả thêm thread ID để UI nhận diện bản trùng.
  Thống kê, phím tắt và thao tác nâng cao chỉ xuất hiện khi mở menu; không có hàng hướng dẫn hoặc số liệu thường trực bên dưới ô nhập.
- Tin nhắn có sao chép, sửa/phân nhánh hoặc gửi lại. Markdown dùng DOM text: code/copy, bảng cuộn, trích dẫn, nhấn mạnh, checklist và list lồng;
  không thực thi HTML. Công cụ có lệnh/output đang chạy, diff, kế hoạch, public summary; ngữ cảnh và hạn mức nằm trong mục Mức sử dụng.
  Thao tác tin nhắn dùng icon với nhãn/tooltip, hiện khi hover/focus (luôn hiện trên touch). Lượt đã kết thúc không giữ nhãn “Đang chạy”.
- Lệnh nhanh: `/new`, `/model`, `/permissions`, `/plan`, `/default`, `/compact`, `/fork`, `/status`, `/help`.
  Enter gửi, Shift+Enter xuống dòng, Ctrl/Cmd+F tìm trong phần đang tải, Ctrl/Cmd+Shift+O chat mới.
- Font, nền trung tính ấm, accent cyan và đường chia vùng cùng PADStudio. Desktop kéo separator để đổi chiều rộng (320–960 px trong giới hạn
  viewport), nhớ lựa chọn; có phím trái/phải, Shift, Home/End và Enter/nhấp đúp để reset. Mobile ≤900 px là dialog toàn màn hình, focus trap/Esc.
  Đổi kích thước không ảnh hưởng transcript, draft, video đang phát hoặc lượt Codex đang chạy.

## Xác minh

- `npm run workspace:ui:test`: màn hình chờ với kho đã có/mới tạo/archive, hai chat chạy song song, chọn dự án chủ động,
  VI/EN qua reload, giữ nguyên prompt/answer/transcript/title/draft; 320–1920 px, sáng/tối, công cụ và menu chat.
- Unit/HTTP: exact prompt/default params, không inject instructions/project context; input gốc của ảnh/file/skill, options từ catalog,
  pagination/export, fork không replay, rename/archive/restore, restart/idempotence và quyền HTTP/request scoping.
- `npm run chat:ui:test`: nhiều tab/nhiều project viewer, drafts, questions, approvals, gửi bổ sung/dừng, resize chuột/bàn phím,
  persisted width, reload/offline, login; 320/390/768/1024/1440 px ở sáng/tối.
- `npm run chat:ui:features-test`: picker upload, references/skill, reload với attachments/options; sửa/gửi lại giữ hội thoại gốc,
  xuất Markdown thật, rename/archive, mở lịch sử CLI, slash commands, streaming và menu ở 320/390/768/1440 px, sáng/tối.
- Live CLI 0.163.0: gửi ảnh với explicit mode/effort/permission, nhận token đúng, native rename/history/fork-before-turn/export/archive/restore.
  Smoke chỉ dùng prompt kiểm thử, không chạy tools hoặc provider media; các thread thử được lưu trữ sau kiểm tra.
