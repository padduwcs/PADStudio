# PADStudio — router cho Agent

Trước tiên xác định yêu cầu thuộc **vận hành project video** hay **phát triển codebase**. Hai chế độ có đường đọc khác nhau; không trộn chúng.

## 1. Vận hành project video

Áp dụng khi người dùng muốn tạo, tiếp tục, phân tích, dựng, review hoặc xuất video bằng PADStudio mà không yêu cầu sửa mã nguồn.

1. Chỉ đọc [`PADSTUDIO-AGENT-RUNTIME.md`](PADSTUDIO-AGENT-RUNTIME.md).
2. Xác định đúng một `project-id`. Với project đã tồn tại, bắt đầu bằng `npm run project:resume -- <project-id>`.
3. Chỉ đọc skill nằm trong `work.relevantSkillIds`, hoặc skill gắn với tool/công việc sắp làm.
4. Chỉ mở context/dataset chi tiết khi trường trong resume chỉ ra cần thiết.
5. Mọi asset và output có giá trị phải đi qua Resource/Result/Artifact/Delivery của đúng project. Không tự sao chép preview/render ra ngoài project hoặc gọi một file là `final` để thay cho delivery hợp lệ.

Trong chế độ này, không đọc `docs/build/`, `reports/`, `test/`, lịch sử Git, `PADSTUDIO-REFERENCE.md`, `PADSTUDIO-AGENT-REFERENCE.md` hoặc thư mục của project khác, trừ khi một lỗi cụ thể buộc phải điều tra. Không quét toàn bộ `.padstudio/projects`; luôn truyền project ID tường minh. Web chỉ quan sát; thay đổi project qua CLI/tool contract. Trạng thái `final` chỉ có sau exact user acceptance, QA hợp lệ và `video.export-delivery` tạo Delivery Result; tên file hoặc bản sao thủ công không tạo ra trạng thái đó.

Nếu phát hiện lỗi sản phẩm cần sửa code, báo rõ và chuyển sang chế độ phát triển trước khi đọc tài liệu build.

## 2. Phát triển PADStudio

Áp dụng khi người dùng yêu cầu sửa code, test, contract, tài liệu hệ thống hoặc hành vi runtime.

Trước khi thay đổi:

1. Đọc [`docs/build/PADSTUDIO-DESIGN.md`](docs/build/PADSTUDIO-DESIGN.md).
2. Đọc [`docs/build/PADSTUDIO-CURRENT-DIRECTION.md`](docs/build/PADSTUDIO-CURRENT-DIRECTION.md).
3. Đọc phần liên quan trong [`docs/build/PADSTUDIO-BUILD-OUTLINE.md`](docs/build/PADSTUDIO-BUILD-OUTLINE.md).
4. Đọc [`docs/build/DEVELOPMENT-PROTOCOL.md`](docs/build/DEVELOPMENT-PROTOCOL.md).
5. Kiểm tra code và test liên quan; nêu mục tiêu, phạm vi, giả định và cách xác minh.

Chỉ đọc spec Phase/Package khi thay đổi thực sự chạm phần đó. `docs/build/HISTORICAL-DOCUMENTS.md` và các báo cáo cũ chỉ là lịch sử, không phải trạng thái hiện hành.

## Quy tắc chung

- Agent chọn việc sáng tạo; PADStudio lưu project, chạy công cụ và giữ provenance.
- Không ép mọi project qua một workflow cố định và không để provider/UI quyết định phần lõi.
- Không tự đổi ranh giới, lưu trữ, quyền hạn hoặc hướng thiết kế đã chốt.
- Bảo toàn công việc người dùng và thay đổi ngoài phạm vi; không reset phá hủy.
- Runtime chi tiết chỉ đọc theo nhu cầu tại [`PADSTUDIO-AGENT-REFERENCE.md`](PADSTUDIO-AGENT-REFERENCE.md).
