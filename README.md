# PADStudio prototype

Prototype này kiểm tra một lát cắt nhỏ: **Agent host làm việc với project local, còn web chỉ quan sát.**

- Người dùng chat trong Agent đang mở project.
- Agent lưu bản tóm tắt hiện tại vào `overview.md` của project.
- Web liệt kê các project trong `.padstudio/projects/` và chỉ hiển thị tệp đó.

Web không có chat, đăng nhập, API cho Agent hay thao tác làm thay đổi project. Các endpoint local chỉ giúp trình duyệt đọc tệp project; chúng không phải cầu nối đến Agent.

## Chạy

```bash
npm start
```

Mở `http://127.0.0.1:7603`. Quy ước cho Agent host nằm ở [PADSTUDIO-AGENT-RUNTIME.md](PADSTUDIO-AGENT-RUNTIME.md).

## Kiểm tra

```bash
npm test
```

Test xác nhận web đọc danh sách project, đọc `overview.md` và không có endpoint chat.