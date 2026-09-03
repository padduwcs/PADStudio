# PADStudio prototype

Prototype này kiểm tra một lát cắt nhỏ: **Agent host làm việc với project local, còn web chỉ quan sát.**

- Người dùng chat trong Agent đang mở project.
- Agent nhập file/folder người dùng giao vào `inputs/` của project và lưu bản tóm tắt hiện tại vào `overview.md`.
- Web liệt kê các project trong `.padstudio/projects/`, hiển thị overview và preview tư liệu khi trình duyệt hỗ trợ.

Web không có chat, đăng nhập, API cho Agent hay thao tác làm thay đổi project. Các endpoint local chỉ giúp trình duyệt đọc tệp project; chúng không phải cầu nối đến Agent.

Khi Agent có đường dẫn local đến file/folder người dùng gửi trong chat, Agent gọi:

```powershell
npm run project:import -- <project-id> <file-hoặc-folder-nguồn>
```

Lệnh này là công cụ local cho Agent, không phải thao tác trên web.

## Chạy

```bash
npm start
```

Mở `http://127.0.0.1:7603`. Quy ước cho Agent host nằm ở [PADSTUDIO-AGENT-RUNTIME.md](PADSTUDIO-AGENT-RUNTIME.md).

## Kiểm tra

```bash
npm test
```

Test xác nhận import không sửa nguồn, không ghi đè file, web chỉ đọc project/input và không có endpoint chat.