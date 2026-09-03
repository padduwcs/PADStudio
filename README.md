# PADStudio prototype

Prototype hiện tại kiểm tra một vòng project có thể mở lại và tiếp tục:

1. Agent tạo hoặc mở project local.
2. Agent nhập tư liệu; PADStudio giữ file, resource và run tương ứng.
3. Agent ghi checkpoint về mục tiêu, ràng buộc và việc tiếp theo.
4. Agent đọc lại context có cấu trúc khi tiếp tục.
5. Web quan sát cùng dữ liệu project, không gửi lệnh hay tự thay đổi trạng thái.

Chat vẫn nằm trong Agent host mà người dùng đang dùng. Các endpoint local chỉ
phục vụ observer trong trình duyệt; chúng không phải cầu nối điều khiển Agent.

## Cấu trúc project

```text
.padstudio/projects/<project-id>/
├── project.json
├── checkpoint.json
├── overview.md
├── inputs/
├── resources/
│   └── resource-*.json
└── runs/
    └── run-*.json
```

- `project.json`: danh tính ổn định của project.
- `resources/`: tư liệu đã được nhập thành công và các file thuộc mỗi resource.
- `runs/`: dấu vết từng thao tác import, gồm cả lỗi.
- `checkpoint.json`: phần bối cảnh có ý nghĩa do Agent chắt lọc.
- `overview.md`: bản đọc nhanh được sinh từ checkpoint, không phải nguồn sự thật riêng.

Mỗi file trạng thái được ghi qua file tạm rồi thay thế nguyên tử. Project cũ
không có `project.json` không được coi là project hợp lệ.

## Cấu trúc mã nguồn

```text
src/
├── project/     # Lưu trữ, đường dẫn và tính toàn vẹn của project
├── resources/   # Nhập và lập chỉ mục tài nguyên
├── cli/         # Các lệnh để Agent thao tác với project
└── web/         # Observer API và web server chỉ đọc
```

Agent quyết định mục tiêu, tài nguyên cần dùng và nội dung checkpoint.
PADStudio cung cấp sẵn cơ chế nhập an toàn, lưu resource/run/checkpoint và đọc
lại context. Web chỉ quan sát, không điều khiển Agent hay sửa project.

## Lệnh dành cho Agent

Tạo project:

```powershell
npm run project:create -- coffee-video "Video giới thiệu quán cà phê"
```

Nhập file hoặc folder:

```powershell
npm run project:import -- coffee-video "D:\Footage\coffee.mp4"
```

Ghi checkpoint từ một file JSON:

```powershell
npm run project:checkpoint -- coffee-video "D:\Temp\coffee-checkpoint.json"
```

Đọc toàn bộ context:

```powershell
npm run project:context -- coffee-video
```

Chi tiết contract và cách Agent dùng các lệnh nằm trong
[PADSTUDIO-AGENT-RUNTIME.md](PADSTUDIO-AGENT-RUNTIME.md).

## Chạy observer

```powershell
npm start
```

Mở `http://127.0.0.1:7603`.

## Kiểm tra

```powershell
npm test
```

Test bao phủ persistence, import thành công/thất bại, path safety, context khi
mở lại, observer API, byte ranges và việc web không có endpoint thay đổi project.
