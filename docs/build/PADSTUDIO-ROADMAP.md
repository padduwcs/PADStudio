# PADStudio — lộ trình 6 đợt

Cập nhật: **2026-09-13**. Hiện tại: **cả sáu đợt đã hoàn thành practical trên máy chủ sở hữu**. Bước tiếp theo là dùng trên project thật và chỉ mở phạm vi mới từ ma sát có bằng chứng. Ảnh AI, search stock và ElevenLabs thật chưa được dùng. Đây là bản đồ phát triển, không phải chứng nhận release rộng.

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
- [Trạng thái hiện tại và bước tiếp theo](PADSTUDIO-STATE-AND-NEXT.md), [đặc tả Đợt 6B](PHASE6B-OPERATIONS-SPEC.md), [runbook](../OPERATIONS-RUNBOOK.md), [báo cáo nghiệm thu Đợt 6B](../../reports/phase6b-operations-acceptance.json): bằng chứng bàn giao local, doctor, recovery và acceptance end-to-end.

Lộ trình bổ sung cách tổ chức công việc; không thay thế [thiết kế](PADSTUDIO-DESIGN.md), [định hướng](PADSTUDIO-CURRENT-DIRECTION.md) hoặc tự ghi đè hợp đồng đã triển khai.

## Đợt 3 — gói nguyên liệu dùng chung

Theo yêu cầu mở rộng các khả năng phổ biến, đợt 3 đã bổ sung `graphic.render`, `audio.prepare`,
`media.acquire` và `tts.synthesize` qua Executor hiện có. Pilot vd04 đã dùng graphic và Piper
thật trong sequence/render local, sửa lỗi phát âm/mix, review bằng frame + ASR + audio metrics và
khép project không còn blocker. ElevenLabs cloud thật chưa được gọi do chưa có API key người dùng;
ảnh AI và search stock chưa triển khai vì chưa có nhu cầu pilot bắt buộc. Đợt 3 được xem là hoàn
thành ở phạm vi practical-local này. Chi tiết trong [ASSET-CAPABILITIES-SPEC.md](./ASSET-CAPABILITIES-SPEC.md),
[TTS-CAPABILITY.md](./TTS-CAPABILITY.md) và [báo cáo pilot](../../reports/phase3-vd04-pilot-acceptance.json).

## Cập nhật 2026-09-12 — Đợt 4

Phạm vi composition được duyệt đã có implementation và bộ acceptance riêng:
[đặc tả](PHASE4-PRODUCTION-SPEC.md). Nghiệm thu kỹ thuật và trạng thái pilot nằm
trong reports/phase4-production-acceptance.json và reports/phase4-pilot.json.
Bản sửa `pilot-preview` r10 dài 12 giây đã được người dùng duyệt; nhánh thử sai đã
retire và project chỉ còn một sequence hiện hành. Đợt 4 đã đóng; điểm tiếp tục là
Đợt 5A, không tự mở provider hoặc capability sản xuất mới.

## Cập nhật 2026-09-12 — Đợt 5

Đợt 5A đã hoàn thiện observer conditional theo generation/ETag, payload tải lười, timeline/seek, bảo toàn player và mốc feedback exact revision. Đợt 5B đã khép vòng còn lại: chọn/so sánh exact render Result, Decision có `feedbackTarget` Result/artifact revision/segment/time được validate và lưu bền vững, explicit resolution, pending feedback cho Agent, summary pilot 19.008 byte và sửa race lock Windows. Acceptance đạt 177/177 repository tests, 20/20 analysis tests và browser 390/768/1440. Bằng chứng ở [đặc tả 5A](PHASE5A-OBSERVER-SPEC.md), [đặc tả 5B](PHASE5B-EXACT-FEEDBACK-SPEC.md) và [report 5B](../../reports/phase5b-feedback-acceptance.json). Đợt 5 đã đóng.

## Cập nhật 2026-09-13 — Đợt 6A

Đường local delivery đã hoàn chỉnh cho profile video pilot: exact accepted/current Result, finalization và freshness gate, SHA-256 mọi Result file mới, full decode/media/audio validation, bundle provenance/review/approval/checksums và Observer Delivery chỉ đọc. Đồng thời đã sửa race snapshot/ETag và mutex Decision. Bundle pilot giữ nguyên byte r10; acceptance đạt 183/183 repository tests, 20/20 analysis tests và browser ba viewport. Xem [đặc tả](PHASE6A-LOCAL-DELIVERY-SPEC.md) và [report](../../reports/phase6a-delivery-acceptance.json). Điểm tiếp tục là Đợt 6B cho setup/doctor/recovery/hướng dẫn và acceptance end-to-end; không tự mở publishing provider.

## Cập nhật 2026-09-13 — Đợt 6B

Đã hoàn chỉnh lớp vận hành practical: doctor nhanh/sâu phân biệt capability bắt buộc và tùy chọn; project health đưa blocker, việc cần chú ý và readiness vào context/Observer; recovery có plan dry-run và apply dưới lock, chỉ finalize bằng chứng bền vững và idempotent; runbook bao phủ setup, backup/restore, xử lý lỗi, upgrade/rollback. Acceptance từ project mới đã chứng minh render → finalization bị ngắt → reopen/recover không render lại → approval → delivery → reopen/deep verify. Kết quả đạt 191/191 repository tests, 20/20 analysis tests, browser ba viewport và không còn lock sót. Đợt 6 practical đã đóng; không suy rộng thành release certification hay tự mở provider/publishing/cloud.

## Cập nhật 2026-09-13 — hardening và project thật

Importer nay khóa đoạn cấp tên/chuyển file/ghi Resource nên hai import trùng tên không thể xóa file của nhau; `ensureProject` chịu được hai yêu cầu tạo cùng project. Mutation lock có owner token, heartbeat, kiểm tra process còn sống, takeover intent và chỉ đúng owner mới được release. Regression/stress test bao phủ owner chạy lâu, owner cũ không xóa lock kế nhiệm, tám contender giành stale lock vẫn chỉ có một owner và import đồng thời giữ đủ hai file/resource/run.

Phase 6A/6B acceptance tự sinh media và project trong thư mục tạm, tạo hai revision/Result để kiểm tra exact selection/comparison, delivery, recovery, doctor và browser; không còn hard-code `phase3-vd04-asset-pilot`, r10/r9 hoặc mốc 8 giây. Repository đạt 226/226 test và analysis harness 20/20.

Project `real-pilot-longest-substring` dùng `vid15_Longest_Substring_Without_Repeating_Characters.mp4` đã hoàn thành toàn tuyến đến delivery. Tự duyệt phát hiện r1 hụt âm cuối và sửa thành r2 320,2–330,0 giây; hình, exact-output ASR và audio metrics đạt, còn giới hạn không phát audio trực tiếp được ghi trong combined review. Theo ủy quyền rõ của người dùng, exact Result r2 được accepted và xuất bundle giữ nguyên byte; deep doctor `ready`, 39/39 file được xác minh, không còn pending feedback/finalization.

## Cập nhật 2026-09-13 — Lượt 4 automated output QA

Đã thêm cổng QA bền vững cho exact render và nối nó thành điều kiện bắt buộc của
local delivery. Cổng kiểm tra full decode, frame/contact sheet, audio/clipping và các
biên lời nói; với sequence lấy hình/tiếng từ nguồn, nó còn đối chiếu điểm in/out với
word timestamp của transcript nguồn. Pilot thật chứng minh bản r1 bị chặn vì cắt xuyên
từ cuối, còn r2 vượt QA và tạo bundle mới chứa `quality.json`. Observer vẫn chỉ đọc;
human viewing/listening không bị suy diễn từ ASR hoặc contact sheet.
