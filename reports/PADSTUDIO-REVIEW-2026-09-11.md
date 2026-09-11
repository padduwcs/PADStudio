# Đánh giá hiện trạng và hướng triển khai PADStudio

> Báo cáo lịch sử tại commit `0026aa8`, trước gói capability nguyên liệu `86c2af0`. Trạng thái triển khai mới hơn được ghi trong tài liệu định hướng hiện tại và ASSET-CAPABILITIES-SPEC.md.

**Kết luận:** PADStudio đã có một prototype local vận hành được từ nhập tư liệu đến phân tích, chọn hướng sáng tạo, dựng mẫu, sửa cục bộ, duyệt đúng phiên bản và mở lại để tiếp tục. Đợt 1 và Đợt 2 đã hoàn thành trong phạm vi thực dụng trên máy hiện tại. Điểm tiếp tục là xác định nguyên liệu còn thiếu cho một project mục tiêu, rồi chốt phạm vi Đợt 3. Chưa có cơ sở để coi toàn bộ studio đã hoàn thiện hoặc mặc định chọn một dịch vụ tạo nội dung trả phí.[1][2]

Bản đánh giá đối chiếu trạng thái ngày 11/09/2026, PADStudio commit `0026aa8`, OpenMontage checkout `cd9f3c1`. Những đề xuất dưới đây là khuyến nghị phát triển, không thay thế các quyết định thiết kế đã chốt.

**1. Hệ thống đang có hình dạng như thế nào**

PADStudio giữ một kho project chung. Agent đang làm việc trong Agent host bên ngoài, đọc bối cảnh và thay đổi project qua CLI. Web local đọc cùng kho để hiển thị tư liệu, hiểu biết, hướng sáng tạo và bản dựng. Chat tích hợp trong cùng ứng dụng vẫn là đích sản phẩm nhưng chưa được triển khai.[1][3]

Code dùng JavaScript ES modules, Node.js, web server và UI JavaScript/CSS trực tiếp; phân tích chuyên sâu gọi Python và các thư viện local; xử lý media dùng FFmpeg/ffprobe. Package hiện khai báo Node >=20. Thiết kế này phù hợp một studio local do Agent điều khiển, chưa phải dịch vụ cộng tác nhiều người.

| Lớp | Đã có trong code | Ý nghĩa sử dụng |
| --- | --- | --- |
| Kho project | Project, resource, run, result, decision, checkpoint; ghi file nguyên tử | Đóng/mở lại vẫn giữ dữ liệu và lịch sử |
| Trí tuệ project | Artifact có revision; brief, proposal, direction, source assessment; references | Lưu hiểu biết và lựa chọn ngoài cuộc chat |
| Workflow | Đồ thị công việc có dependency, review và approval | Agent có thể đổi kế hoạch, hệ thống kiểm tra tính hợp lệ |
| Executor | Registry, availability, prepare/execute/result, output workspace, rollback/recovery | Các tool đi qua cùng vòng thực thi và lưu dấu vết |
| Phân tích nguồn | Job, lease, cancel/resume/reconcile, cache, reader/search/verify | Tìm và kiểm tra bằng chứng theo nguồn và thời gian |
| Dựng | video.sequence, renderer theo revision, reuse từng đoạn | Sửa phần cần sửa, giữ phần còn tốt |
| Quan sát | Source workspace, creative workspace, production comparison | Xem đúng nguồn, hướng, bản dựng và quyết định |

Kho nằm tại `.padstudio/projects/<id>/`, gồm JSON records và file media. `overview.md` là bản đọc nhanh từ checkpoint. Nó không phải một nguồn trạng thái độc lập. Dữ liệu runtime được gitignore: code và báo cáo đã commit không thay thế việc giữ toàn bộ project/media để tiếp tục trên máy khác.[3][4]

Điểm mạnh đáng giữ là phân biệt artifact, result, run, review, decision và checkpoint. Chẳng hạn, “hướng đã chọn” là artifact; “đã chạy renderer nào” là run; “file r2” là result; “r2 có vấn đề gì” là review; “người dùng chấp nhận r2” là decision. Nhờ vậy đổi một bản dựng không âm thầm biến approval cũ thành approval mới.[4]

**2. Những việc thực sự làm được**

Registry mặc định có **15 capability**, không phải danh sách tính năng dự kiến.[5]

| Nhóm | Capability hiện có |
| --- | --- |
| Metadata media | media.inspect |
| Phân tích nguồn | source.probe, video.detect-scenes, source.extract-frames, audio.analyze, audio.transcribe, source.preview |
| Biên tập từng thao tác | video.trim, video.concat, video.reformat, video.thumbnail, audio.overlay, subtitle.burn, image.to-video |
| Dựng theo cấu trúc | video.render-sequence |

Các thao tác cơ bản đã bao phủ cắt, ghép và transition, đổi khung, lấy thumbnail, chèn audio/ducking, ghim phụ đề và tạo video từ ảnh với chuyển động nhẹ. Cần phân biệt capability riêng với khả năng của renderer sequence: việc `audio.overlay` có ducking hoặc `video.concat` có transition không có nghĩa mọi cấu hình đó đã có trong contract `video.sequence`.[3][6]

Phân tích nguồn đã vượt mức xuất transcript thô. Hệ thống giữ source identity/hash, timebase, coverage, Result bằng chứng; đọc transcript/scene/frame/audio/assessment theo range và cursor; tìm kiếm; lưu correction có revision mà giữ raw. Xác minh riêng phát hiện stale/missing, còn observer không tự chạy analysis hoặc verify.[7]

“Hiểu tư liệu” ở đây gồm công cụ trích bằng chứng và Agent diễn giải bằng chứng. Chưa có cơ sở coi hệ thống tự hiểu đầy đủ ngữ nghĩa hình ảnh, OCR, người nói hoặc mọi chi tiết nội dung. Transcript có lỗi vẫn cần kiểm tra; dữ liệu từ ASR không được tự biến thành lời đã nghe xác nhận.

Brief đã tách mục tiêu, khán giả, ràng buộc, sự thật, giả định và câu hỏi. Proposal yêu cầu 2–5 phương án có trade-off; direction trỏ chính xác proposal/option hoặc dùng hướng trực tiếp từ brief cho việc đủ rõ. Cấu trúc này hỗ trợ chọn hướng có lý do mà không bắt mọi project phải trải qua một màn hình hay số stage cố định.[8]

Renderer sequence nhận đúng artifact revision, kiểm tra nguồn, dựng từng segment rồi ghép. Reuse phụ thuộc spec, nguồn và hash file, phiên bản công cụ/FFmpeg; cùng ID không đủ để tái dùng. Nguồn/lời đọc thiếu hoặc sai range gây lỗi; không tự tạo nội dung để lấp chỗ trống. Khi Result đã bền vững nhưng đóng Run lỗi, cơ chế finalization_pending bảo toàn output và cho hoàn tất dấu vết mà không render lại.[5][6]

**3. Đến bước nào rồi: đối chiếu với project thật**

| Đợt trong roadmap | Trạng thái chính xác |
| --- | --- |
| 1. Phân tích và hiểu tư liệu | Hoàn thành practical; còn gate chất lượng/phát hành rộng chưa đo |
| 2. Định hướng sáng tạo và duyệt mẫu | Hoàn thành practical với pilot và observer |
| 3. Thu thập và tạo nguyên liệu | Chưa chốt phạm vi; đã có import và output lifecycle làm nền |
| 4. Dựng hình và âm thanh | Có nền sequence/renderer và nhiều tool; chưa hoàn thiện toàn phân hệ |
| 5. Giao diện xem và phản hồi | Có source/creative/production observer; còn trải nghiệm xuyên project |
| 6. Kiểm tra, xuất và vận hành | Có test/recovery/MP4; chưa có toàn bộ quy trình bàn giao và vận hành |

Không nên quy đổi thành “2/6 = 33% hoàn thành”. Các đợt không cùng độ lớn; phần dựng và UI đã phải được làm một phần để chứng minh Đợt 1–2.[2]

Pilot `phase2-brute-force-pilot` đang tồn tại local, dùng `vd03_brute_force.mp4`. Có ba phương án, hướng được chọn là `keys-first` với kết thúc takeaway-only. Sequence r1 có bảy đoạn. Sau review, r2 thêm caption lớn ở nhịp nối “chìa khóa → khả năng cần kiểm tra”, dựng lại một đoạn và reuse sáu đoạn.[9]

Bản được duyệt là `result-mtv3bvo3-2508c5de`, sequence revision 2, 1080×1920, 30 fps, thời lượng được báo cáo 47,421333 giây. Hash file được kiểm tra lại khớp báo cáo:
`dd2a8c560cb06e6678f5f93b0c90cbad7a75dc1ab1e9e9abac115cd4967c2212`.

Context hiện có 1 resource, 8 Result, 9 Run, 8 artifact revision và 2 decision. Checkpoint là current; không còn active workflow, pending approval hay affected work item. Checkpoint nêu rõ việc tiếp theo là chốt bài toán và tiêu chí nghiệm thu Đợt 3. Đây là bằng chứng trạng thái đã lưu, không chỉ là lời mô tả trong README.

Approval r2 là quyết định lịch sử trong project và báo cáo nghiệm thu. Lần đánh giá này không tự xác nhận lại chất lượng nghe/xem của video, không thay decision và không tạo r3.

**4. Kiểm tra lại ngày 11/09/2026**

| Kiểm tra | Kết quả mới |
| --- | --- |
| Repository suite, node --test | 138 pass, 0 fail, 0 skipped; khoảng 12,55 giây |
| Python evaluation harness | 20/20 pass |
| Runtime doctor | ready; cả sáu capability analysis available |
| Profile sử dụng thực tế | large-v3-gpu-fp16; releaseDefault vẫn null |
| Verify analysis pilot | 6/6 Result verified_current; search index 22 dòng, không warning |
| Đọc lại full context | Checkpoint current; không approval chờ; không dependency ảnh hưởng |
| SHA-256 preview r2 | Khớp báo cáo pilot |
| Browser creative smoke | Pass trên Chrome headless, 390/768/1440 px; search và player qua polling đạt |

Browser smoke ban đầu lỗi CDP. Log server cho thấy cổng thử 57643 bị Windows từ chối bind (EACCES). Sau khi dùng cổng do hệ điều hành cấp và kiểm tra server sẵn sàng, smoke đạt. Do đó không dùng lỗi thử cổng này làm bằng chứng UI hỏng.

Browser lần này kiểm tra pilot một nguồn, 22 transcript rows. Không kiểm chứng lại pagination nhiều Result set của Đợt 1; bằng chứng đó nằm ở nghiệm thu Gói F trước đây. Doctor kiểm tra readiness, không thay thế một lần inference trên toàn corpus. Không chạy lại benchmark GPU 25 file, không review nghe toàn bộ nguồn và không kiểm tra release trên máy khác.[7][10]

**5. Những khoảng trống có ý nghĩa cho bước tiếp theo**

**Phê duyệt sáng tạo và quyền chạy tool trả phí đang là hai việc khác nhau.** Workflow đã kiểm tra approval theo output/review. Nhưng trong ToolExecutor, khi `tool.approvalRequired` là true, code vẫn trả lỗi `approval_required`; chưa có đường tiêu thụ một approval hợp lệ để chạy. Các field estimated/actual cost hiện có là nền ghi nhận, chưa phải vòng dự toán, giữ ngân sách, gửi request, đối soát và phục hồi chi phí.[5]

Vì vậy thêm TTS trả phí không chỉ là viết adapter HTTP. Cần bảo đảm approval gắn đúng nội dung, tool và mức chi phí; phân biệt chưa gửi request, đã gửi nhưng chưa biết kết quả, và đã nhận kết quả. Khi timeout không biết provider đã tính phí hay chưa, “thử lại” không được mặc định là gửi một yêu cầu mới. Đây là điều kiện thiết kế cần chốt nếu chọn paid capability, chưa phải schema đã được phê duyệt.

**Chuẩn bị nguyên liệu có nền nhưng chưa có vòng hoàn chỉnh cho nguyên liệu mới.** Import và Result/media references đã giải quyết lưu trữ. Điều còn thiếu cần chứng minh bằng project: đoạn nào thiếu gì, có thể tái dùng nguồn nào, phải tạo mới phần nào, thử mẫu nào, người dùng chọn phiên bản nào, rồi đưa vào sequence nào. Không cần mở một asset database thứ hai nếu artifact/resource/result hiện có đủ thể hiện nhu cầu.

**Renderer còn phạm vi hữu hạn.** Sequence hiện là dựng tuần tự từng đoạn, chưa phải composition nhiều lớp tổng quát. Narration cần file audio thật; văn bản narration không tự thành TTS. Thời điểm lời đọc, nhạc xuyên đoạn, typography và bố cục phong phú hơn chỉ nên mở theo sản phẩm mục tiêu. File decode được không chứng minh dễ hiểu, dễ đọc hoặc âm thanh tốt; renderer giữ các mục creative/speech/subtitle/audio review ở trạng thái chưa thực hiện.[6]

**Chất lượng phân tích chưa được chứng nhận rộng.** Holdout có nhãn, ngưỡng ASR/scene, nguồn dài hai giờ, 4K/VFR/offset và benchmark 100 file/10 giờ vẫn chưa đo. Đây là giới hạn phạm vi, không phủ nhận khả năng dùng hiện tại. Chỉ ưu tiên các phép đo bổ sung khi nguồn mục tiêu làm chúng trở nên cần thiết.[7][10]

**Một chi tiết đáng cải thiện ở đường tiếp tục của Agent:** `buildSummary()` trả active artifacts, workflow, capabilities và analysis nhưng không trả `checkpointFreshness`, `production` hoặc `resumeView` như `build()`. Do đó summary hiện không đủ thay thế full context khi quyết định bước tiếp theo. Active artifacts cũng chứa dữ liệu đầy đủ nên summary có thể vẫn khá lớn. Một bổ sung nhỏ về freshness/blocker và giới hạn payload sẽ có ích khi project tăng; đây là nhận xét implementation, chưa phải lỗi làm pilot hiện tại sai.[11]

**6. Dùng hai nguồn tham khảo ra sao**

Metadata kiểm tra mới cho thấy `D:\Test\vid` có **25 MP4, tất cả 1080×1920**, tổng **6.056,725 giây**, khoảng **100 phút 56,7 giây**. Thời lượng từng video từ khoảng 85,6 đến 369,1 giây. Báo cáo baseline trước đây đã dùng toàn bộ 25 file cho ASR và scene detection; pilot Đợt 2 dùng Brute Force.[9][10]

Bộ video phù hợp kiểm tra tiếp bài giảng ngắn, thuật ngữ tiếng Việt/Anh, giữ ý khi cắt, đọc chữ trên khung dọc, nối lập luận và phụ đề. Tuy nhiên tất cả cùng độ phân giải dọc; nó chưa chứng minh reframe ngang sang dọc hoặc chất lượng trên nhóm tư liệu khác. Video chưa dùng làm pilot sáng tạo vẫn có thể là bài thực hành mới, nhưng toàn bộ corpus đã được dùng cho đánh giá trước nên không gọi đó là holdout chưa nhìn thấy.

Không cần import toàn bộ lại. Giữ r2 làm mốc hồi quy; chọn thêm một bài làm project độc lập khi có mục tiêu mới. Không dùng tên file để suy ra chính xác nội dung, độ khó hoặc lỗi ASR.

OpenMontage có cùng điểm xuất phát tốt: Agent quyết định, tool/persistence cung cấp cơ chế. Nhưng checkout tham khảo tổ chức nhiều pipeline/stage và có hệ tool/provider/render rộng hơn. Sự hiện diện của code không chứng minh các provider đó hoạt động trong môi trường hiện tại; lần này không chạy OpenMontage hoặc gọi dịch vụ của nó.[12]

| Cơ chế đáng học | Cách áp dụng phù hợp PADStudio |
| --- | --- |
| Ba lớp: khả năng, cách làm, kiến thức công nghệ | Giữ registry, skill và artifact riêng vai trò; tránh lặp chi tiết provider trong lõi |
| Asset manifest có nguồn gốc | Giữ nguồn/ý định tạo/phiên bản/chi phí khi có; liên kết resource/result và segment hiện hữu |
| Voice performance + sample | Khi có TTS: lưu nhịp, nhấn, cách đọc thuật ngữ; duyệt một đoạn khó trước khi tạo nhiều đoạn |
| Delivery promise | Thể hiện rõ trong direction/criteria sản phẩm hứa tạo ra; không âm thầm hạ chất lượng để tool dễ chạy |
| Reviewer có đề xuất sửa cụ thể | Mỗi finding trỏ đúng đoạn/bản và nói cách sửa kiểm chứng được |
| Estimate → reserve → reconcile | Học vòng đời chi phí, bổ sung binding và recovery phù hợp trước provider đầu tiên |
| Style/typography guidance | Đưa kiến thức đọc chữ, mật độ thông tin, nhịp dựng vào skill và review mẫu thực tế |

Các ý trên có nguồn cụ thể trong `asset_manifest.schema.json`, `voice-performance-director.md`, `delivery_promise.py`, `reviewer.md`, `cost_tracker.py` và `typography.md` của checkout.[13]

Hai điểm nên chủ động tránh: reviewer OpenMontage cho đi tiếp với warning sau hai vòng dù vẫn còn critical finding; PADStudio nên giữ gate đã chốt và làm rõ với người dùng nếu không đạt. Ngoài ra approval theo tên tool trong cost tracker tham khảo không tự đủ để chứng minh người dùng đã duyệt chính request/input/chi phí hiện tại. Học phương pháp và test case có giá trị hơn bê nguyên cơ chế vào lõi.

**7. Chuẩn bị triển khai tiếp**

Đề xuất ưu tiên là một **lát cắt nguyên liệu cho video giáo dục ngắn**, tận dụng khả năng hiện có và chỉ thêm thứ được chứng minh là thiếu. Không mặc định cần tạo ảnh, video, nhạc và giọng đọc cùng lúc.

Trước khi viết capability mới, cần một bản mô tả ngắn trả lời: sản phẩm mới giúp người xem hiểu điều gì; nguồn nào dùng được; cụ thể đoạn nào thiếu hình/lời/âm thanh; vì sao công cụ hiện có chưa đủ; người dùng sẽ kiểm tra mẫu bằng tiêu chí nào. Có thể dùng video hiện có làm tư liệu tham khảo, nhưng sản phẩm thử mới cần có nhu cầu khác việc cắt lại mẫu đã hoàn thành.

| Nhu cầu được xác nhận | Phạm vi triển khai hợp lý |
| --- | --- |
| Lời gốc đủ, chỉ thiếu nhấn mạnh ý | Tái dùng tool/sequence; cân nhắc phần bố cục hoặc chữ nếu pilot chứng minh cần |
| Thiếu một câu nối hoặc lời giải thích | Ưu tiên audio người dùng cung cấp nếu phù hợp; nếu cần TTS, mở đúng một capability và một đường thực thi |
| Thiếu hình minh họa cụ thể | Chọn một cách tạo/tìm nguyên liệu phù hợp; giữ bằng chứng nguồn và revision |
| Cần dịch vụ trả phí | Chốt approval/cost/recovery trước lần gửi request thực tế |

Nếu chọn lời đọc mới làm pilot Đợt 3, phạm vi có thể là: tạo một đoạn lời đọc tiếng Việt ngắn theo direction hiện hành của project mới; xem/nghe mẫu; giữ phiên bản được chọn; đưa vào một segment; sửa nội dung một lần; mở lại vẫn biết chính xác bản nào đã được duyệt và công việc nào còn thiếu. Chỉ chọn provider sau khi tiêu chí giọng, thuật ngữ, môi trường và chi phí đã rõ.

Tiêu chí nghiệm thu nên tập trung vào kết quả: nguyên liệu tạo/nhập được, preview và dùng tiếp được; truy ngược đúng request/source/revision; input cũ nguyên vẹn; lỗi không tạo kết quả giả; sửa một phần giữ phần khác; approval không kế thừa sai; request trả phí nếu có không bị gửi lại ngoài ý muốn; observer cho thấy bản đang dùng và điều đang chờ. Không cần một danh sách tích hợp dài để đạt Đợt 3.

Sau đó, Đợt 4 hoàn thiện đúng nhu cầu dựng lộ ra từ pilot; Đợt 5 nối phản hồi và phiên bản dễ theo dõi hơn; Đợt 6 hoàn thiện kiểm tra đầu ra, bàn giao và khả năng mở lại. Mỗi đợt vẫn cần UI thiết yếu và verification ngay trong phạm vi của mình.[2]

Bước triển khai gần nhất nên là **chốt bài toán nguyên liệu và mẫu nghiệm thu Đợt 3**, đồng thời tái sử dụng kho project, workflow, executor và renderer hiện có. Nền tảng đã đủ để làm bước này; chưa có lý do từ bằng chứng hiện tại để viết lại lõi, xây timeline tổng quát hoặc tích hợp hàng loạt provider.

**Nguồn đối chiếu**

[1] PADStudio, [Thiết kế](../docs/build/PADSTUDIO-DESIGN.md) và [Định hướng hiện tại](../docs/build/PADSTUDIO-CURRENT-DIRECTION.md), checkout 0026aa8.

[2] PADStudio, [Lộ trình 6 đợt](../docs/build/PADSTUDIO-ROADMAP.md), cập nhật 11/09/2026.

[3] PADStudio, [README](../README.md), [Agent runtime](../PADSTUDIO-AGENT-RUNTIME.md), [package.json](../package.json).

[4] PADStudio, [Project intelligence contract](../docs/build/PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md), [Project store](../src/project/project-store.js), [Intelligence store](../src/intelligence/project-intelligence-store.js).

[5] PADStudio, [Registry](../src/execution/default-tool-registry.js), [Executor](../src/execution/tool-executor.js).

[6] PADStudio, [Video sequence contract](../docs/build/VIDEO-SEQUENCE-PRODUCTION.md), [Renderer](../src/tools/ffmpeg-sequence-renderer.js).

[7] PADStudio, [Source Understanding gói F](../docs/build/SOURCE-UNDERSTANDING-PACKAGE-F.md), [Analysis service](../src/analysis/analysis-service.js), [Analysis reader](../src/analysis/analysis-reader.js).

[8] PADStudio, [Creative Direction spec](../docs/build/CREATIVE-DIRECTION-SPEC.md), [Creative contracts](../src/intelligence/creative-artifacts.js).

[9] PADStudio, [Pilot gói C](../docs/build/CREATIVE-DIRECTION-PACKAGE-C.md), [Nghiệm thu gói E](../docs/build/CREATIVE-DIRECTION-PACKAGE-E.md), [Báo cáo nghiệm thu đã lưu](phase2-creative-direction-acceptance.json); đối chiếu thêm project runtime local phase2-brute-force-pilot ngày 11/09/2026.

[10] PADStudio, [Baseline](../eval/source-understanding/BASELINE-REPORT.md), [Practical review](../eval/source-understanding/PRACTICAL-REVIEW.md), 08/09/2026; đối chiếu metadata 25 video local ngày 11/09/2026.

[11] PADStudio, [Project context assembler](../src/intelligence/project-context-assembler.js), build và buildSummary.

[12] OpenMontage, D:/OpenMontage/PROJECT_CONTEXT.md và pipeline_defs/, checkout cd9f3c1; nguồn local được cung cấp, không xác minh trạng thái upstream.

[13] OpenMontage, D:/OpenMontage/schemas/artifacts/asset_manifest.schema.json; skills/meta/voice-performance-director.md; skills/meta/reviewer.md; skills/creative/typography.md; lib/delivery_promise.py; tools/cost_tracker.py; tools/audio/tts_selector.py, checkout cd9f3c1.

Kết quả kiểm tra được tổng hợp trong mục 4 của báo cáo này; log chi tiết local .cache/review-tests-20260911.txt và .cache/review-browser-20260911.json không được lưu trong Git.
