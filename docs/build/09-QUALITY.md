# Chất lượng và Đánh giá

## Quan điểm về chất lượng

Render ra file có thể phát là điều kiện cần nhưng chưa đủ. Chất lượng được đánh giá theo delivery promise của project, tài liệu đã cung cấp, direction được chọn và evidence thực tế.

## Delivery promise

Trước production, Agent xác định output cam kết là loại gì:

```text
educational explainer
animation
cinematic piece
screen demo
source-led edit
localization
hybrid
hoặc một treatment được mô tả rõ khác
```

Promise quyết định quality profile liên quan. Một technical diagram tối giản và một cinematic montage không nên bị đánh giá bằng cùng một bộ visual metric.

## Ba lớp chất lượng

```text
Technical QA
  Output có tồn tại, compile, phát được và đáp ứng media constraint không?

Semantic review
  Nó có truyền đạt đúng fact, relationship, action và timing dự định không?

Editorial review
  Nó có mạch lạc, dễ đọc, nhịp tốt, có bản sắc và đáng xem không?
```

Technical check có thể deterministic. Semantic và editorial check kết hợp rule có cấu trúc, frame evidence thực tế, critique của Agent và judgment của con người khi phù hợp.

## Review evidence

Một review finding phải chỉ ra:

```text
candidate
scene hoặc artifact
frame/timestamp/field
vấn đề quan sát được
severity
fix đề xuất
status
```

Reviewer phải:

- accurate: chỉ tới điều quan sát được
- complete: kiểm tra issue tương tự có xuất hiện nơi khác không
- constructive: giải thích cần thay đổi gì

“Trông tệ” không phải finding hữu ích. “Scene 03 tại frame 12.4s có hai khối text mạnh ngang nhau, khiến phần so sánh được đọc không có focal point; giảm còn một claim chính và một label phụ” là finding hữu ích.

## Gate preview và sample

Hệ thống nên hỗ trợ evidence tăng dần:

```text
concept / mood direction
        ↓
sample voice hoặc visual đại diện
        ↓
scene still / contact sheet
        ↓
short preview
        ↓
full render
        ↓
final review
```

Không nên bắt đầu batch generation tốn kém trước khi sample đại diện đủ đáng tin, trừ khi chủ dự án chủ động chọn khác.

## Repair loop

```text
candidate
  → evidence
  → issue classification
  → thay đổi input chịu trách nhiệm nhỏ nhất
  → rerun task bị ảnh hưởng
  → so sánh candidate mới
```

Đối tượng có thể sửa là brief, direction, scene plan, asset, tool parameter, composition hoặc renderer choice. Agent không nên tạo lại toàn bộ project khi issue chỉ cục bộ.

Giới hạn repair do policy quyết định. Bounded loop mặc định ngăn drift ngẫu nhiên; Agent có thể yêu cầu thêm work kèm lý do và budget. Nếu tập issue không cải thiện, run dừng với giải thích rõ thay vì tiếp tục vô hạn.

## Chấp nhận Candidate

Candidate state phải phân biệt:

```text
draft        work in progress
reviewable   có đủ evidence để kiểm tra
accepted     đạt quality floor đã cấu hình
published    được chọn và đóng gói để giao
rejected     chủ động không chọn
superseded   bị candidate mới thay thế
degraded     chỉ dùng được dưới promise thấp hơn đã approve rõ ràng
```

Technical pass không được tự động promote candidate chưa editorially review thành `published`.

## Automated check

Platform nên cung cấp check tái sử dụng cho:

- schema và contract validity
- asset existence và provenance
- timing coverage và gap
- media dimension, fps, codec và duration
- audio level, clipping và cân bằng narration/music
- subtitle hoặc transcript alignment
- safe area và text legibility
- frame đen, thiếu hoặc hỏng
- semantic key/obligation coverage nếu có
- scene repetition và slideshow risk
- delivery-promise compliance

Các check này là evidence và routing signal. Chúng không phải vật thay thế phổ quát cho taste.

## Chiến lược testing

```text
Contract tests       schema và compatibility
Unit tests           domain, registry và policy logic thuần
Integration tests    tool adapter, workspace và run persistence
Fixture tests        input đã biết và artifact shape kỳ vọng
Render smoke tests   composition deterministic nhỏ
Quality tests        kiểm tra frame/audio/evidence
Evaluation replays   run lặp lại được trên project đại diện
Manual review        chấp nhận hình ảnh và editorial
```

Quality fixture phải có nhiều hơn một visual style và nhiều hơn một input mode. Hệ thống chỉ pass template mặc định của chính nó chưa được chứng minh là hữu ích nói chung.
