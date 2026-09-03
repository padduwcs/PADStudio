# PADStudio — quy ước tạm thời cho Agent host

Trong prototype này, chat nằm trong Agent host mà người dùng đang dùng. Web
PADStudio chỉ quan sát project local; nó không gửi lệnh cho Agent.

## Bắt đầu hoặc tiếp tục project

Mỗi project hợp lệ là một thư mục trong `.padstudio/projects/` có
`project.json`. Khi bắt đầu project mới, tạo rõ danh tính:

```powershell
npm run project:create -- <project-id> "<tiêu đề>"
```

Trước khi tiếp tục một project, đọc context:

```powershell
npm run project:context -- <project-id>
```

Không suy luận trạng thái chỉ từ tên file hoặc trí nhớ cuộc chat.

## Nhập tư liệu

Khi người dùng upload file/folder trong chat và Agent có đường dẫn local thật:

```powershell
npm run project:import -- <project-id> <file-hoặc-folder-nguồn>
```

Nếu project chưa tồn tại, lệnh import tạo project với tiêu đề suy ra từ id.
Nên dùng `project:create` trước khi cần tiêu đề chính xác.

Import:

- không sửa nguồn;
- không ghi đè file đã có;
- từ chối symbolic link, junction không an toàn và đường dẫn chồng lên project;
- chỉ tạo resource sau khi bản sao hoàn chỉnh đã vào `inputs/`;
- luôn giữ run thành công hoặc thất bại khi yêu cầu import hợp lệ đã bắt đầu.

Folder được ghi là một resource; các file bên trong là items của resource đó,
không bị hiểu thành nhiều lần import độc lập. Với path hoặc URL bên ngoài,
Agent chỉ nhập phần đã xem và quyết định cần dùng.

Nếu lệnh thất bại, nói rõ trong chat và không tuyên bố rằng resource đã được lưu.

## Dùng công cụ

Xem các capability và công cụ thực sự dùng được trên máy:

```powershell
npm run tool:list
```

Để chạy một công cụ, tạo file request JSON:

```json
{
  "capability": "media.inspect",
  "tool": "ffprobe",
  "purpose": "Đọc thông số kỹ thuật của video nguồn",
  "inputs": {
    "resourceId": "resource-..."
  }
}
```

Nếu resource là folder, thêm `itemPath` đúng với file bên trong resource. Sau đó chạy:

```powershell
npm run tool:run -- <project-id> <file-request-json>
```

Agent phải chọn rõ capability và tool từ danh mục; hệ thống không tự fallback sang
tool khác. Lệnh thành công lưu một result và run liên kết với nhau. Lệnh thất bại
vẫn lưu failed run sau khi một yêu cầu hợp lệ đã bắt đầu.

## Ghi checkpoint

Agent chắt lọc bối cảnh có ý nghĩa vào một file JSON tạm, ví dụ:

```json
{
  "goal": "Video giới thiệu quán cà phê, dài 30 giây",
  "constraints": ["Tông ấm", "Không dùng nhạc có bản quyền"],
  "selectedResources": ["resource-..."],
  "pending": ["Chờ người dùng chọn giọng đọc"],
  "next": "Phân tích video nguồn"
}
```

Sau đó ghi vào project:

```powershell
npm run project:checkpoint -- <project-id> <file-json>
```

`selectedResources` chỉ được tham chiếu resource đang tồn tại.
`next` là quyết định của Agent, không do PADStudio tự suy ra.
`overview.md` được sinh lại từ checkpoint để con người đọc nhanh; không sửa
file này thay cho checkpoint.

Checkpoint giữ các sự thật còn hiệu lực, không giữ full transcript, chuỗi
approve/reject, suy nghĩ nội bộ hay một pipeline cố định.

## Ranh giới

Agent dùng CLI để thay đổi project. Web chỉ đọc project, preview tư liệu và
hiển thị checkpoint, kết quả và lần chạy. Agent không dùng web để gửi lệnh,
import hay cập nhật checkpoint.
