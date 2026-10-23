# Cửa sổ Codex theo thư mục — 2026-10-23

Người dùng prompt Codex trong PADStudio thay cho VS Code. Chat mở tại thư mục repo, không gắn với một project video.
Một hội thoại có thể tạo hoặc tiếp tục nhiều project qua các yêu cầu của người dùng. Nhiều tab có thể chạy đồng thời.
Project viewer, CLI, Resource/Run/Result và Delivery giữ contract hiện có.

## Contract với Codex

- [`CodexClient`](../../src/chat/codex-client.js) chạy Codex App Server qua stdio, `shell: false`, ẩn cửa sổ trên Windows.
  Hỗ trợ bản native hoặc npm; `PADSTUDIO_CODEX_PATH` là cấu hình máy tin cậy, không chỉnh qua browser.
- Thread mới: `{cwd}` và chỉ thêm `model` khi người dùng chủ động chọn. Không override `approvalPolicy`, sandbox, permission profile,
  base/developer instructions, tools hay biến môi trường project. Codex dùng cấu hình, AGENTS.md và skill của thư mục như host ngoài.
- Gửi nguyên văn prompt trong text input, kể cả khoảng trắng và chuỗi trông giống metadata. Không trim, chèn project ID, thêm video context
  hay dựng prompt wrapper. Không tự gọi `project:resume`, tạo project hoặc import file thay người dùng.
- `thread/resume` chỉ nhận thread ID đã được client lưu; không ghi đè chỉ dẫn/cấu hình đã lưu của Codex. History hỗ trợ legacy và paginated;
  hiển thị tối đa 500 item/50 lượt gần nhất, có thông báo khi cắt bớt. Raw reasoning không hiển thị.
- `turn/start`, `turn/steer`, `turn/interrupt` và server requests dùng giao thức Codex. UI chuyển câu hỏi/quyền do Codex yêu cầu,
  không tự phê duyệt hoặc phát sinh bước duyệt riêng cho project. Model lấy từ catalog runtime; dùng tài khoản Codex trên máy.
- Không truyền token tài khoản hoặc stderr lên trình duyệt. Hiển thị Markdown bằng DOM text, không thực thi HTML.

Thiết kế theo [OpenAI Docs: Codex App Server](https://learn.chatgpt.com/docs/app-server). Đã kiểm chứng runtime CLI 0.163.0;
đây là client riêng với giao diện PADStudio, không nhúng nguyên VS Code extension và không tuyên bố mọi tính năng extension đã có.

## Lịch sử và phục hồi

- Transcript do Codex giữ. `.padstudio/chat/workspace/<digest-của-cwd>.json` chỉ lưu ID hội thoại/thread, tiêu đề, model và 200 biên nhận
  gửi tin cho mỗi hội thoại. Không có ProjectStore hoặc project ID trong ChatService. Metadata có hàng đợi ghi nguyên tử.
- Tab trống cũng có ID bền vững qua restart. Bản nháp/tab đang mở ở sessionStorage riêng từng cửa sổ trình duyệt; chuyển project viewer
  không chuyển chat, không đổi input, không sinh inference. Đóng tab chỉ đóng cách xem, lịch sử mở lại được.
- Biên nhận client ID/fingerprint lưu trước RPC để chống gửi trùng. Kết quả gửi không rõ thì không tự retry; reload/kết nối lại không replay.
- Liên kết chat v1/v2 gắn project của bản trước được giữ nguyên ở đường dẫn cũ. Không tự nhập/resume vào chat mới: những thread đó đã có
  chỉ dẫn gắn project và không đại diện cho phiên Codex tự do. Không sửa hoặc xóa transcript cũ.

## HTTP và UI

- [`chat-api.js`](../../src/web/chat-api.js): status, connect, login/cancel; GET/POST `conversations`;
  GET `conversations/:id`; POST `conversations/:id/messages|interrupt|answer`; SSE `events?conversation=:id`.
- Các route tạo project, upload/import, video anchor và arbitrary RPC không tồn tại. ID tường minh giữ các cửa sổ/tab độc lập.
- Host localhost; cùng Origin, JSON và header intent cho POST. GET từ foreign Origin/cross-site bị từ chối. JSON giới hạn kích thước,
  SSE có heartbeat/coalescing và ngắt slow consumer. CSP frame-ancestors/X-Frame-Options ngăn trang khác nhúng UI quyền.
- [`chat-view.js`](../../ui/chat-view.js): header Codex/tên thư mục, tab, transcript, model và ô nhập. Không có chọn/tạo project hay
  import tư liệu. Muốn dùng file, người dùng đưa path/URL trong prompt để Codex xử lý bình thường. Mốc video chỉ được sao chép/dán bằng tay.
- Dùng token font, nền trung tính ấm, accent cyan, đường chia vùng sáng/tối của PADStudio. Desktop nằm cạnh video; ≤900 px là dialog,
  có focus trap/Esc. Tab dùng trái/phải, Home/End, Delete; tab được chọn giữ trong vùng nhìn khi resize. Tools/Library có modal riêng.
- Desktop kéo đường phân cách để đổi chiều rộng (320–960 px, giới hạn theo viewport để giữ chỗ xem video). Nhớ chiều rộng trong localStorage,
  tự co bố cục video/tư liệu theo vùng còn lại. Separator có phím trái/phải (Shift đổi bước lớn), Home/End, Enter hoặc nhấp đúp để đặt lại.
  Mobile dùng toàn màn hình, không có tay kéo. Đổi kích thước không ảnh hưởng transcript, draft, video đang phát hoặc lượt Codex đang chạy.

## Xác minh

- Unit/HTTP: exact prompt, native thread params, không inject môi trường/chỉ dẫn, không tạo/import project; history, restart, chống gửi trùng,
  câu hỏi/quyền riêng từng hội thoại, parallel/steer/interrupt, dữ liệu cũ giữ nguyên và lỗi dữ liệu được bảo toàn.
- `npm run chat:ui:test`: browser/HTTP/SSE thật, Codex giả; thư viện video trống và có project, đổi project không đổi chat, không auto-create,
  nhiều tab, kết quả nền, drafts, prompts, gửi chậm khi chuyển tab, resize bằng chuột/bàn phím, nhớ chiều rộng, reload/offline, login
  và 320/390/768/1024/1440 px ở sáng/tối.
- Browser regression cho thư viện trống, video live và Công cụ. Live Codex chỉ dùng prompt kiểm thử, không gọi provider media trả phí.
