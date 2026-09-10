# Đợt 2 — Gói D: quan sát vòng creative

Trạng thái: **đã hoàn thành**. Ngày kiểm tra: **2026-09-11**.

Gói D bổ sung một workspace chỉ đọc để người dùng nhìn được toàn bộ mạch:
**brief → các phương án → hướng đã chọn → mẫu → review → phê duyệt**. Phần này chỉ trình bày
dữ liệu bền vững đã có; không tạo kho trạng thái mới và không cho web tự sửa project.

## Kết quả

- Hiển thị mục tiêu, đối tượng, kết quả mong muốn, ràng buộc, sự thật, giả định và câu hỏi của brief.
- So sánh 2–5 phương án, đánh dấu phương án được chọn, ưu điểm, đánh đổi và rủi ro.
- Hiển thị direction hiện hành, nguyên tắc, điều cần tránh, tiêu chí review và phê duyệt direction.
- Nối đúng sequence revision, render, review và user approval của chính render đó.
- Ưu tiên exact render đã duyệt thay vì vô tình hiển thị một render mới hơn nhưng chưa duyệt.
- Giữ lịch sử revision và cảnh báo dependency stale; project chưa có creative artifact vẫn mở an toàn.
- Giao diện responsive đã kiểm tra ở 390, 768 và 1440 px.

## Ranh giới

Observer vẫn chỉ đọc. Phản hồi và phê duyệt tiếp tục qua Agent/chat rồi được ghi bằng contract
project hiện có. Không có provider mới, dịch vụ ngoài hay chi phí phát sinh.

## Kiểm tra lại

```powershell
node --test test/creative-direction-view.test.js test/project-reader.test.js
npm run creative:acceptance -- --report reports/phase2-creative-direction-acceptance.json
```

Bằng chứng tổng hợp nằm trong [báo cáo Gói E](./CREATIVE-DIRECTION-PACKAGE-E.md).
