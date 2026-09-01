# Kiến trúc hệ thống

## Vị trí kiến trúc

PADStudio là nền tảng production theo hướng Agent-native. Agent là control plane cho các quyết định sáng tạo và workflow. PAD là production substrate: công bố capability, thực thi tool, lưu artifact, ghi event, áp quyền hạn và làm evidence hiển thị được.

Không có yêu cầu phải tạo một creative orchestrator thứ hai ở application-level để cạnh tranh với Agent. Service deterministic có thể validate, persist, resume và execute operation, nhưng không quyết định hướng sáng tạo của video.

## Mức độ của kiến trúc

Sơ đồ dưới đây mô tả các trách nhiệm và ranh giới logic cần giữ, không bắt buộc phải tách thành đúng số service, process hoặc package như hình. Cách triển khai cụ thể sẽ được chọn dần khi các lát cắt thực tế cho thấy cần gì.

## Hình dạng hệ thống

```text
                         ┌────────────────────┐
                         │ User / owner       │
                         └─────────┬──────────┘
                                   │ intent, materials, approvals
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent control plane                                          │
│                                                             │
│ Lead Agent / external Agent / specialist Agents             │
│ reasoning, planning, delegation, selection, review          │
└──────────────────────────┬──────────────────────────────────┘
                           │ MCP / CLI / API / workspace
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ PAD agent surface                                            │
│                                                             │
│ context bootstrap · capability registry · task operations   │
│ artifact operations · run/checkpoint · cost/permission      │
│ evidence queries · extension registration                    │
└───────────────┬────────────────────┬────────────────────────┘
                │                    │
                ▼                    ▼
┌────────────────────────┐  ┌────────────────────────────────┐
│ Domain and contracts    │  │ Execution capabilities           │
│ projects, artifacts,    │  │ local tools, cloud providers,   │
│ task graphs, decisions, │  │ analysis, audio, graphics,      │
│ review, lineage         │  │ video, renderers, publishing    │
└──────────────┬─────────┘  └───────────────┬────────────────┘
               │                            │
               └──────────────┬─────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Durable workspace                                           │
│ inputs · artifacts · media · runs · events · candidates      │
│ checkpoints · decisions · evidence · renders · history       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
                    Board / human surface
```

## Ranh giới trách nhiệm

### User surface

Tiếp nhận intent, nhận tài liệu, cấp quyền, trả lời câu hỏi, review evidence và approve decision theo policy. User surface không cần hiểu implementation của từng provider.

### Agent control plane

Diễn giải brief, khám phá capability, tạo production graph, chọn và gọi capability, quyết định khi nào cần hỏi, review kết quả, sửa hoặc chuyển hướng công việc và giải thích decision.

### PAD agent surface

Cung cấp interface ổn định cho Agent. Nó chuyển request của Agent thành domain operation và tool execution, trả structured result, đồng thời cung cấp context liên quan mà không bắt Agent nhớ các hội thoại trước.

### Domain layer

Định nghĩa concept và invariant độc lập với model vendor, UI framework, provider SDK hoặc renderer. Nó sở hữu identity và lineage của artifact, reference của project, task state, decision, ngữ nghĩa approval và quy tắc tương thích.

### Capability layer

Chứa tool và adapter cho analysis, media generation, audio, graphics, composition, rendering, enhancement và publishing. Một capability có thể local, remote, synchronous, asynchronous, deterministic hoặc stochastic.

### Workspace layer

Lưu input, output, history, event, checkpoint và evidence để production có thể kiểm tra và tiếp tục.

### Board

Đọc workspace và trình bày production state, activity, candidate, evidence, decision và yêu cầu approval. Board là observer và control surface, không phải nguồn creative truth.

## Các phương thức tương tác

PAD phải hỗ trợ cùng một project qua nhiều access mode:

| Mode | Cách dùng |
| --- | --- |
| Integrated Agent session | PAD host hội thoại và kết nối hội thoại với project |
| MCP | Agent bên ngoài tương thích khám phá tool và resource của PAD qua protocol chuẩn |
| CLI/workspace | Coding Agent đọc instruction, file và command-line tool |
| HTTP/API | Ứng dụng hoặc orchestration service khác gọi structured operation |
| Agent-to-Agent delegation | Lead Agent ủy quyền một task có giới hạn cho Agent khác |

Đây là các interface tới cùng domain và workspace, không phải các production system tách rời.

## Task graph động

Agent tạo graph task dựa trên input sẵn có và output mong muốn:

```text
Input inventory
      │
      ▼
Agent chọn graph
      │
      ├── research (tùy chọn)
      ├── script (tùy chọn)
      ├── voice / audio (tùy chọn)
      ├── alignment / transcription (khi cần)
      ├── visual direction
      ├── scene planning
      ├── asset acquisition hoặc generation
      ├── animation / composition
      ├── edit / audio / subtitles
      ├── review / repair
      └── publish
```

Task tạo artifact và có thể phụ thuộc artifact khác. Graph có thể rẽ nhánh, chạy song song task độc lập, thêm bước còn thiếu hoặc quay lại decision trước đó. Repair loop là một phần của run history; không cần làm hỏng artifact gốc.

## Quy tắc phụ thuộc

1. Domain contract không import provider SDK.
2. Provider implementation không định nghĩa domain concept.
3. Renderer tiêu thụ plan trung lập với renderer hoặc composition input rõ ràng.
4. UI đọc domain/application interface; không soi vào nội bộ provider.
5. Tool trả structured result; không âm thầm mutate state không liên quan của project.
6. Runtime job có thể emit event, nhưng event không thay thế artifact hoặc checkpoint.
7. Build docs không được import vào production code; nó hướng dẫn con người và coding Agent.
8. Runtime instruction có thể reference capability nhưng không được định nghĩa lại build architecture.

## Ranh giới lỗi

Mọi operation có hậu quả đáng kể phải làm rõ bốn điều:

```text
đã yêu cầu gì
đã thử thực hiện gì
đã tạo ra gì
evidence hoặc error nào phát sinh
```

Provider không khả dụng, input không hợp lệ, render lỗi, external task không chắc chắn hoặc dependency thiếu phải là state được hiển thị. Không được âm thầm biến nó thành một creative treatment khác.

## Bảo mật và quyền hạn

Credential được giữ ở execution layer và tham chiếu bằng handle. Không sao chép credential vào prompt, artifact, log hoặc source được sinh. Quyền Agent phải giới hạn theo project và operation; quyền đọc, ghi, gọi tính phí, cài extension, xóa và publish phải được tách riêng.
