# Đóng góp cho PADStudio

Cảm ơn bạn đã quan tâm. PADStudio còn trẻ (phiên bản 0.1) và được xây quanh một ranh giới rõ ràng, vì vậy
hãy đọc phần **Trước khi bắt đầu** trước khi viết code.

[English summary](#english-summary) ở cuối trang.

## Trước khi bắt đầu

- **Mở issue trước cho thay đổi lớn.** Lỗi nhỏ, sửa chính tả, bổ sung test thì gửi thẳng pull request. Với tính năng mới hoặc
  thay đổi hành vi, hãy mô tả vấn đề trong một issue để thống nhất hướng đi, tránh bạn mất công vô ích.
- **Ranh giới sản phẩm đã chốt, không đổi trong một pull request thông thường:**
  - Agent bên ngoài (Claude Code hoặc tương đương) điều khiển công việc; PADStudio lưu project, chạy công cụ và giữ dấu vết.
  - Web observer chỉ đọc project. Thứ duy nhất web ghi là cài đặt máy (khóa API, dịch vụ, giọng mặc định) ở trang Công cụ.
  - Không có pipeline bắt buộc cho mọi video, không tự đổi công cụ hay nhà cung cấp ngầm, không tự cài runtime.
  - Chi tiết: [`docs/build/PADSTUDIO-CURRENT-DIRECTION.md`](docs/build/PADSTUDIO-CURRENT-DIRECTION.md).
- **Tài liệu build** nằm ở [`docs/build/`](docs/build/README.md). Bắt đầu từ `PADSTUDIO-DEVELOPMENT-STATUS.md` (trạng thái hiện tại)
  và `DEVELOPMENT-PROTOCOL.md` (cách thay đổi code). Các báo cáo cũ trong `reports/` và `docs/build/history/` chỉ là lịch sử.

## Thiết lập môi trường phát triển

Yêu cầu: **Windows 10/11**, **Node.js 20+** (đang kiểm thử trên Node 24) và **FFmpeg + ffprobe** trong `PATH`.
Không cần `npm install`: dự án không có dependency npm.

```powershell
git clone https://github.com/padduwcs/PADStudio.git
cd PADStudio
npm run check          # cú pháp, import thừa, link và đường dẫn trong tài liệu (vài giây)
npm test               # toàn bộ test (khoảng một phút)
```

Test tự bỏ qua phần cần runtime tùy chọn khi máy chưa cài (Python phân tích video, Manim, Remotion, HyperFrames).
Cài các runtime đó theo [`docs/CAI-DAT-RUNTIME.md`](docs/CAI-DAT-RUNTIME.md) nếu bạn sửa phần liên quan.

Kiểm tra giao diện bằng trình duyệt thật (cần Chrome hoặc Edge), dùng kho và cấu hình tạm nên không động tới project của bạn:

```powershell
npm run observer:ui:empty-test
npm run observer:ui:live-test
npm run observer:ui:tools-test
```

## Quy ước

- **Một thay đổi, một mục đích.** Pull request nhỏ, dễ đọc. Tách việc dọn dẹp ra khỏi việc sửa lỗi.
- **Có test.** Sửa lỗi thì thêm test tái hiện lỗi; tính năng mới thì có test cho hành vi và các trường hợp lỗi. Test chạy
  trên kho tạm, không đọc hay ghi `.padstudio/`.
- **`npm run check` và `npm test` phải xanh** trước khi gửi. CI chạy đúng hai lệnh này trên Windows.
- **Tài liệu đi cùng code.** Đổi hành vi thì sửa tài liệu liên quan; `npm run check` bắt link hỏng, tên script không tồn tại và
  đường dẫn file đã bị xóa.
- **Giao diện** dùng DOM thuần, ES module, không bước build, không `innerHTML` (mọi chữ qua `textContent`), một file CSS với các biến màu
  sẵn có. Kiểm tra sáng/tối và cả khổ điện thoại (390 px).
- **Bí mật:** không bao giờ commit khóa API, `padstudio.local.json`, thư mục `.padstudio/` hay file media của người dùng.
- **Commit:** câu đầu mô tả điều thay đổi (tiếng Anh hoặc tiếng Việt đều được), thân commit giải thích vì sao. Không cần quy ước
  tiền tố cứng nhắc.

## Dùng Agent để phát triển

Nếu bạn dùng một Agent lập trình, nó đọc [`AGENTS.md`](AGENTS.md) và đi theo đường "phát triển PADStudio". Agent phải nêu mục
tiêu, phạm vi và cách kiểm tra trước khi sửa, và không được tự đổi ranh giới sản phẩm. Hãy tự đọc lại diff trước khi gửi.

## Gửi pull request

1. Fork, tạo nhánh từ `main`.
2. Chạy `npm run check` và `npm test`.
3. Mở pull request theo mẫu; mô tả điều gì đổi, vì sao, và bạn đã kiểm tra bằng cách nào (kể cả phần **chưa** kiểm tra).
4. Chờ CI xanh. Người duy trì có thể đề nghị chỉnh sửa trước khi gộp.

Báo lỗi bảo mật: xem [`SECURITY.md`](SECURITY.md), đừng mở issue công khai.

## English summary

PADStudio is a local studio where an external Agent makes videos with you; the project stores every input, result and decision.
Open an issue before large changes. The product boundary is fixed: the Agent drives, the web observer is read-only (it only
writes machine settings on the Tools page), there is no mandatory pipeline and nothing installs itself.

Setup: Windows 10/11, Node.js 20+, FFmpeg and ffprobe on `PATH`; no `npm install` is needed. Run `npm run check` and `npm test`
before opening a pull request (CI runs the same two commands on Windows). Add a test with every fix or feature, keep documents in
step with the code, and never commit API keys, `padstudio.local.json` or `.padstudio/`. Report vulnerabilities privately,
see [`SECURITY.md`](SECURITY.md).
