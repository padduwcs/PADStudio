# PAD Studio

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ sản xuất video giảng giải trực quan bằng animation.

Ứng dụng hướng đến việc giải thích thuật toán và cấu trúc dữ liệu cho người mới học bằng hình ảnh logic, dễ hiểu và đồng bộ chính xác với lời thuyết minh. Video tập trung vào bản chất của kiến thức, không hiển thị code và không phụ thuộc vào caption.

## Quy trình chính

```text
Nhập chủ đề
→ Tạo và review mạch giảng
→ Tạo và review kế hoạch voice–visual
→ Sinh scene Motion Canvas và voice
→ Đồng bộ animation
→ Render bản nháp
→ Chỉnh sửa bằng Layout Editor
→ Render video cuối
```

Người dùng có thể chỉnh vị trí, kích thước, thuộc tính và timing của các thành phần trực tiếp trên giao diện. Những scene và component tốt có thể được lưu lại làm tài nguyên tham khảo cho các video sau.

## Trạng thái

PAD Studio đang trong giai đoạn phát triển ban đầu.

Vertical slice đầu tiên đã có thể chạy:

- Nhập chủ đề và định hướng cho video.
- Validate dữ liệu ở frontend và backend.
- Lưu project draft vào `projects/<project-id>/project.json`.
- Tự động lưu thay đổi vào project hiện tại.
- Liệt kê, mở lại, chỉnh sửa và xóa project cục bộ.
- Chuyển sang màn hình chuẩn bị mạch giảng sau khi chốt đầu vào.
- Giao diện responsive cho desktop và mobile.

Thời lượng định hướng hiện dùng ba mức:

- Ngắn gọn: 1–2 phút.
- Tiêu chuẩn: 3–5 phút.
- Chuyên sâu: 6–8 phút.

Project metadata được giữ trong Git để có thể version control nội dung từng
video. Chỉ thư mục render sinh ra tại `projects/**/renders/` bị ignore.

Việc sinh mạch giảng bằng AI chưa được bật cho đến khi project chốt AI provider,
model, prompt contract và giới hạn chi phí.

## Chạy ở môi trường phát triển

Yêu cầu Node.js 24.12 trở lên.

```bash
npm install
npm run dev
```

Frontend chạy tại `http://127.0.0.1:5173`, backend chạy tại
`http://127.0.0.1:4174`.

## Kiểm tra và chạy production

```bash
npm run validate
npm run build
npm start
```

Sau khi build, backend phục vụ cả API và frontend tại
`http://127.0.0.1:4174`.
