# Tài liệu xây dựng PADStudio

Thư mục này là nguồn sự thật cao nhất về thiết kế và cách xây dựng PADStudio. Nó dành cho chủ dự án, developer và coding Agent trực tiếp xây dựng hệ thống.

Nó được tách khỏi tài liệu runtime một cách có chủ ý. Tài liệu ở đây giải thích cách hiểu, thiết kế, thay đổi và xây dựng PADStudio; không hướng dẫn production Agent tạo một video cụ thể.

## Mức độ ràng buộc hiện tại

Bộ tài liệu này là bản thiết kế ý tưởng ban đầu. Nó thống nhất mục tiêu, luồng hoạt động, ranh giới và nguyên tắc để người và Agent cùng xây dựng có kiểm soát; nó chưa phải đặc tả kỹ thuật khóa cứng.

Các mô hình domain, capability, workspace và contract là từ vựng chung cùng các đề xuất thiết kế. Tên concept, field, schema, trạng thái, API, cấu trúc thư mục và công nghệ được nêu trong đó không mặc nhiên là yêu cầu phải triển khai ngay. Chỉ chốt chi tiết khi một nhu cầu thực tế xuất hiện và đã được kiểm chứng.

Lộ trình phát triển đầy đủ nằm ở [`13-DEVELOPMENT-ROADMAP.md`](13-DEVELOPMENT-ROADMAP.md). Khi một chi tiết tạm thời mâu thuẫn với luồng hoặc nguyên tắc chung, cần nêu vấn đề với owner thay vì âm thầm coi chi tiết đó là kiến trúc cuối cùng.

## Thứ tự đọc

1. [`00-START-HERE.md`](00-START-HERE.md)
2. [`01-CHARTER.md`](01-CHARTER.md)
3. [`02-ARCHITECTURE.md`](02-ARCHITECTURE.md)
4. [`13-DEVELOPMENT-ROADMAP.md`](13-DEVELOPMENT-ROADMAP.md)
5. Đọc tài liệu domain, Agent, workspace, contract hoặc quality liên quan đến task.
6. Đọc task packet và các quyết định đã được chấp nhận mà task liên kết tới.

## Danh mục tài liệu

| Tài liệu | Mục đích |
| --- | --- |
| [`01-CHARTER.md`](01-CHARTER.md) | Mục đích, phạm vi, ngoài phạm vi, nguyên tắc và kết quả cần đạt |
| [`02-ARCHITECTURE.md`](02-ARCHITECTURE.md) | Hình dạng hệ thống, ranh giới, phụ thuộc và mô hình điều khiển |
| [`03-AGENT-MODEL.md`](03-AGENT-MODEL.md) | Session Agent, adapter, quyền tự chủ, bàn giao và Agent bên ngoài |
| [`04-PRODUCTION-MODEL.md`](04-PRODUCTION-MODEL.md) | Input linh hoạt, task graph, luồng production và quyết định sáng tạo |
| [`05-DOMAIN-MODEL.md`](05-DOMAIN-MODEL.md) | Khái niệm domain, artifact, identity, lineage và vòng đời |
| [`06-CAPABILITY-MODEL.md`](06-CAPABILITY-MODEL.md) | Tool, provider, renderer, skill, playbook và extension |
| [`07-WORKSPACE.md`](07-WORKSPACE.md) | Cấu trúc repository và runtime workspace |
| [`08-CONTRACTS.md`](08-CONTRACTS.md) | Nguyên tắc giao tiếp, schema và ranh giới protocol được hình thành dần khi triển khai |
| [`09-QUALITY.md`](09-QUALITY.md) | Mô hình chất lượng, bằng chứng, review, sửa lỗi và đánh giá |
| [`10-DEVELOPMENT-PROTOCOL.md`](10-DEVELOPMENT-PROTOCOL.md) | Cách người và coding Agent làm việc trên codebase |
| [`11-GLOSSARY.md`](11-GLOSSARY.md) | Thuật ngữ và chữ viết tắt bằng ngôn ngữ dễ hiểu |
| [`12-LEGACY-VOICE.md`](12-LEGACY-VOICE.md) | Ranh giới hẹp để lấy voice từ project PADStudio cũ |
| [`13-DEVELOPMENT-ROADMAP.md`](13-DEVELOPMENT-ROADMAP.md) | Các chặng phát triển từ nền tảng ban đầu đến hệ thống hoàn thiện |
| [`adr/`](adr/README.md) | Hồ sơ bền vững về các quyết định kiến trúc đã chấp nhận |
| [`tasks/`](tasks/README.md) | Mẫu packet để giao việc triển khai |

## Quyền hạn và cách thay đổi

`docs/build/` là nguồn định hướng chuẩn cho việc xây dựng, nhưng ở giai đoạn hiện tại chỉ mục tiêu, luồng, ranh giới và nguyên tắc được xem là nền tảng ổn định. ADR ghi lại một quyết định kiến trúc khi quyết định đó thực sự cần thiết. Task packet có thể làm rõ một việc triển khai nhưng không được âm thầm định nghĩa lại kiến trúc. Trạng thái hiện tại, workaround tạm thời và chi tiết thử nghiệm không trở thành nguyên tắc chỉ vì đã được ghi vào task.

Thay đổi code nhỏ không cần viết lại kiến trúc. Thay đổi làm ảnh hưởng đến boundary, invariant, public contract hoặc hướng thiết kế phải có ADR và cập nhật tài liệu build liên quan.

Hướng dẫn runtime dành cho Agent sử dụng PADStudio để làm video phải nằm trong khu vực tài liệu runtime riêng và cố ý không thuộc thư mục này.
