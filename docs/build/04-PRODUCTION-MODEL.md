# Mô hình Production

## Ý tưởng cốt lõi

Production bắt đầu từ một `Input Bundle`, không bắt đầu từ screen hoặc stage bắt buộc. Trước hết Agent xác định người dùng đã cung cấp gì, phần nào đáng tin, phần nào còn thiếu và output mong muốn là gì. Sau đó Agent tạo production graph nhỏ nhất nhưng phù hợp.

Đây là mô hình suy nghĩ chung cho production, không phải pipeline có số bước hoặc thứ tự cố định. Agent có thể bỏ qua, gộp, tách, lặp hoặc bổ sung bước tùy input và mục tiêu của project.

## Input Bundle

Input bundle có thể chứa bất kỳ tổ hợp nào của:

```text
intent/topic
script hoặc dialogue
narration audio
timestamp theo segment hoặc word
image, video, footage, music, subtitle
video reference hoặc style reference
visual preference và constraint
platform đích, aspect ratio, duration, quality, budget
```

Intake layer probe các file được cung cấp và tạo `Input Inventory`. Nó ghi nhận các sự thật như duration, resolution, codec, transcript, timestamp, speaker, ranh giới scene và rủi ro chất lượng. Agent phải suy luận từ inventory này thay vì đoán qua tên file.

## Luồng chính: tạo project mới từ đầu

```text
User intent
    ↓
Khám phá input và capability
    ↓
Brief và creative direction
    ↓
Proposal, option, cost và delivery promise
    ↓
Thống nhất direction giữa user và Agent
    ↓
Script và/hoặc narration nếu cần
    ↓
Visual concept và scene plan
    ↓
Sample đại diện
    ↓
Tạo asset và composition
    ↓
Preview, evidence, review và repair có mục tiêu
    ↓
Render cuối, đóng gói và publish
```

Đây là hình dạng thường gặp, không phải sequence thực thi cố định. Agent có thể gộp, bỏ qua, lặp lại, chạy song song hoặc thêm bước.

## Các nhánh thích nghi theo input

| Tài liệu ban đầu | Quyết định Agent có thể đưa ra |
| --- | --- |
| Chỉ có topic | Research nếu hữu ích, phát triển script, tạo voice, lập plan và làm visuals |
| Topic + script có sẵn | Giữ script, xác minh timing, rồi chọn voice và visual work |
| Script + voice audio | Đối chiếu audio với script, suy ra timing, bỏ qua TTS |
| Audio + timestamp hợp lệ | Dùng audio và timestamp làm nguồn thời gian, bỏ qua TTS và alignment |
| Audio chưa có timestamp | Chạy transcription/alignment, rồi lập kế hoạch visuals |
| Footage | Probe và phân tích footage, rồi tạo edit graph hoặc hybrid graph |
| Video reference | Phân tích cấu trúc và style để lấy cảm hứng, không dùng làm source footage |
| Image/video/music có sẵn | Register và dùng lại; chỉ tạo phần còn thiếu |
| Project PAD cũ chưa hoàn thành | Chỉ import voice asset; bỏ qua scene system cũ |

Nếu tài liệu cung cấp mâu thuẫn, Agent phải hiển thị mâu thuẫn. Agent không được âm thầm viết lại script hoặc audio do người dùng cung cấp.

## Các điểm quyết định trong production

### Brief và promise

Agent xác định kết quả dự định: educational explainer, animation, cinematic piece, screen demo, source-led edit, localization hoặc treatment khác. Đây là `delivery promise`, dùng để xác định quality bar phù hợp.

### Direction

Agent đề xuất direction hình ảnh và âm thanh, gồm style, motion language, mật độ thông tin, chiến lược asset, lựa chọn renderer và đánh đổi chi phí. Có thể chọn hoặc tạo style playbook.

### Sample

Trước khi batch generation tốn kém, Agent có thể tạo voice, visual, scene hoặc short sample đại diện. Người dùng có thể chỉnh direction khi chi phí của việc chọn sai còn thấp.

### Plan

Agent tạo plan trung lập với renderer: mỗi scene truyền đạt gì, điều gì thay đổi theo thời gian, cần asset nào, sự chú ý của người xem di chuyển ra sao và capability nào có thể thực hiện.

### Production

Agent gọi tool đã chọn và có thể phối hợp nhiều loại media. Text, data, diagram, code và relationship chính xác nên dùng representation deterministic hoặc có thể kiểm soát. Generative media phù hợp khi mục tiêu là diễn giải, không khí hoặc đa dạng hình ảnh.

### Review và repair

Agent review output thực tế, xác định vấn đề cụ thể và sửa đơn vị lỗi nhỏ nhất. Agent có thể quay lại plan, direction, asset hoặc lựa chọn renderer. Agent phải giữ scene tốt và so sánh candidate thay vì mù quáng tạo lại toàn bộ project.

## Lựa chọn style và composition

Hai quyết định độc lập phải được thể hiện riêng:

```text
Visual grammar / renderer family
  Loại ngôn ngữ hình ảnh nào phù hợp?

Runtime
  Engine nào thực thi ngôn ngữ đó?
```

Agent có thể chọn path theo template để nhanh, hoặc path atelier cho composition riêng có giá trị cao. Component tái sử dụng là cơ chế kỹ thuật, không phải yêu cầu mọi project phải có hình thức giống nhau.

## Graph linh hoạt, hậu quả được kiểm soát

Tự do của Agent phải đi kèm hậu quả nhìn thấy được:

```text
Agent thay đổi một decision
    ↓
thêm decision entry mới
    ↓
artifact bị ảnh hưởng thành stale hoặc superseded
    ↓
chỉ xem xét lại các task phụ thuộc
    ↓
tạo candidate và evidence mới
```

Hệ thống không áp đặt creative route, nhưng giữ cho route dễ hiểu và có thể đảo ngược.

## Voice trong production model

Voice generation là capability tùy chọn bình thường cho project mới. Voice từ project cũ dang dở là import path riêng được mô tả trong [`12-LEGACY-VOICE.md`](12-LEGACY-VOICE.md). Nó không được định nghĩa production model chính.
