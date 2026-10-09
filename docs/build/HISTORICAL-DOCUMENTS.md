# Index tài liệu xây dựng lịch sử

> Index này được giữ để truy vết quá trình triển khai. Baseline hiện hành nằm tại
> [`PADSTUDIO-DEVELOPMENT-STATUS.md`](PADSTUDIO-DEVELOPMENT-STATUS.md); mục tiêu và quyết định còn
> hiệu lực nằm tại [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md) và
> [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md).

Các tài liệu mốc đã khép lại được đặt vật lý trong [`history/`](history/README.md) để không lẫn với
spec và tài liệu điều hướng còn dùng trực tiếp.

Đọc [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md) trước. Đây là tài liệu chính để hiểu PADStudio là gì, một dự án vận hành ra sao và các phần nào cần được xây.

Đọc tiếp [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md) để biết các định hướng đã được chốt trong quá trình phát triển. Tài liệu này làm rõ trạng thái hiện tại, không thay thế bản thiết kế gốc.

[`PADSTUDIO-STATE-AND-NEXT.md`](history/PADSTUDIO-STATE-AND-NEXT.md) là snapshot tích lũy đến
2026-09-17. Dùng nó để truy vết pilot, giới hạn và quyết định tại thời điểm đó; không dùng các câu
“bước tiếp theo” trong file làm backlog hiện hành.

Đọc tiếp [`PADSTUDIO-BUILD-OUTLINE.md`](PADSTUDIO-BUILD-OUTLINE.md) khi cần dàn ý chi tiết hơn để tự triển khai từng phần của hệ thống.

Khi bắt đầu sửa code, đọc thêm [`DEVELOPMENT-PROTOCOL.md`](DEVELOPMENT-PROTOCOL.md). Tài liệu này hướng dẫn cách thay đổi code an toàn và kiểm tra kết quả.

Bản thiết kế chỉ giữ mục tiêu và cách các phần phối hợp. Cấu trúc dữ liệu, API, thư mục, công nghệ hay nhà cung cấp dịch vụ sẽ được chọn khi bắt đầu xây một phần cụ thể.

Phần cấu trúc video, bản dựng có phiên bản và vòng sửa cục bộ:
[VIDEO-SEQUENCE-PRODUCTION.md](VIDEO-SEQUENCE-PRODUCTION.md).

Đặc tả cho đợt 1, hoàn thiện phân hệ phân tích và hiểu tư liệu theo chiều ngang:
[SOURCE-UNDERSTANDING-SPEC.md](SOURCE-UNDERSTANDING-SPEC.md). Văn bản viết ở thể đề xuất ngày 2026-09-08 và xác định phạm vi, hợp đồng, cách triển khai và nghiệm thu; phân hệ đã được xây ở phạm vi practical (gói B–F), còn các gate release rộng §13 vẫn `not_measured`.

Đặc tả đã hoàn thành practical cho đợt 2 — định hướng sáng tạo và duyệt mẫu:
[CREATIVE-DIRECTION-SPEC.md](CREATIVE-DIRECTION-SPEC.md). Các gói A–E đã hoàn tất từ hợp đồng, pilot, dựng mẫu đến observer và nghiệm thu.

Trạng thái pilot Đợt 2:
[Gói B — khởi tạo pilot và duyệt hướng](history/CREATIVE-DIRECTION-PACKAGE-B.md);
[Gói C — dựng, sửa cục bộ và duyệt mẫu](history/CREATIVE-DIRECTION-PACKAGE-C.md);
[Gói D — observer creative chỉ đọc](history/CREATIVE-DIRECTION-PACKAGE-D.md);
[Gói E — nghiệm thu Đợt 2](history/CREATIVE-DIRECTION-PACKAGE-E.md).

Trạng thái triển khai Source Understanding:
[gói B — hợp đồng và vòng đời](history/SOURCE-UNDERSTANDING-PACKAGE-B.md);
[gói C — sáu adapter production](history/SOURCE-UNDERSTANDING-PACKAGE-C.md);
[gói D — hiểu biết và truy xuất](history/SOURCE-UNDERSTANDING-PACKAGE-D.md);
[gói E — workspace observer](history/SOURCE-UNDERSTANDING-PACKAGE-E.md);
[gói F — nghiệm thu phân hệ](history/SOURCE-UNDERSTANDING-PACKAGE-F.md).

Lộ trình sáu đợt đã dùng để xây nền hiện có: [PADSTUDIO-ROADMAP.md](history/PADSTUDIO-ROADMAP.md). Đây là
lịch sử phát triển, không phải vị trí hay backlog hiện tại.

Báo cáo mốc [`PADSTUDIO-V1-COMPLETION.md`](history/PADSTUDIO-V1-COMPLETION.md) và JSON tương ứng trong
`reports/` giữ nguyên số liệu của ngày nghiệm thu. Không cập nhật số test trong báo cáo cũ để giả
thành số hiện tại.


Capability TTS dùng chung, cài Piper tiếng Việt, cấu hình ElevenLabs và phê duyệt credit:
[TTS-CAPABILITY.md](TTS-CAPABILITY.md).

Pilot local Đợt 3 và bằng chứng nghiệm thu: [phase3-vd04-pilot-acceptance.json](../../reports/phase3-vd04-pilot-acceptance.json).
