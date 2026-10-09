# PADStudio — hướng dẫn cho người dùng

PADStudio là xưởng làm video chạy trên máy bạn. **Bạn trò chuyện với một Agent** (ví dụ Claude Code) và Agent dùng
PADStudio để dựng video. **Trang web của PADStudio chỉ để xem**: duyệt dự án, xem video, tải bản đã chốt. Mọi yêu cầu và
chỉnh sửa đều nói với Agent trong cuộc trò chuyện.

## 1. Chuẩn bị (làm một lần)

| Cần có | Ghi chú |
| --- | --- |
| Node.js 20 trở lên | Không cần cài thêm gói npm. |
| FFmpeg và ffprobe trong `PATH` | Nền tảng để ghép, cắt và xuất video. |

Kiểm tra máy đã sẵn sàng chưa:

```powershell
npm run padstudio:doctor
npm run tool:list
```

`tool:list` cho biết công cụ nào dùng được ngay và công cụ nào còn thiếu gì. Phần sau đều **tùy chọn**, Agent sẽ nói rõ khi
một bước cần đến chúng:

- **Giọng đọc miễn phí trên máy (Piper):** điền `piper.pythonCommand`, `piper.modelDirectory`, `piper.defaultModel` trong
  `padstudio.local.json` (mẫu: `padstudio.local.example.json`).
- **Giọng đọc ElevenLabs (trả phí):** điền `elevenLabs.apiKey` cùng file đó. File này không được đưa lên Git. Mỗi lần dùng,
  Agent cho bạn xem ước tính chi phí và chỉ chạy khi bạn đồng ý; bạn có thể đặt trần ngân sách cho từng dự án.
- **Hoạt họa bằng code:** Manim, Remotion hoặc HyperFrames. Nếu máy chưa có, Agent sẽ báo và hướng dẫn thiết lập thay vì tự cài.

## 2. Mỗi lần bắt đầu

1. Mở Agent trong thư mục PADStudio. Nó tự đọc hướng dẫn vận hành của PADStudio.
2. Mở trang xem: **http://127.0.0.1:7603**. Sau khi khởi động lại máy trang này không tự chạy; Agent sẽ khởi động nó khi cần, hoặc bạn
   tự chạy `npm run observer:ensure`.

## 3. Làm video đầu tiên

Chỉ cần nói với Agent điều bạn muốn, càng cụ thể về người xem và mục đích càng tốt. Ví dụ:

> Làm một video dọc 2–3 phút giải thích thuật toán Dijkstra cho người mới học, giọng đọc tiếng Việt.

> Đây là video quay buổi họp của tôi (gửi file). Cắt thành bản tóm tắt 1 phút có phụ đề.

- **Có tài liệu:** gửi file, thư mục hoặc đường link cho Agent. Agent nhập chúng vào dự án.
- **Chưa có tài liệu:** không sao. Agent tự viết kịch bản, tìm ảnh miễn phí có ghi nguồn, dựng hoạt họa và đọc giọng.
- **Có dịch vụ khác** (tạo ảnh, tạo nhạc, ứng dụng dựng hình): nếu Agent của bạn dùng được chúng, file tạo ra được nhập vào dự án
  kèm nhà cung cấp, prompt và bản quyền. PADStudio không tự gọi dịch vụ đó thay bạn.

Trên web, bấm **Dự án** (hoặc logo) để thấy dự án mới. Trạng thái "Đang dựng video" nghĩa là Agent đang làm; bản xem thử đầu
tiên tự hiện ở tab **Video** khi xong.

## 4. Xem và góp ý

- Xem ở tab **Video**. Có nhiều bản thì đổi hoặc so sánh được; mục **Các đoạn** cho nhảy tới từng đoạn.
- Muốn sửa đúng một chỗ: **dừng video ở chỗ đó, bấm "Sao chép mốc phản hồi", dán vào cuộc trò chuyện** rồi nói bạn muốn đổi gì.
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
| Agent làm dở thì máy tắt | Mở lại và nói "tiếp tục dự án X". Agent đọc trạng thái đã lưu và tiếp tục, kể cả khi một lần dựng bị đứt giữa chừng. |
| Ổ đĩa đầy | `npm run project:usage -- --all` để xem dự án nào chiếm chỗ. |
| Muốn kiểm tra sức khỏe hệ thống | `npm run padstudio:doctor` (thêm `-- --deep` để kiểm tra checksum). |

Chi tiết lệnh dành cho Agent: [`PADSTUDIO-AGENT-RUNTIME.md`](../PADSTUDIO-AGENT-RUNTIME.md). Vận hành và sao lưu:
[`OPERATIONS-RUNBOOK.md`](OPERATIONS-RUNBOOK.md).
