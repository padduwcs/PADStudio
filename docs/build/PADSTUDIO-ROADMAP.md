# PADStudio — lộ trình 6 đợt

Cập nhật: **2026-09-11**. Hiện tại: **đợt 1 và đợt 2 đã hoàn thành ở phạm vi sử dụng thực dụng trên máy owner; đợt 3 đã có gói đầu nguyên liệu dùng chung; TTS/ảnh AI và provider trả phí chưa triển khai**. Đây là bản đồ phát triển; đặc tả kỹ thuật chỉ viết cho đợt đang triển khai.

## 1. Cách dùng lộ trình

**Hoàn thiện từng phân hệ theo chiều ngang, với phạm vi vừa đủ cho nhu cầu thực tế.** Mỗi đợt phải có khả năng sử dụng trọn vẹn trong phạm vi đã chốt; không phải hỗ trợ mọi công nghệ và mọi tình huống.

- **Đợt** là một phân hệ lớn. **Bước** là công việc bên trong một đợt. Gói A–F trong tài liệu đợt 1 tương ứng bước 1–6, không phải sáu đợt.
- Chỉ bổ sung phần còn thiếu; tận dụng kho project, workflow, công cụ, renderer và giao diện đã có.
- Mỗi đợt chốt ngắn: cần làm gì, dùng được thế nào, kiểm tra ra sao, phần nào để sau. Không mặc định tạo đặc tả riêng cho từng việc nhỏ.
- Sau nghiệm thu và dùng thử, cập nhật phạm vi đợt tiếp theo. Thứ tự có thể điều chỉnh khi có lý do cụ thể; không tự biến ý tưởng mới thành yêu cầu bắt buộc.
- Bảo toàn dữ liệu, liên kết đúng nguồn, báo lỗi và kiểm tra phù hợp là yêu cầu xuyên suốt. Không dồn việc kiểm thử hoặc giao diện thiết yếu đến đợt cuối.

Đây là thứ tự **phát triển ứng dụng**, không phải pipeline bắt buộc cho từng video. Agent vẫn chọn cách làm theo project; chat điều khiển, web quan sát theo [định hướng hiện tại](PADSTUDIO-CURRENT-DIRECTION.md).

## 2. Bản đồ tổng thể

**Hiểu tư liệu → Chốt hướng sáng tạo → Chuẩn bị nguyên liệu → Dựng → Xem và sửa → Kiểm tra và xuất.**

| Đợt | Phạm vi cần hoàn thiện | Dấu hiệu hoàn thành | Chưa mặc định đưa vào |
| --- | --- | --- | --- |
| **1. Phân tích và hiểu tư liệu** | Phân tích ảnh/audio/video; lưu bằng chứng, nhận xét và hiệu chỉnh; tra cứu và xem theo thời gian | Agent tìm được đoạn cần dùng, giải thích bằng nguồn; người dùng kiểm tra lại được; mở lại vẫn tiếp tục được | OCR/vision riêng, nhận diện người nói, tìm kiếm vector, mọi định dạng hiếm |
| **2. Định hướng sáng tạo và duyệt mẫu** | Dùng brief và tư liệu để đề xuất kịch bản/cách thể hiện; làm mẫu khi cần; lưu hướng được chọn, lý do và tiêu chí review | Người dùng hiểu sản phẩm sẽ làm theo hướng nào; Agent tiếp tục hoặc sửa hướng mà không mất quyết định | Hệ thống tự chấm sáng tạo, kho template khổng lồ, bắt mọi project phải duyệt mẫu |
| **3. Thu thập và tạo nguyên liệu** | Nhập/tìm nguồn và tạo nội dung theo nhu cầu đã xác định; giữ phiên bản, nguồn gốc; kiểm soát thao tác trả phí | Nguyên liệu cần thiết đi vào project, xem được và dùng tiếp được; chi phí/lỗi/lần thử có dấu vết, tránh tính phí lặp ngoài ý muốn | Tích hợp mọi nhà cung cấp, marketplace, tự động chọn/fallback dịch vụ |
| **4. Dựng hình và âm thanh** | Hoàn thiện sequence và renderer hiện có cho loại video mục tiêu: bố cục, thời gian, chữ, phụ đề và phối âm; sửa phần bị ảnh hưởng | Tạo được bản dựng đúng ý định; sửa đoạn hoặc lời/âm thanh mà giữ được phần còn tốt | Trình dựng chuyên nghiệp với timeline kéo thả, mọi hiệu ứng hoặc timeline nhiều lớp tổng quát |
| **5. Giao diện xem và phản hồi** | Liên kết storyboard, nguyên liệu, bản dựng, phiên bản và nhận xét trong một không gian dễ theo dõi | Người dùng biết đang xem bản nào, đoạn nào cần sửa; Agent nhận phản hồi qua chat và bám đúng đối tượng/phiên bản | Viết lại toàn UI, web tự điều khiển project, tài khoản/cộng tác nhiều người |
| **6. Kiểm tra, xuất và vận hành ổn định** | Kiểm tra đầu ra theo loại video mục tiêu; xuất cấu hình cần dùng; hoàn thiện setup, chẩn đoán và phục hồi xuyên suốt | Có file bàn giao đúng bản đã chọn; mở lại/chạy lại được; lỗi và giới hạn có hướng xử lý | Mọi nền tảng xuất bản, hạ tầng cloud/worker, chứng nhận mọi máy và định dạng |

Các điều kiện trên là định hướng đầu ra. Trước mỗi đợt mới, chọn loại project và nhu cầu cụ thể để xác định phạm vi nghiệm thu, không mở rộng đến mọi trường hợp có thể có.

## 3. Kết quả đợt 1

Đối chiếu ngày 2026-09-09: registry đã đăng ký sáu adapter; AnalysisService có dependency, Run/Result và vòng đời phân tích. Gói D đã bổ sung artifact chuyên biệt, reader/search/summary dùng chung, verify freshness, context và API chỉ đọc. Gói E đã nối đường đọc đó vào workspace observer theo source time. Gói F đã tổng hợp acceptance fail-closed cho vòng đời, lỗi/phục hồi, freshness, pagination/Result set, regression, doctor và browser.

| Bước của đợt 1 | Tên cũ | Trạng thái và ý nghĩa |
| --- | --- | --- |
| **1. Kiểm chứng công nghệ** | Gói A | Đã chốt cho sử dụng thực tế trên máy hiện tại: large-v3 GPU FP16; chưa chứng nhận chất lượng rộng |
| **2. Nền dữ liệu và thực thi** | Gói B | Đã có identity/hash, bằng chứng, job, cache, hủy và tiếp tục sau lỗi |
| **3. Bộ công cụ phân tích** | Gói C | Đã có probe, cảnh, frame/contact sheet, phân tích audio, transcript và preview; còn giới hạn đã ghi nhận |
| **4. Hiểu biết và tra cứu** | Gói D | Đã có profile/assessment/correction giữ raw, evidence validation, đọc/tìm kiếm/summary, freshness và hướng dẫn Agent |
| **5. Giao diện xem tư liệu** | Gói E | Đã có workspace chọn nguồn, media/source-time, coverage, transcript/frame/scene/audio/assessment/search, freshness và lazy-load chỉ đọc |
| **6. Nghiệm thu phân hệ** | Gói F | Đã đạt phạm vi practical trên máy owner: 129 test repository, 20 test harness, doctor ready và browser acceptance; gate release rộng chưa đo được giữ rõ |

Đợt 1 được đóng theo điều chỉnh §18 ở mức sử dụng thực dụng, không quy đổi thành chứng nhận phát hành rộng. Acceptance đã kiểm tra vòng tạo/mở lại, cancel/resume/reconcile, runtime failure, stale/missing/tampered data, pagination/range/nhiều Result set, capability regression và browser. Báo cáo giữ `releaseDefault: null` và đánh dấu riêng corpus holdout, ngưỡng ASR/scene, nguồn 2 giờ/4K/VFR/offset cùng benchmark 100 file/10 giờ là `not_measured`.

Bằng chứng và cách chạy lại nằm tại [SOURCE-UNDERSTANDING-PACKAGE-F.md](SOURCE-UNDERSTANDING-PACKAGE-F.md) và [package-f-verification.json](../../eval/source-understanding/reports/2026-09-09/package-f-verification.json). Không được suy diễn trạng thái practical thành các gate §13 chưa đo.

**Đợt 2 đã hoàn thành practical — Định hướng sáng tạo và duyệt mẫu.** Gói A–C đã chốt hợp đồng, direction `keys-first`, dựng/sửa mẫu r2, reuse 6/7 segment và exact user approval. Gói D đã nối vòng creative/sample vào observer chỉ đọc. Gói E đã nghiệm thu 138/138 test, freshness và browser ở ba viewport. Chi tiết tại [đặc tả](CREATIVE-DIRECTION-SPEC.md), [Gói D](CREATIVE-DIRECTION-PACKAGE-D.md) và [Gói E](CREATIVE-DIRECTION-PACKAGE-E.md).

## 4. Giữ khối lượng vừa đủ ở các đợt sau

- **Đợt 2:** dùng artifact/workflow/review/decision đã có. Mẫu có thể tận dụng tư liệu và renderer hiện tại; chỉ cần công cụ tạo mới thì mới phụ thuộc đợt 3.
- **Đợt 3:** chọn những loại nguyên liệu thực sự thiếu từ đợt 2; mỗi khả năng cần dùng có một đường hoạt động đáng tin cậy. Không lấy số lượng tích hợp làm tiêu chí hoàn thành.
- **Đợt 4:** bổ sung những khả năng dựng cần cho sản phẩm mục tiêu, phát triển từ video.sequence và các tool hiện tại.
- **Đợt 5:** hoàn thiện trải nghiệm quan sát xuyên project; giao diện tư liệu của đợt 1 và preview cần ở các đợt trước vẫn phải làm ngay khi cần. Phản hồi/phê duyệt tiếp tục qua chat.
- **Đợt 6:** kiểm tra toàn hệ thống và bàn giao; từng đợt trước vẫn tự chịu trách nhiệm về dữ liệu, lỗi và khả năng phục hồi của mình.

Chat tích hợp vào cùng ứng dụng vẫn là hướng sản phẩm, nhưng thời điểm phụ thuộc cách tích hợp Agent host phù hợp. Chưa gắn việc tự xây chat client vào một đợt hoặc lấy nó làm điều kiện chặn sử dụng hiện tại.

Sau mỗi đợt chỉ cần ghi: **đã dùng được gì, còn giới hạn gì, nhu cầu nào đã chứng minh cho đợt sau**. Khi chưa đến đợt tiếp theo, giữ mô tả ở mức bảng tổng thể; không viết sẵn schema/API hay danh sách task dài.

## 5. Tài liệu để tiếp tục

- [Đặc tả đợt 2](CREATIVE-DIRECTION-SPEC.md): pilot, hợp đồng, workflow, các gói và nghiệm thu định hướng sáng tạo/duyệt mẫu.
- [Gói B đợt 2](CREATIVE-DIRECTION-PACKAGE-B.md): project pilot thật, bằng chứng nguồn, ba phương án và user approval gắn đúng revision.
- [Gói C đợt 2](CREATIVE-DIRECTION-PACKAGE-C.md): sequence/render thật, review, sửa cục bộ có reuse và user approval cho exact result.
- [Gói D đợt 2](CREATIVE-DIRECTION-PACKAGE-D.md): observer chỉ đọc cho brief, proposal, direction, sample, review và approval.
- [Gói E đợt 2](CREATIVE-DIRECTION-PACKAGE-E.md): cổng nghiệm thu, bằng chứng và giới hạn practical.
- [Đặc tả đợt 1](SOURCE-UNDERSTANDING-SPEC.md): phạm vi kỹ thuật, các bước, nghiệm thu và điều chỉnh đã ghi.
- [Bước 1 — review thực tế](../../eval/source-understanding/PRACTICAL-REVIEW.md), [bước 2 — hợp đồng/vòng đời](SOURCE-UNDERSTANDING-PACKAGE-B.md), [bước 3 — công cụ](SOURCE-UNDERSTANDING-PACKAGE-C.md), [bước 4 — hiểu biết/truy xuất](SOURCE-UNDERSTANDING-PACKAGE-D.md), [bước 5 — workspace observer](SOURCE-UNDERSTANDING-PACKAGE-E.md), [bước 6 — nghiệm thu phân hệ](SOURCE-UNDERSTANDING-PACKAGE-F.md): kết quả và giới hạn đã có.
- [Báo cáo kiểm chứng bước 3](../../eval/source-understanding/reports/2026-09-09/package-c-verification.json): bằng chứng kiểm tra đã lưu.
- [Trí tuệ project và workflow](PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md), [sequence và renderer](VIDEO-SEQUENCE-PRODUCTION.md): nền dùng tiếp ở các đợt sau.

Lộ trình bổ sung cách tổ chức công việc; không thay thế [thiết kế](PADSTUDIO-DESIGN.md), [định hướng](PADSTUDIO-CURRENT-DIRECTION.md) hoặc tự ghi đè hợp đồng đã triển khai.

## Đợt 3 — gói nguyên liệu dùng chung

Theo yêu cầu mở rộng các khả năng phổ biến, gói đầu đã bổ sung graphic.render, audio.prepare và media.acquire qua Executor hiện có. Không gắn với video mẫu; nghiệm thu nhiều project và khung hình. TTS/ảnh AI/provider trả phí và search stock chưa triển khai. Chi tiết trong [ASSET-CAPABILITIES-SPEC.md](./ASSET-CAPABILITIES-SPEC.md).
