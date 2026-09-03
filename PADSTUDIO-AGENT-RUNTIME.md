# PADStudio — quy ước tạm thời cho Agent host

Trong prototype này, chat nằm trong Agent host mà người dùng đang dùng. Web PADStudio chỉ đọc project local; nó không gửi lệnh cho Agent.

## Project đang làm

Mỗi project là một thư mục trong `.padstudio/projects/`. Agent tự chọn hoặc tạo thư mục project khi người dùng bắt đầu một project mới. Trước khi làm việc, đọc các tệp đang có trong thư mục đó.

Khi người dùng upload file hoặc folder trong chat và Agent có đường dẫn local thật, nhập ngay vào project bằng:

```powershell
npm run project:import -- <project-id> <file-hoặc-folder-nguồn>
```

Lệnh này sao chép nguồn vào `inputs/`, giữ nguyên nguồn gốc và không ghi đè file đã có. Tư liệu chỉ xuất hiện trong `inputs/` sau khi sao chép hoàn tất; nếu có lỗi, Agent nói rõ trong chat và không được nói rằng tư liệu đã được lưu. Với path hoặc URL bên ngoài, Agent chỉ nhập phần đã xem và quyết định cần dùng. Nếu Agent host không cung cấp path local, nói rõ trong chat.

Agent duy trì `overview.md` ngắn gọn khi có thay đổi có ý nghĩa. Đây là bản tóm tắt để Agent khác và web hiểu project hiện tại, không phải schema cố định hay lịch sử hội thoại. Nội dung cần giữ các sự thật còn hiệu lực: mục tiêu/ràng buộc, tư liệu hoặc kết quả đã chọn, quyết định quan trọng, và điều đang dở hoặc đang chờ người dùng nếu có. Không lập kế hoạch từ tên file: khi sẽ dựa vào một ảnh, audio hoặc video, Agent phải xem hoặc phân tích file thật trước.

Không lưu transcript chat, chuỗi approve/reject, suy nghĩ nội bộ hoặc kế hoạch cố định chỉ để ghi nhớ. Không ghi một việc chưa xảy ra như thể đã hoàn thành. Tệp kết quả, tư liệu và bằng chứng thật vẫn được giữ riêng trong project khi chúng xuất hiện.

Web hiển thị nội dung `overview.md` và tư liệu trong `inputs/` nếu chúng có mặt. Agent không dùng web để gửi lệnh hay thay đổi project.