# Domain model

## Mục đích của domain

Domain model mô tả những thực thể bền vững mà PADStudio có thể cần làm việc cùng. Nó nên độc lập với UI page, vendor Agent, provider SDK, render engine và ngôn ngữ implementation hiện tại.

Danh sách concept dưới đây là từ vựng chung và giả thuyết thiết kế ban đầu. Không phải project nào cũng cần mọi concept, và chưa cần biến từng concept thành class, bảng dữ liệu hoặc schema trước khi có nhu cầu thực tế.

## Concept cốt lõi

| Concept | Ý nghĩa |
| --- | --- |
| Project | Workspace production của người dùng và các output được chọn |
| Input | Tài liệu hoặc intent do người dùng hay nguồn bên ngoài cung cấp |
| Input Inventory | Mô tả đã xác minh về input và constraint của chúng |
| Brief | Mục tiêu, audience, platform, tone và delivery promise đã được diễn giải |
| Script | Nội dung nói hoặc viết có cấu trúc, có thể kèm timing và cue |
| Voice Take | Một bản trình diễn audio cụ thể, có provenance và có thể kèm alignment |
| Alignment | Ánh xạ giữa audio với word, segment hoặc beat |
| Beat Map | Các đơn vị có ý nghĩa theo thời gian để phối hợp thay đổi hình ảnh |
| Direction | Quyết định về visual, motion, audio và taste của production |
| Scene Plan | Plan trung lập với renderer về điều mỗi scene truyền đạt và thực hiện |
| Asset | Media source, media được tạo hoặc media phái sinh |
| Asset Manifest | Danh mục và provenance của asset được candidate sử dụng |
| Edit Plan | Quyết định về timeline, layer, audio, subtitle và transition |
| Composition | Dữ liệu theo renderer đã chuẩn bị để render |
| Candidate | Output hoặc kết quả trung gian có thể so sánh |
| Review/Evidence | Finding gắn với artifact, frame, timestamp và check |
| Run | Một lần thử thực thi production graph |
| Checkpoint | Điểm lưu bền vững cho tiến độ, decision và resume |
| Decision | Lựa chọn có ý nghĩa, kèm phương án, lý do và authority |
| Capability | Một loại công việc hệ thống có thể thực hiện |
| Tool | Implementation có thể thực thi của capability |
| Provider | Service, model, library hoặc local runtime đứng sau tool |
| Renderer | Tool/runtime biến composition thành frame video |
| Skill | Kiến thức dạy Agent dùng capability |
| Playbook | Hướng dẫn có thể tái sử dụng về sáng tạo và chất lượng |

## Artifact graph

Project là một artifact graph thay vì một state object mutable khổng lồ.

```text
Brief ───────────────┐
                     ▼
Script ───────► Direction ──────┐
   │                            ▼
   ├──► Voice Take ─► Alignment ─► Beat Map
   │                                  │
   └──────────────────────────────────┼──► Scene Plan
                                      │          │
                         Asset Manifest ◄────────┘
                                      │
                                      ▼
                                  Edit Plan
                                      │
                                      ▼
                                  Composition
                                      │
                                      ▼
                              Candidate / Render
                                      │
                                      ▼
                              Review / Evidence
```

Đây chỉ là minh họa. Project không có narration có thể bỏ qua Script, Voice Take và Alignment. Project dẫn dắt bởi footage có thể bắt đầu từ Input Inventory và source analysis. Agent tạo các edge phù hợp.

## Artifact envelope

Mọi artifact bền vững nên có envelope chung bao quanh content riêng theo type:

```json
{
  "artifactId": "...",
  "type": "scene_plan",
  "schemaVersion": "1.0",
  "revision": 1,
  "status": "draft",
  "createdBy": {
    "kind": "agent",
    "provider": "...",
    "model": "...",
    "sessionId": "..."
  },
  "inputRefs": ["brief-...", "direction-..."],
  "contentHash": "...",
  "createdAt": "...",
  "content": {}
}
```

Envelope phải ổn định. Schema của `content` tiến hóa độc lập theo từng artifact type.

## Quy tắc nguồn sự thật

1. Input do người dùng cung cấp được bảo toàn và không mutate tại chỗ.
2. Artifact bền vững là các revision append-only; kết quả mới supersede kết quả cũ thay vì xóa nó.
3. Project index trỏ tới artifact và candidate được chọn; không chứa toàn bộ history.
4. Lineage được thể hiện rõ bằng `inputRefs` trực tiếp và content hash.
5. Một thay đổi chỉ invalidate hoặc reopen artifact phụ thuộc vào nó.
6. Hội thoại là context, không phải record chuẩn của decision hoặc result.
7. Candidate được chọn là một pointer, không phải promotion phá hủy làm mất các phương án khác.
8. Evidence thuộc về candidate và đúng input/render configuration mà nó đã kiểm tra.

## Từ vựng vòng đời

Status là sự thật của domain, không phải creative workflow bị áp đặt:

```text
draft → proposed → approved → running → completed
                         ├────► rejected
                         ├────► superseded
                         └────► failed / interrupted
```

Artifact có thể mang status `stale` khi revision của input thay đổi. Candidate chỉ được `degraded` khi quality policy và label hiển thị cho người dùng cho phép rõ ràng.

## Project index

Project index chỉ nên chứa identity ổn định và các reference được chọn:

```text
projectId
title / user metadata
selected brief, direction, voice, scene plan, candidate
active run reference
approval policy
workspace location
```

Content chi tiết, history, event và media nằm trong store riêng của chúng.

## Identity của run và candidate

Mỗi execution có một `runId`. Mỗi output có ý nghĩa có `candidateId` hoặc artifact ID. Retry phải phân biệt được với một creative attempt mới. External task ID, provider request ID, cost entry và evidence phải link ngược về run và candidate.

## Identity của decision

Decision có identity ổn định theo subject. Nếu Agent đổi lựa chọn, nó append decision mới cùng subject và ghi lại decision nào bị supersede. History vẫn hiển thị; lựa chọn hiện tại được suy ra từ entry hợp lệ mới nhất.
