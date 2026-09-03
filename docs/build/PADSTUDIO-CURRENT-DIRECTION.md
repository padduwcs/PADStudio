# PADStudio — định hướng hiện tại

Tài liệu này ghi các định hướng đã chốt để làm rõ [`PADSTUDIO-DESIGN.md`](./PADSTUDIO-DESIGN.md); không thay thế bản thiết kế gốc.

## Một UI, một project

PADStudio là nơi người dùng và Agent cùng làm video, không ép mọi project theo một pipeline cố định. UI là một ứng dụng duy nhất, chia làm hai vùng cùng làm việc với **một project**:

- **Chat:** người dùng làm việc trực tiếp với Agent thật — nêu mục tiêu, gửi tư liệu, nhận đề xuất, phản hồi và xác nhận. Đây là chat thật, không phải mô phỏng; người dùng làm việc trực tiếp với Agent ngay trong UI.
- **Web:** người dùng quan sát project, trạng thái, tư liệu, kết quả và preview.

Hai vùng cùng đọc từ kho project, là nguồn sự thật chung. Web không giữ trạng thái project riêng cần đồng bộ với chat.

## Chat điều khiển, web quan sát

Chat là kênh duy nhất để điều khiển công việc trong project. Người dùng đưa yêu cầu, thay đổi hướng và phê duyệt qua chat. Agent hiểu phản hồi, chọn việc sáng tạo cần làm tiếp và cập nhật project.

Web chỉ phục vụ xem và điều hướng: mở project khác, xem trạng thái, phát preview hoặc đổi cách xem. Nó không gửi lệnh và không tự thay đổi lựa chọn, quyết định, kết quả hay checkpoint. Khi Agent cần người dùng quyết định, web hiển thị rõ điều đang chờ và bằng chứng cần xem; người dùng phản hồi trong chat.

Tư liệu người dùng upload trực tiếp trong chat được giữ như đầu vào gốc của project. Với path hoặc URL bên ngoài, Agent xem rồi chỉ đưa phần cần thiết vào project. Web chỉ hiển thị các tư liệu đã có trong project; nó không upload, import, xóa hay đổi chúng.

## Agent làm việc, người dùng kiểm soát hướng

Agent phân tích yêu cầu, chọn cách làm, tư liệu và công cụ phù hợp, rồi tạo kết quả. Người dùng quyết định mục tiêu, ràng buộc, hướng thay đổi và điều gì được chấp nhận.

Agent phải hỏi trong chat khi cần quyết định từ người dùng, đồng thời nói rõ lỗi, chi phí, rủi ro hoặc thay đổi quan trọng. Agent không được âm thầm đổi một lựa chọn có ảnh hưởng đáng kể.

## Trí nhớ project và checkpoint

Project giữ trí nhớ có ý nghĩa để Agent có thể tiếp tục hoặc kiểm tra lại: yêu cầu/ràng buộc còn hiệu lực, tư liệu và kết quả quan trọng, bản được chọn, quyết định/phê duyệt, run, lỗi, bằng chứng và checkpoint. Agent chắt lọc ý nghĩa; hệ thống giữ các bằng chứng khách quan để chúng không chỉ tồn tại trong hội thoại.

Project không lấy full transcript chat hay suy nghĩ nội bộ của Agent làm lõi. Checkpoint không phải bước cố định: nó cho biết project đang ở đâu, điều gì đã chốt, việc nào đang dở hoặc chờ duyệt và Agent nên làm gì tiếp theo.

## Linh hoạt và tiếp tục

Project có thể bắt đầu từ ý tưởng, file, video, ảnh, đường dẫn đến tài nguyên có sẵn hoặc yêu cầu bất kỳ. Khi người dùng đổi hướng, Agent chỉ làm lại phần bị ảnh hưởng và giữ lại phần vẫn còn giá trị.

## Triển khai tạm thời

Trong giai đoạn đầu, chat chưa nằm trong web PADStudio. Người dùng mở project bằng Agent họ đang dùng và chat trong chính cửa sổ Agent đó; Agent đọc và cập nhật project. Web PADStudio là cửa sổ local chỉ quan sát project.

Đây là cách làm tạm thời để không tạo chat client, cơ chế đăng nhập hay connector riêng chỉ nhằm bắt chước Agent host. Mục tiêu UI một ứng dụng chia chat và web vẫn được giữ; chỉ triển khai khi có cách tích hợp phù hợp với Agent host.