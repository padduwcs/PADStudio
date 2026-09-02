# PADStudio — hướng dẫn cho coding Agent

Đọc [`docs/build/PADSTUDIO-DESIGN.md`](docs/build/PADSTUDIO-DESIGN.md) để hiểu PADStudio trước khi thay đổi code.

## Trước khi thay đổi code

1. Đọc `docs/build/PADSTUDIO-DESIGN.md`.
2. Đọc `docs/build/PADSTUDIO-CURRENT-DIRECTION.md` để biết định hướng đã được chốt hiện tại.
3. Đọc phần liên quan trong `docs/build/PADSTUDIO-BUILD-OUTLINE.md`.
4. Đọc `docs/build/DEVELOPMENT-PROTOCOL.md`.
5. Đọc yêu cầu triển khai. Nếu chưa rõ phạm vi, hỏi người phụ trách trước khi bắt đầu.
6. Kiểm tra code và test liên quan; không đoán thiết kế chỉ từ code cũ hoặc hội thoại cũ.
7. Nêu lại mục tiêu, phạm vi, giả định và cách kiểm tra trước khi triển khai.

## Quy tắc bắt buộc

- `docs/build/PADSTUDIO-DESIGN.md` là tài liệu định hướng chính. Hướng dẫn runtime cho Agent là loại tài liệu khác.
- `docs/build/PADSTUDIO-BUILD-OUTLINE.md` chia bản thiết kế thành các phần có thể triển khai; nó không tự chốt chi tiết kỹ thuật.
- Giữ mục tiêu, ranh giới và nguyên tắc trong bản thiết kế. Chỉ chốt cấu trúc dữ liệu, API, thư mục hay nhà cung cấp khi phần đang xây thực sự cần chúng.
- Agent chọn việc sáng tạo cần làm. PADStudio giữ dự án, cho phép chạy công cụ và lưu dấu vết của kết quả.
- Đầu vào và cách làm của mỗi dự án phải linh hoạt; không ép mọi dự án đi qua một màn hình hay chuỗi bước cố định.
- Giữ được đầu vào, kết quả, quyết định, lịch sử, lần chạy, điểm tiếp tục và dấu vết để có thể kiểm tra lại; không chỉ dựa vào trí nhớ hội thoại.
- Không để chi tiết của nhà cung cấp, renderer hoặc giao diện quyết định phần lõi của hệ thống.
- Không tự ý đổi ranh giới, cách lưu dữ liệu, quyền hạn hay hướng thiết kế đã chốt. Nếu cần đổi, dừng và xin người phụ trách xác nhận.
- Bảo toàn công việc của người dùng và thay đổi ngoài phạm vi; không dùng reset phá hủy để làm sạch commit.

Protocol triển khai, verification, handoff và commit nằm trong [`docs/build/DEVELOPMENT-PROTOCOL.md`](docs/build/DEVELOPMENT-PROTOCOL.md).
