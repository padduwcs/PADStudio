# Tuyên ngôn dự án

## Mục đích

Xây dựng một studio sản xuất video chuyên nghiệp và linh hoạt: người dùng có thể cung cấp từ một ý tưởng đơn giản đến gần như trọn bộ gói production, sau đó để một Agent đủ năng lực xác định phần còn thiếu và điều phối các capability sẵn có.

PADStudio phải biến production nghiêm túc thành quy trình có thể lặp lại mà không ép mọi project đi qua cùng một chuỗi bước, cũng không khóa hệ thống vào một Agent, provider, renderer hay ngôn ngữ lập trình duy nhất.

## Cam kết chính

Người dùng có thể bắt đầu từ một ý định và kết thúc bằng video có thể review, truy vết và publish. Hệ thống làm cho đường đi trở nên nhìn thấy được, bảo toàn quyết định cùng kết quả trung gian, và cho phép người dùng can thiệp mà không làm mất phần việc hữu ích.

## Các điểm bắt đầu sản phẩm phải hỗ trợ

- Chỉ có ý tưởng hoặc chủ đề.
- Chủ đề và script đã chuẩn bị.
- Script và định hướng voice mong muốn.
- File audio narration đã hoàn thành.
- Audio kèm timestamp theo segment hoặc word.
- Footage, hình ảnh, nhạc, subtitle hoặc video tham chiếu có sẵn.
- Bất kỳ tổ hợp nào của các loại trên.
- Project PADStudio cũ còn dang dở, trong đó asset có giá trị để dùng lại là voice đã tạo.

Agent quyết định tài liệu nào có thể dùng, phần nào cần xác minh, task nào có thể bỏ qua hoặc phải bổ sung.

## Trong phạm vi

- Tạo project và điều phối production do Agent dẫn dắt.
- Nhiều phương thức kết nối và provider Agent.
- Task graph production động thay cho workflow page cố định.
- Khám phá capability cho tool local, provider cloud và render engine.
- Skill, playbook và công thức pipeline có cấu trúc.
- Artifact, candidate, run, checkpoint, decision và evidence bền vững.
- Input dạng text, audio, timestamp, video, image, reference và input hỗn hợp.
- Tạo voice cho project mới.
- Import chỉ voice từ project cũ còn dang dở.
- Workflow preview, review, sửa có mục tiêu, so sánh và publish.
- Tool, provider, renderer và Agent adapter có thể mở rộng.

## Ngoài phạm vi một cách chủ ý

- Lấy scene generator cũ của PADStudio làm nền tảng cho thiết kế mới.
- Di trú hoặc giữ scene, layout hay quyết định Motion Canvas cũ như creative truth.
- Bắt mọi project phải dùng narration, research, image generation hoặc một renderer cụ thể.
- Nhúng API của một vendor model vào domain layer.
- Tạo một điểm thẩm mỹ phổ quát để quyết định mọi loại video có tốt hay không.
- Xây mọi provider và capability media trước khi hiểu các contract cốt lõi.
- Coi số lượng tool hoặc skill lớn là bằng chứng của chất lượng.
- Che giấu fallback suy giảm dưới trạng thái thành công.

## Nguyên tắc thiết kế

### Agent là control plane sáng tạo

Agent diễn giải intent, chọn đường đi, sắp xếp công việc, ủy quyền task, đánh giá kết quả và đổi hướng khi evidence yêu cầu. PAD cung cấp môi trường cùng operation đáng tin cậy; PAD không tạo ra một bộ quyết định sáng tạo cạnh tranh với Agent.

### Hệ thống thích nghi với input

Điểm vào là input bundle và intent, không phải số thứ tự page. Hệ thống kiểm kê thứ đang có, probe nó và đưa kết quả cho Agent. Artifact còn thiếu trở thành task; artifact đã có được dùng lại.

### Contract tạo ra tự do

Schema, tool contract và lineage của artifact không áp đặt kết quả sáng tạo. Chúng cho phép nhiều Agent và implementation phối hợp mà không phải đoán ý nghĩa của một kết quả.

### Tách quyết định khỏi kết quả

Suy luận của Agent là context hữu ích, nhưng sự thật bền vững là artifact, input của nó, evidence và decision đã promote nó. Lịch sử hội thoại không bao giờ được là nơi duy nhất lưu một quyết định production.

### Tối ưu cho hội tụ

Hệ thống phải làm cho việc preview, kiểm tra, so sánh và sửa đơn vị lỗi nhỏ nhất trở nên rẻ, nhanh. Không được liên tục tạo lại toàn bộ production khi chỉ một scene hoặc asset sai.

### Giám sát của con người có thể cấu hình

Chủ dự án có thể chọn autopilot, guided hoặc manual approval. Hành động tính phí, hành động phá hủy, thay đổi sáng tạo lớn và publish phải hiển thị theo policy.

### Khả năng mở rộng là tính năng hạng nhất

Khi thiếu capability, Agent có thể đề xuất adapter, tool, skill, playbook hoặc workflow mới. Extension phải rõ ràng, kiểm tra được, lặp lại được và được ghi nhận.

### Kiến trúc ổn định nhưng có thể tiến hóa

Tài liệu kiến trúc mô tả trách nhiệm và boundary bền vững. ADR đã chấp nhận là cơ chế tiến hóa chúng. Chi tiết triển khai tạm thời thuộc task hoặc status document, không thuộc định nghĩa kiến trúc của hệ thống.

## Kết quả cần đạt

Thiết kế được xem là đạt khi:

1. Developer hoặc coding Agent mới hiểu hệ thống từ build docs mà không cần đọc hội thoại cũ.
2. Người dùng có thể bắt đầu từ nhiều tổ hợp text, script, audio, timing, footage và reference.
3. Agent chọn hoặc ghép đường production phù hợp mà không bị khóa vào thứ tự page.
4. Có thể thay provider và renderer mà không viết lại domain model.
5. Run lỗi hoặc bị gián đoạn có thể được hiểu và tiếp tục.
6. Candidate được đánh giá bằng evidence thực tế, không chỉ bằng cờ success.
7. Project cũ đóng góp voice mà không đưa hệ thống hình ảnh lỗi vào hệ thống mới.
