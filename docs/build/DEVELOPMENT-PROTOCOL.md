# Cách thay đổi code

Tài liệu này dành cho developer và coding Agent. Nó hướng dẫn cách thay đổi codebase; không biến toàn bộ ý tưởng trong `PADSTUDIO-DESIGN.md` thành những việc phải xây ngay.

## Trước khi thay đổi code

1. Đọc [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md), [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md) và phần liên quan trong [`PADSTUDIO-BUILD-OUTLINE.md`](PADSTUDIO-BUILD-OUTLINE.md).
2. Đọc kỹ yêu cầu: cần làm gì, phần nào không được đụng tới và điều gì chưa rõ.
3. Kiểm tra code, test và dữ liệu hiện có liên quan.
4. Trước khi sửa, nêu lại mục tiêu, phạm vi, giả định và cách kiểm tra kết quả.

Không chỉ dựa vào trí nhớ hội thoại hoặc tự đặt ra chi tiết thiết kế mà người phụ trách chưa chọn.

## Khi triển khai

- Chỉ thay đổi phần cần thiết cho yêu cầu hiện tại và bảo toàn công việc sẵn có của người dùng.
- Không đưa chi tiết tạm thời của giao diện, renderer hoặc nhà cung cấp dịch vụ vào phần lõi chỉ vì tiện cho lần xây đầu tiên.
- Phải báo rõ fallback, hành động tính phí, nguy cơ mất dữ liệu hoặc thay đổi hành vi quan trọng.
- Nếu cần đổi một nguyên tắc trong bản thiết kế, dừng lại và xin người phụ trách xác nhận trước.
- Ghi lại việc cần làm sau, thay vì tự mở rộng sang phần không liên quan.

## Kiểm tra và bàn giao

Trước khi coi thay đổi hoàn thành, chạy các kiểm tra phù hợp: test liên quan, hành vi tích hợp hoặc trường hợp lỗi khi có thể, cùng các liên kết/tài liệu bị ảnh hưởng.

Báo rõ phần đã đổi, phần đã kiểm tra, phần chưa kiểm tra và giới hạn còn lại. Không báo một kiểm tra là đạt nếu chưa chạy nó.

Commit, nếu có, chỉ chứa một thay đổi nhất quán và không bao gồm work ngoài phạm vi của owner.
