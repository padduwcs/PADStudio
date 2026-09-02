# PADStudio — định hướng hiện tại

Tài liệu này chỉ ghi các định hướng đã được chốt để làm rõ bản thiết kế gốc. Nó không thay thế [`PADSTUDIO-DESIGN.md`](./PADSTUDIO-DESIGN.md).

## Một UI, hai vùng làm việc

PADStudio là **một UI duy nhất**, không tách Agent và web thành hai ứng dụng. UI được chia làm hai vùng cùng làm việc với một project:

- **Cửa sổ chat:** người dùng làm việc trực tiếp với Agent thật — nêu mục tiêu, gửi tư liệu, nhận đề xuất, phản hồi và xác nhận.
- **Web quan sát:** người dùng xem project, trạng thái, tiến độ, tư liệu, kết quả và preview.

Hai vùng dùng chung một kho project; web không có trạng thái project riêng cần đồng bộ với chat.

## Chat điều khiển, web quan sát

Mọi yêu cầu, phản hồi và xác nhận có ảnh hưởng đến project đều đi qua chat với Agent. Agent hiểu phản hồi, chọn việc tiếp theo và cập nhật project.

Web chỉ để quan sát và điều hướng. Khi Agent cần người dùng quyết định, web hiển thị trạng thái/bằng chứng cần xem; người dùng phản hồi trong chat. Web không tự thay đổi quyết định, kết quả, checkpoint hay trạng thái của Agent.

## Trí nhớ project có ý nghĩa

Project giữ những gì cần để tiếp tục hoặc kiểm tra lại: yêu cầu đang có hiệu lực, tư liệu/kết quả quan trọng, quyết định đã chốt, bằng chứng của lần chạy và checkpoint. Agent chắt lọc trí nhớ này; project không lấy full chat làm lõi.

Checkpoint là điểm tiếp tục, không phải stage cố định. Nó cho Agent biết project đang ở đâu, điều gì đã chốt, phần nào còn dở/chờ xác nhận và cần làm gì tiếp theo.
