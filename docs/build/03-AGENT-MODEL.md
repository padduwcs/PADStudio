# Mô hình Agent

## Mục đích

Tài liệu này định nghĩa cách Agent điều khiển PADStudio, đồng thời giữ hệ thống mở cho nhiều provider và phương thức kết nối Agent. Đây là build contract, không phải prompt để tạo một video cụ thể.

## Agent-first nghĩa là Agent dẫn dắt, không phải Agent không được kiểm soát

Agent sở hữu phần intelligence của production:

- diễn giải intent của người dùng
- hiểu tài liệu được cung cấp
- chọn hoặc ghép task graph
- chọn capability và tool
- quyết định đánh đổi sáng tạo và kỹ thuật
- ủy quyền công việc
- kiểm tra evidence
- sửa, chuyển hướng hoặc dừng
- giải thích decision

PAD sở hữu production substrate:

- cung cấp context và capability
- thực thi tool
- lưu artifact và event
- áp quyền hạn theo scope
- bảo vệ credential và operation tính phí
- cung cấp checkpoint và resume
- validate contract và sự thật kỹ thuật
- cung cấp evidence cho Agent và người dùng

PAD không được triển khai một creative director thứ hai cạnh tranh với Agent. Có thể dùng cơ chế deterministic để bảo vệ integrity, permission, cost, safety và contract validity.

## Vai trò Agent

| Vai trò | Trách nhiệm |
| --- | --- |
| Owner | Định nghĩa intent, constraint, permission và tiêu chí chấp nhận |
| Lead Agent | Sở hữu production graph và điều phối run |
| Specialist Agent | Thực hiện task được ủy quyền trong phạm vi rõ ràng, như research hoặc visual critique |
| Tool worker | Thực thi capability deterministic hoặc dựa trên provider |
| Review Agent | Kiểm tra artifact hoặc evidence đã render và đề xuất sửa |
| Board | Trình bày state và evidence; không phải Agent và không có creative authority |

Project đơn giản chỉ cần một Lead Agent. Multi-Agent operation là extension tùy chọn, không phải yêu cầu của core model.

## Trung lập với provider Agent

Agent provider là service hoặc runtime cung cấp khả năng suy luận. Nó độc lập với media provider và renderer.

```text
Agent provider:     Claude, Codex, Gemini, local model hoặc Agent khác
Media provider:     service TTS, image, video, music, stock hoặc analysis
Renderer:           Remotion, HyperFrames, Manim, Blender hoặc engine khác
```

Domain layer không được chứa concept riêng của provider. Behavior riêng của provider phải nằm trong Agent Adapter, capability adapter hoặc technology skill.

## Agent Adapter

Agent Adapter chuyển đổi giữa session contract ổn định của PAD và một integration Agent. Về khái niệm, nó hỗ trợ:

```text
start_session(project, permissions, context)
send_message(session, message)
receive_events(session)
invoke_or_route_tool(session, tool_request)
pause(session)
resume(session)
cancel(session)
close(session)
```

Transport cụ thể có thể là API, tiến trình CLI, MCP client, local runtime hoặc coding Agent bên ngoài. Adapter ghi provider, model, session, usage và capability, nhưng không quyết định production.

## Các phương thức kết nối được hỗ trợ

### Integrated session

PAD cung cấp chat surface và quản lý kết nối Agent. Agent nhận project context gọn và có thể gọi operation của PAD.

### MCP

MCP (Model Context Protocol) công bố tool và resource của PAD cho Agent bên ngoài tương thích. Agent có thể kiểm tra project, đọc artifact, gọi capability, lấy evidence và cập nhật run state qua interface chuẩn.

### CLI và workspace

Coding Agent có thể mở project workspace, đọc `AGENTS.md` cùng build/runtime instruction, chạy command, kiểm tra file và dùng project tool. Đây là kiểu tương thích mà OpenMontage sử dụng.

### API

Ứng dụng có thể gọi structured operation của PAD mà không cần chat Agent. Cách này hữu ích cho automation, testing và integration trong tương lai.

## Khởi tạo context

Mỗi Agent session mới nhận context từ nguồn bền vững, không phụ thuộc hội thoại trước:

```text
1. Định hướng system/build
2. Intent của người dùng và project brief
3. Input inventory và kết quả probe
4. Artifact được chọn hiện tại và run state
5. Skill cùng mô tả capability liên quan
6. Decision đang chờ, constraint và permission
7. Task hiện tại hoặc câu hỏi của người dùng
```

Bootstrap phải ngắn gọn, liên kết tới artifact có thẩm quyền và có thể refresh. Không được sao chép toàn bộ project history vào mọi prompt.

## Policy về quyền tự chủ của Agent

Chủ dự án chọn policy cho từng project hoặc run:

- `autopilot`: Agent tự tiến hành trong giới hạn budget và permission.
- `guided`: Agent hỏi trước action tính phí, thay đổi direction lớn hoặc publish.
- `manual`: Agent dừng tại các gate sáng tạo và production đã cấu hình.

Policy quyết định khi nào Agent phải hỏi, không giới hạn những khả năng sáng tạo mà Agent được phép cân nhắc.

## Ủy quyền Agent-to-Agent

Lead Agent có thể ủy quyền task bằng một task request có giới hạn:

```text
task_id
role or capability needed
input artifact references
expected output artifact
constraints
budget and deadline
review requirements
```

Agent được ủy quyền trả về proposal, artifact, candidate hoặc review. Nó không được âm thầm ghi đè artifact đã approve thuộc task khác. Lead Agent quyết định có chấp nhận kết quả hay không.

## Khả năng mở rộng của Agent

Khi thiếu capability, Agent có thể đề xuất extension theo project hoặc cấp hệ thống:

- custom script
- custom tool adapter
- custom skill
- custom playbook
- new provider integration
- new renderer adapter
- new task graph recipe

Quy trình extension được định nghĩa trong [`06-CAPABILITY-MODEL.md`](06-CAPABILITY-MODEL.md). Extension không phải lý do để bỏ qua contract về artifact, permission, cost hoặc review.

## Coding Agent mới bắt buộc phải làm gì

Trước khi thay đổi codebase, Agent phải:

1. Đọc `AGENTS.md` và [`00-START-HERE.md`](00-START-HERE.md).
2. Đọc task packet được giao.
3. Xác định tài liệu architecture và contract liên quan.
4. Nêu lại cách hiểu, phạm vi, giả định và kế hoạch kiểm tra.
5. Dừng và yêu cầu ADR khi task mâu thuẫn với boundary hoặc invariant đã chấp nhận.

Protocol bàn giao triển khai chi tiết nằm trong [`10-DEVELOPMENT-PROTOCOL.md`](10-DEVELOPMENT-PROTOCOL.md).
