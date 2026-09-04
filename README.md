# PADStudio prototype

Prototype hiện tại kiểm tra các phần của một vòng project có thể mở lại và tiếp tục;
đây không phải pipeline bắt buộc cho mọi project:

1. Agent tạo hoặc mở project local.
2. Agent nhập tư liệu; PADStudio giữ file, resource và run tương ứng.
3. Agent xem các capability đang có và yêu cầu một công cụ cụ thể qua Bộ thực thi.
4. PADStudio giữ run, result, kiểm tra và dấu vết từ đầu vào đến công cụ đã dùng.
5. Khi người dùng phản hồi rõ về một result, Agent ghi decision tương ứng.
6. Agent ghi checkpoint về mục tiêu, ràng buộc và việc tiếp theo, rồi đọc lại
   toàn bộ context có cấu trúc khi tiếp tục.
7. Web quan sát cùng dữ liệu project, không gửi lệnh hay tự thay đổi trạng thái.

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
├── results/
│   └── result-*.json
├── decisions/
│   └── decision-*.json
└── runs/
    └── run-*.json
```

- `project.json`: danh tính ổn định của project.
- `resources/`: tư liệu đã được nhập thành công và các file thuộc mỗi resource.
- `results/`: kết quả bền vững do công cụ tạo ra, kèm đầu vào, công cụ và bằng
  chứng kiểm tra.
- `decisions/`: lịch sử phản hồi nối tiếp của người dùng đối với từng result.
- `runs/`: dấu vết từng thao tác import hoặc chạy công cụ, gồm cả lỗi, thời lượng
  và chi phí khi có.
- `checkpoint.json`: phần bối cảnh có ý nghĩa do Agent chắt lọc.
- `overview.md`: bản đọc nhanh được sinh từ checkpoint, không phải nguồn sự thật riêng.

Mỗi file trạng thái được ghi qua file tạm rồi thay thế nguyên tử. Project cũ
không có `project.json` không được coi là project hợp lệ.

## Cấu trúc mã nguồn

```text
src/
├── project/     # Lưu trữ, đường dẫn và tính toàn vẹn của project
├── resources/   # Nhập và lập chỉ mục tài nguyên
├── execution/   # Danh mục công cụ và Bộ thực thi dùng chung
├── tools/       # Logic của từng công cụ cụ thể
├── cli/         # Các lệnh để Agent thao tác với project
└── web/         # Observer API và web server chỉ đọc
```

Agent quyết định mục tiêu, tài nguyên cần dùng và nội dung checkpoint.
PADStudio cung cấp cơ chế nhập an toàn, khám phá và chạy công cụ, lưu
resource/run/result/decision/checkpoint, rồi đọc lại context. Web chỉ quan sát,
không điều khiển Agent hay sửa project.

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

Xem capability và công cụ hiện có:

```powershell
npm run tool:list
```

Chạy một công cụ bằng request JSON từ standard input hoặc từ file:

```powershell
$request | npm run tool:run -- coffee-video -
npm run tool:run -- coffee-video D:\Temp\tool-request.json
```

Ghi decision sau khi người dùng phản hồi rõ về một result:

```powershell
$decision | npm run project:decide -- coffee-video -
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
mở lại, danh mục công cụ, Bộ thực thi, ffprobe thật, result và decision có dấu
vết, observer API, byte ranges và việc web không có endpoint thay đổi project.
