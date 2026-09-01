# Mô hình Capability

## Mục đích

Capability model là hướng thiết kế để PADStudio có thể mở rộng. Agent hỏi hệ thống có thể làm gì; Agent không nên giả định một provider, SDK, renderer hoặc ngôn ngữ lập trình cụ thể.

Registry, selector, skill, playbook và renderer abstraction là các ý tưởng để giải quyết nhu cầu mở rộng. Chỉ xây phần cần thiết cho capability đang được triển khai; không cần dựng toàn bộ registry hoặc abstraction framework từ trước.

## Capability và implementation khác nhau thế nào

```text
Capability     có thể làm gì, ví dụ text_to_speech
Tool           implementation có thể thực thi của capability đó
Provider       service/model/library đứng sau tool
Runtime        tiến trình local, GPU local, remote API hoặc execution hybrid
Skill          kiến thức để dùng capability tốt
Playbook       direction sáng tạo và chất lượng có thể tái sử dụng
```

Ví dụ:

```text
Capability: voice_generation
Tools:      provider A, provider B, offline provider
Agent:      mọi Agent tương thích
Renderer:   không phụ thuộc; chọn sau cho visual composition
```

## Capability registry

Registry là góc nhìn cập nhật của Agent về các khả năng sẵn có. Một capability entry nên mô tả:

- name và version
- capability family
- provider và runtime
- availability và lý do nếu unavailable
- input/output schema
- use case phù hợp nhất và use case không phù hợp
- dependency và yêu cầu cài đặt
- behavior deterministic hoặc stochastic
- yêu cầu tài nguyên
- cost và duration ước tính
- behavior khi retry và resume
- khả năng idempotency
- side effect
- fallback candidate
- skill liên quan
- phương thức verification
- quality đo được hoặc reliability lịch sử nếu có

Registry phải phân biệt “chưa cài”, “chưa cấu hình”, “tạm thời unavailable”, “degraded” và “available”. Không được tuyên bố chất lượng chỉ dựa vào metadata.

## Khám phá trước khi cam kết

Trước khi Agent cam kết vào path tốn kém hoặc có hậu quả lớn, Agent phải lấy được support envelope:

```text
Hiện tại chạy được gì
Thứ gì unavailable
Có thể mở khóa thêm gì
Mỗi option tốn bao nhiêu
Quality/trade-off nào đi kèm
Cần input gì
Fallback làm thay đổi điều gì
```

Người dùng thấy bản diễn giải ngắn gọn của envelope này thay vì raw registry data.

## Selector và direct tool

Selector có thể route một request generic tới provider phù hợp dựa trên preference của user, availability, task fit, quality, cost, latency và continuity. Agent cũng có thể chọn concrete tool khi user hoặc task yêu cầu.

Selector là tiện ích, không phải authority. Selector không được âm thầm thay đổi delivery promise, voice identity, visual treatment hoặc renderer family. Thay đổi quan trọng phải được ghi nhận và hiển thị.

## Kiến trúc Skill

```text
Core skills
  Cách concept và contract của PAD hoạt động

Production skills
  Cách plan, create, review và publish một loại video

Technology/provider skills
  Renderer, model, API hoặc local tool thực sự hoạt động thế nào
```

Agent chỉ load skill liên quan tới task hiện tại. Skill nên có strengths, limitations, parameters, failure modes, examples và hướng dẫn verification.

## Playbook

Playbook có thể định nghĩa:

- design read và mood
- màu sắc và typography
- quy tắc composition
- motion language và pacing
- audio direction
- hướng dẫn tạo asset
- mật độ thông tin
- variation được phép
- anti-pattern
- quality gate
- ngoại lệ có chủ ý

Playbook hướng dẫn Agent và reviewer. Nó không được hard-code tên component của một renderer vào domain model.

## Trừu tượng hóa Renderer

Renderer là capability được chọn theo visual family và constraint của project. Adapter có thể gồm React/frame composition, HTML/CSS/GSAP, programmatic mathematical animation, vector/canvas animation, 3D và media assembly.

Kiến trúc tách riêng:

```text
Renderer family: visual grammar và treatment
Runtime:         engine thực thi visual grammar đó
Composition mode: templated hoặc bespoke/atelier
```

Agent có thể dùng nhiều renderer trong một project nếu edit/composition contract hỗ trợ. Thay đổi runtime phải luôn explicit.

## Extension

Khi không có capability phù hợp, Agent có thể đề xuất extension. Đề xuất phải nêu:

```text
gap cần giải quyết
option hiện có đã kiểm tra
loại extension
input và output
side effect
cost và dependency
verification
scope: chỉ project hoặc tái sử dụng
```

Extension nên idempotent khi có thể, tạo artifact đã khai báo, tôn trọng permission và được log như decision. Extension của một project không được âm thầm trở thành global dependency.

## Cost và side effect

Mọi tool tính phí hoặc có hậu quả đáng kể phải hỗ trợ estimate, authorization, execution và reconciliation. Hệ thống ghi estimated cost, actual cost, provider request ID, result và failure state.

Retry không mặc nhiên an toàn với external operation. Tool phải khai báo có hỗ trợ idempotency, provider-side lookup, resume hoặc compensation hay không.

## Provenance

Mỗi media asset phải mang đủ thông tin để trả lời:

```text
Nó đến từ đâu?
Tool/provider/model nào đã tạo hoặc tải nó?
Prompt, seed hoặc source nào đã được dùng?
Chi phí là bao nhiêu?
License hoặc permission nào được áp dụng?
Scene và candidate nào đang sử dụng nó?
```

Provenance là một phần của capability contract, không phải ghi chú tùy chọn thêm sau khi publish.
