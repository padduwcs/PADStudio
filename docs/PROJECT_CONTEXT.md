# PAD Studio — Project Context

Tài liệu này lưu bối cảnh và định hướng lâu dài của PAD Studio. Agent nên đọc tài liệu này trước khi đề xuất kiến trúc, triển khai tính năng hoặc tạo nội dung cho project.

## PAD Studio là gì?

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ bán tự động quá trình sản xuất video giảng giải trực quan bằng animation.

Project hướng đến việc kết hợp khả năng lập kế hoạch của AI, scene được tạo bằng code, voice tổng hợp và công cụ chỉnh sửa trực quan. Người dùng giữ quyền review và điều chỉnh ở các bước quan trọng.

PAD Studio không phải công cụ tạo video hoàn toàn tự động từ một prompt. Đây là một studio có AI hỗ trợ, trong đó chất lượng giảng giải và độ chính xác vẫn do người dùng kiểm soát.

## Trọng tâm nội dung

Giai đoạn đầu tập trung vào:

- Thuật toán và cấu trúc dữ liệu.
- Người mới học hoặc chưa có mô hình tư duy rõ về chủ đề.
- Video giải thích bản chất bằng hình ảnh logic và trực quan.

Video không hiển thị source code và không phụ thuộc vào caption để truyền đạt nội dung chính. Voice và animation là hai phương tiện giải thích trung tâm.

## Nguyên tắc giảng giải

- Giải thích bản chất và trực giác trước khi đi vào chi tiết.
- Mỗi hình ảnh phải có vai trò truyền đạt thông tin, không chỉ để trang trí.
- Chia kiến thức thành các bước vừa đủ để người mới có thể theo dõi.
- Voice nói đến đâu, visual cần hỗ trợ đúng ý ở thời điểm đó.
- Tránh đưa quá nhiều đối tượng, chuyển động hoặc ý tưởng lên màn hình cùng lúc.
- Ưu tiên sự rõ ràng và chính xác hơn hiệu ứng phức tạp.
- AI tạo đề xuất; người dùng review và quyết định nội dung cuối cùng.

## Quy trình sản xuất định hướng

```text
Nhập chủ đề
→ AI phân tích và tạo mạch giảng
→ Người dùng review nội dung
→ AI tạo kế hoạch voice–visual
→ Người dùng review kịch bản
→ Codex sinh scene Motion Canvas
→ ElevenLabs tạo voice
→ Đồng bộ animation theo voice
→ Render bản nháp
→ Người dùng chỉnh bằng Layout Editor
→ Render video cuối
→ Lưu tài nguyên tốt vào kho tham khảo
```

Quy trình có thể được điều chỉnh trong quá trình phát triển, nhưng cần giữ các điểm review trước những bước tốn chi phí hoặc khó sửa.

## Mạch giảng và kế hoạch voice–visual

Hai lớp kế hoạch cần được phân biệt:

- **Mạch giảng** xác định nội dung cần giải thích, thứ tự các ý và mô hình tư duy muốn xây dựng cho người xem.
- **Kế hoạch voice–visual** xác định lời thuyết minh, hình ảnh tương ứng, hành động animation và timing của từng ý.

Một hình ảnh đẹp nhưng không hỗ trợ đúng mạch giảng không được xem là kết quả tốt. Tương tự, voice đúng nội dung nhưng không có visual đồng bộ cũng chưa đạt mục tiêu của PAD Studio.

## Scene và component

Mỗi video có scene và component riêng để có thể tùy biến theo cách giải thích của chủ đề đó. Không nên ép mọi video phụ thuộc vào một thư viện component dùng chung quá sớm.

Những scene, component, animation pattern hoặc asset đã hoạt động tốt sẽ được lưu vào kho tham khảo. Khi làm video mới, chúng được sao chép và điều chỉnh theo ngữ cảnh thay vì mặc định trở thành dependency dùng chung.

Chỉ nên chuẩn hóa thành thành phần dùng chung khi pattern đã được kiểm chứng qua nhiều video và ranh giới tái sử dụng thực sự rõ ràng.

## Layout Editor

Layout Editor cho phép người dùng chỉnh trực tiếp những phần thường cần tinh chỉnh sau khi scene được sinh:

- Vị trí và kích thước.
- Thuộc tính hiển thị.
- Bố cục các đối tượng.
- Timing và các mốc đồng bộ.

Editor bổ sung cho code chứ không thay thế hoàn toàn code. Codex vẫn hỗ trợ sinh và sửa logic scene; người dùng dùng editor để thực hiện các điều chỉnh trực quan và timing một cách nhanh chóng.

## Vai trò của các thành phần

- **AI**: phân tích chủ đề, đề xuất mạch giảng và lập kế hoạch voice–visual.
- **Người dùng**: review nội dung, quyết định cách giảng, chỉnh layout và timing.
- **Codex**: hỗ trợ thiết kế hệ thống, sinh và sửa code scene Motion Canvas, triển khai và bảo trì project.
- **Motion Canvas**: nền tảng tạo animation bằng code.
- **ElevenLabs**: tạo voice phục vụ video.
- **PAD Studio**: kết nối các bước trên thành một quy trình sản xuất nhất quán.

Các dịch vụ hoặc công nghệ cụ thể có thể thay đổi. Vai trò và ranh giới trách nhiệm quan trọng hơn tên công cụ.

## Nguyên tắc phát triển

- Giữ giải pháp gọn và dễ hiểu.
- Xây theo nhu cầu thực tế của pipeline, tránh tổng quát hóa quá sớm.
- Ưu tiên hoàn thiện một luồng sản xuất xuyên suốt trước khi mở rộng.
- Tách nội dung, voice, visual, layout và timing đủ rõ để có thể chỉnh độc lập.
- Không để thay đổi của video mới vô tình làm hỏng video đã hoàn thiện.
- Những quyết định ảnh hưởng đến workflow hoặc chất lượng giảng giải cần được người dùng review.
- Cấu trúc kỹ thuật phải phục vụ việc sản xuất video, không trở thành mục tiêu tự thân.

## Cách agent sử dụng tài liệu này

Khi làm việc với PAD Studio, agent cần:

1. Dùng tài liệu này làm bối cảnh chung trước khi đưa ra đề xuất.
2. Ưu tiên mục tiêu giảng giải trực quan và đồng bộ voice–visual.
3. Không mặc định tự động hóa hoàn toàn các bước cần con người đánh giá.
4. Không thiết kế hệ thống phức tạp hơn nhu cầu hiện tại nếu chưa có lý do rõ ràng.
5. Phân biệt code của Studio với scene, component và tài nguyên thuộc từng video.
6. Hỏi hoặc nêu rõ giả định khi một quyết định có thể làm thay đổi định hướng sản phẩm.

