# PADStudio — trạng thái phát triển

Cập nhật: **2026-10-09** (đối chiếu tài liệu với code; xem mục “Đối chiếu tài liệu với code”).

Đây là điểm vào ngắn để biết codebase đang ở đâu. PADStudio vẫn đang được xây dựng và chỉnh
chu; các báo cáo có chữ `completion`, tên đợt hoặc số phiên bản ghi lại một mốc nghiệm thu kỹ
thuật, không tuyên bố sản phẩm đã hoàn chỉnh hoặc sẵn sàng phát hành rộng.

## Trạng thái hiện tại

- Ranh giới sản phẩm hiện hành vẫn là Agent host bên ngoài điều khiển, project local giữ nguồn
  sự thật và web observer chỉ đọc.
- Kho project, Resource/Run/Result, artifact có revision, workflow thích nghi, review, decision,
  checkpoint, recovery, QA và local delivery đã có đường triển khai và test.
- Source understanding, sequence composition, asset preparation, TTS và code animation local là
  các lát cắt đã dùng được trong phạm vi đã kiểm chứng; chúng không đồng nghĩa với một studio đã
  bao phủ mọi loại video, provider hoặc môi trường.
- Workflow mẫu là điểm bắt đầu tùy chọn. Không có pipeline chung bắt buộc cho mọi project.
- Intake và creative direction hướng Agent tự quyết định từ brief ngắn sau khi xem tư liệu liên quan; Agent phải nêu rõ các lựa chọn lớn khi bỏ qua nguồn đáng kể. Agent review sáng tạo trên exact video mới phải khai phạm vi xem chuyển động và nghe tiếng; review mẫu không được trình bày như đã xem/nghe toàn bộ. Observer hiển thị phạm vi này. Review cũ vẫn đọc được.
- Choreography 1.3 là nhánh tùy chọn cho giải thích bằng hoạt họa: giữ lập luận thị giác do Agent
  đạo diễn, lưu minh chứng bằng hình và footprint chữ chính xác cho review; không tự đảm bảo chất
  lượng hình ảnh khi chưa preview/xem một video thật.
- Broad release chưa được chứng nhận. `npm run release:gates` hiện cố ý fail-closed khi chưa có
  corpus, phép đo và human evidence độc lập.

## Baseline kiểm chứng

Lần chạy full gần nhất, ngày **2026-10-09** (sau toàn bộ các vòng giao diện bên dưới, Node v24.18.1):
`npm test` **332/332 pass**. Các số 326/326 ghi trong các mục ngày 2026-10-04/05 là ảnh chụp trước
các vòng giao diện cuối; browser smoke không được chạy lại trong lần này.

Vòng tinh giản khung và phân vùng bằng đường kẻ ngày **2026-10-05**:

- Bỏ khung hộp bao quanh video, tiêu đề/thao tác, phiên bản, vùng chọn/xem tư liệu, nội dung và
  chi tiết dự án. Dùng khoảng cách và đường kẻ 1 px: chia cột trên desktop, chia hàng trên mobile;
  video ngang có một đường phân cách giữa phần điều khiển và video. Giữ khung video theo tỷ lệ,
  cửa sổ chọn dự án, menu và các điều khiển cần nhận biết. Giữ đầy đủ tên/tagline, logo trong suốt,
  font local và họa tiết mảnh ở rìa nền. Chỉ sửa CSS và hướng dẫn trình bày.
- Browser smoke cafe/BFS/GPS **passed** ở 390/768/1440 px; cafe thêm 320/1024/1920 px
  **passed**, kho trống/project mới **passed**. Đã xem desktop/mobile, sáng/tối, video dọc/ngang,
  tư liệu, nội dung và so sánh. Không tràn ngang, logo/font tải được, phát/chọn phiên bản/tải
  Delivery/điều hướng bàn phím vẫn hoạt động; không có uncaught error hoặc request ghi.
  Không chạy lại Node/full suite trong vòng CSS này. Evidence: `.cache/ui-divider-review/`,
  `.cache/ui-focus-review/empty-*`.

Vòng nhận diện đầy đủ và phân vùng giao diện ngày **2026-10-05**:

- Khôi phục chữ **PADStudio** và **Precise Animated Demonstration Studio** bên cạnh logo tách
  nền, luôn hiển thị cả trên điện thoại. Dời bộ chọn dự án sang nhóm điều hướng; header co thành
  hai hàng khi cần để thương hiệu và các nút không chồng nhau. README/brand guide cùng tên đầy đủ.
- Vùng video dùng nền dịu, thông tin/thao tác và phiên bản dùng các bề mặt riêng với viền mảnh;
  tư liệu có vùng chọn/xem riêng, nội dung và chi tiết có khung rõ. Giảm khoảng trống trên tablet.
  Nền ngoài có vài đường cong 1 px ở rìa bằng CSS, nhẹ hơn trên mobile, không chặn thao tác.
- **18/18 targeted UI tests pass**. Browser smoke cafe/BFS/GPS **passed** ở 390/768/1440 px;
  cafe thêm 320/1024/1920 px **passed**, kho trống/project mới **passed**. Kiểm tra tên/tagline
  chính xác, logo/font tải được, header không chồng nhau, không tràn ngang khi mở chi tiết.
  Đã xem desktop/mobile, sáng/tối, video dọc/ngang, tư liệu và so sánh. Không có uncaught error
  hoặc request ghi. `observer:ui:live-test` **passed**: trạng thái đang dựng, preview đầu tiên,
  giữ phát liên tục, đổi bản tự động và giữ lựa chọn thủ công. Full suite chưa chạy lại vòng này.
  Evidence: `.cache/ui-region-review/`, `.cache/ui-focus-review/empty-*`, `.cache/ui-polish/live/`.

Vòng cân chỉnh chữ và tỷ lệ giao diện ngày **2026-10-05**:

- Dùng Manrope variable có tiếng Việt, lưu font và giấy phép OFL trong `ui/fonts/`; web tải font
  local qua một asset allowlist cụ thể. Thống nhất chữ nội dung 15–16 px, nhãn 14 px, chữ phụ
  12–13 px; tiêu đề nhẹ hơn và co theo khung, tránh dòng cuối quá ngắn khi có thể.
- Cân lại chiều cao nút, logo, khung video/chờ, khoảng cách và độ rộng nội dung trên bốn view,
  bộ chọn dự án; giữ nguyên logo tách nền và hành vi project. Font có preload và fallback hệ thống.
- **9/9 reader/observer tests pass**. HTTP xác nhận font đúng byte/MIME, các file khác trong
  thư mục font không được phục vụ. Browser smoke cafe/BFS/GPS **passed** ở 390/768/1440 px;
  cafe thêm 320/1024/1920 px **passed**, kho trống/project mới **passed**. Browser xác nhận font
  local tải được; đã xem ảnh sáng/tối, desktop/mobile, tiêu đề dài, video dọc/ngang và so sánh.
  Không có uncaught error hoặc request ghi. Full suite chưa chạy lại trong vòng trình bày này.
  Evidence: `.cache/ui-type-balance/`, `.cache/ui-focus-review/empty-*`.

Vòng chọn logo tách nền ngày **2026-10-05**:

- Theo lựa chọn của người dùng, logo mặc định là `padstudio-emblem-transparent.png` trên thanh
  đầu web, favicon, dấu trang thiết bị và README; bỏ khung nền đen, giữ nguyên ảnh PNG gốc.
  Hai ảnh nền đen được giữ làm tài nguyên phụ. Quy ước nhận diện đã cập nhật theo lựa chọn này.
- Browser smoke cafe **passed** ở 390/768/1440 px, đã xem ảnh desktop/mobile và sáng/tối.
  Logo/favicons tải được, nền khung trong suốt, không tràn ngang, không có uncaught error hoặc
  request ghi. Chỉ đổi trình bày/tài nguyên nhận diện; không chạy lại Node/full suite.
  Evidence: `.cache/ui-brand-transparent/`.

Đợt thống nhất nhận diện ngày **2026-10-05**:

- Thanh đầu web dùng chính signature PADStudio người dùng cung cấp, viewport gọn bỏ tagline ở
  kích thước nhỏ. Màn hình chào/chờ video, favicon và biểu tượng dấu trang thiết bị dùng cùng bộ
  ảnh gốc; thay favicon chữ P vẽ lại bằng nguyên ảnh biểu tượng PAD được nhúng trong SVG.
  Tên tab/dấu trang thống nhất PADStudio. Quy ước dùng chung ghi tại `ui/brand/README.md`.
- Kiểm tra byte xác nhận ba PNG vẫn trùng nguồn trong Downloads và nội dung HTTP; favicon chứa
  đúng byte của ảnh biểu tượng. **18/18 targeted UI tests pass**. Browser smoke cafe **passed**
  ở 320/390/768/1024/1440/1920 px, kho trống/project mới **passed**. Đã xem logo và bố cục sáng/tối,
  desktop/mobile; logo/favicons tải được, không tràn ngang, không có uncaught error hoặc request ghi.
- `observer:ui:live-test` **passed** trên kho tạm: logo ở màn hình đang dựng, preview đầu tiên tự
  xuất hiện, giữ phát liên tục, đổi bản tự động khi sẵn sàng và giữ lựa chọn thủ công. Vòng này
  chỉ sửa UI/nhận diện/tài liệu và kiểm tra browser; full suite chưa chạy lại.
  Evidence: `.cache/ui-brand-system/`, `.cache/ui-focus-review/empty-*`, `.cache/ui-polish/live/`.

Đợt giao diện ngày **2026-10-04**:

- `npm test`: **326/326 pass**.
- Vòng nhận diện PADStudio: lưu nguyên byte ba PNG người dùng cung cấp trong `ui/brand/`, tên file
  theo vai trò; dùng biểu tượng trong suốt trên web, signature trong README và favicon vector.
  **9/9 reader/observer tests pass**. Kiểm tra HTTP xác nhận bốn asset đúng byte/MIME; file ngoài
  allowlist và traversal không được phục vụ. Browser smoke cafe/GPS **passed** ở 390/768/1440 px,
  cafe ở 320/1024/1920 px cũng **passed**; kho trống/project mới **passed**, logo và favicon tải được.
  Đã xem sáng/tối và mobile. Full suite
  chưa chạy lại trong vòng này. Evidence: `.cache/ui-brand/`.
- Vòng sửa cách xuống dòng tiêu đề: browser smoke với cafe, BFS và GPS **passed** tại
  390/768/1440 px; kiểm tra thêm BFS ở 320/1024/1920 px **passed**. Đã xem ảnh tiêu đề, video
  dọc/ngang và so sánh: tên cà phê vừa một dòng desktop, tên dài xuống dòng khi hết chỗ, không
  tràn ngang. Chỉ sửa CSS và tài liệu; không chạy lại Node/full suite cho thay đổi trình bày này.
  Evidence: `.cache/ui-title-flow/`.
- Vòng chỉnh chu bố cục và quan sát lúc đang làm: **18/18 targeted UI tests pass**. Browser smoke
  với cafe, GPS (video ngang) và BFS (có Delivery) **passed** tại 390/768/1440 px; kho trống/project
  mới riêng cũng **passed**. `npm run observer:ui:live-test` **passed** trên ProjectStore trong thư
  mục tạm: trạng thái trước video đầu tiên, preview tự xuất hiện qua polling, giữ nguyên player và
  phát liên tục khi revision mới chưa có video, chuyển sang bản mới khi sẵn sàng, giữ bản người dùng
  chọn thủ công. Kiểm tra cả video chưa duyệt không có nút tải Delivery. Không có uncaught error
  hoặc request ghi từ web. Full suite ở trên chưa chạy lại trong vòng này.
- Vòng bố cục tập trung vào video: **12/12 targeted UI tests pass**. Browser smoke với
  `test-ca-phe-phin`, `bfs-visual-explainer-20260929`, `priority-queue-visual-20260920` và
  `gps-tim-duong-3phut` **passed** ở 390/768/1440 px. Đã kiểm tra nút phát/tạm dừng, lựa chọn exact
  Result, so sánh, đánh dấu/tua đoạn, tỷ lệ khung theo video dọc/ngang, tìm tư liệu/project,
  polling không thay player, bàn phím, sáng/tối, đổi project và mất kết nối/thử lại.
  Vòng cafe cuối kiểm tra mở lại trang chủ không có project ID vẫn khôi phục đúng project vừa chọn;
  ảnh so sánh desktop/mobile được xem sau khi bỏ danh sách đoạn của bản đối chiếu.
  `observer:ui:empty-test` **passed** trên kho trống/project mới riêng trong thư mục tạm.
  Không có uncaught error hay request ghi. Full suite 326/326 ở trên được chạy trước vòng bố cục này;
  vòng này không sửa `src/` hoặc contract project.
- Vòng làm mới diện mạo sau đó: **12/12 targeted UI tests pass** (`production-result-view`,
  `creative-direction-view`, `source-analysis-view`); browser smoke với `bfs-visual-explainer-20260929`
  và `test-ca-phe-phin` **passed** tại 390, 768 và 1440 px. Kiểm tra thêm đánh dấu đoạn đang phát
  khi tua tới đoạn tiếp theo rồi quay lại đầu video. Không có uncaught error hay request ghi.
  `observer:ui:empty-test` cũng **passed** với diện mạo mới. Full suite ở dòng trên được chạy
  trước vòng đổi màu, typography và bổ sung đánh dấu đoạn này.
- `npm run observer:ui:test -- -ProjectId bfs-visual-explainer-20260929` và cùng lệnh với
  `test-ca-phe-phin`, `priority-queue-visual-20260920`: **passed**. Kiểm tra bốn view ở 390, 768 và 1440 px, cả khi mở chi tiết;
  tìm dự án và tư liệu, phát/tua theo đoạn, đổi bản và đối chiếu, kiểm tra link tải đúng Delivery,
  giữ player qua polling, đổi project, bàn phím,
  bộ chọn dự án desktop/mobile (focus, vòng Tab, chọn lại dự án hiện tại), sáng/tối và mất kết nối/thử lại.
  Không có uncaught JavaScript error hay request ghi.
- `npm run observer:ui:empty-test`: **passed** trên thư viện trống và project mới trong kho tạm độc lập.
- `npm run observer:browser-test -- -ProjectId priority-queue-visual-20260920 -StructureOnly`:
  **passed** tại 390, 768 và 1440 px.
- `npm run observer:phase5a:test -- -ProjectId bfs-visual-explainer-20260929 -SequenceKey bfs-review-sequence`:
  **passed** với viewer hiện hành; kiểm tra tên ID phục vụ accessibility, exact Result chọn xem
  và link tải đúng Delivery. Timeline visual baseline cũ không còn áp dụng.
- Đã xem ảnh chụp desktop/mobile và sáng/tối. Evidence của browser nằm trong
  `.cache/ui-polish/` (chỉnh chu và tiến độ trực tiếp), `.cache/ui-viewing-room/`, `.cache/ui-fresh-review/` (diện mạo vòng trước), `.cache/ui-focus-review/` (bố cục và trạng thái trống), `.cache/ui-layout-review/` và
  `.cache/ui-review/` (các vòng trước);
  đây là evidence phát triển UI, không phải output/delivery của video.
- Fixture `phase3-vd04-asset-pilot` của smoke Phase 5A trong report lịch sử
  không còn là project đã khởi tạo; API hiện trả lỗi khi đọc fixture này. Không tái tạo project hoặc
  thay đổi core để phục vụ một báo cáo cũ. Entry point Phase 5A/6B nay chạy smoke của viewer
  hiện hành. Baseline ảnh timeline cũ đã được ngừng sử dụng vì UI đó được bỏ; ảnh viewer mới
  được chụp để review, chưa có baseline ảnh tự động mới. Contract provenance/feedback/QA vẫn
  được kiểm tra ở bộ Node tests, không yêu cầu người xem mở chúng trên màn hình chính.

Các mốc kiểm chứng trước đợt giao diện, ghi ngày **2026-09-22**:

- Lần chạy full gần nhất, `npm test`: **317/317 pass**;
- Vòng sửa chữa preview/review/Observer hiện tại: **34/34 targeted tests pass**; chưa chạy lại toàn bộ suite;
- `npm run observer:browser-test -- -ProjectId priority-queue-visual-20260920 -StructureOnly`: **passed** với observer server đang chạy, tại 390, 768 và 1440 px;
- `npm run animation:acceptance`: **passed** (local Remotion preflight, preview và render một fixture
  độc lập trong thư mục tạm; không phải pilot sáng tạo của người dùng);
- Lần đo coverage gần nhất (trước đợt 1.3): `node --test --experimental-test-coverage`:
  **83,10% line**, **73,73% branch**, **89,69% function**;
- `npm run release:gates`: **blocked**, 16/16 gate `not_measured`, `releaseDefault: null`.

Các số trên là ảnh chụp tại ngày ghi nhận, không phải giá trị tự cập nhật. Khi chúng khác kết quả
lệnh đang chạy, ưu tiên kết quả từ code và test hiện tại rồi cập nhật lại trang này. Acceptance
report trong `reports/` và `eval/**/reports/` là bằng chứng của lần chạy đã ghi ngày, không phải
dashboard trạng thái.

## Đối chiếu tài liệu với code — 2026-10-09

Một lượt đọc code và đối chiếu có hệ thống, chỉ sửa tài liệu (không đổi `src/`, `test/`, `ui/`).

**Đã kiểm tra bằng máy:** 65 file `.md` (liên kết tương đối, mọi `npm run <script>` có trong `package.json`,
mọi script trỏ tới file tồn tại); registry mặc định chạy thật cho ra 29 capability / 36 tool; tên tool và field của mọi ví dụ trong
reference được so với `inputSchema`, còn enum/giới hạn của trim, concat, reformat, thumbnail, audio overlay,
image-to-video và quality được so thêm với code; cú pháp CLI
(`tool:list`, `padstudio:doctor`, `project:archive`, `project:recover`, `project:accept`,
`animation:preview-range`, `observer:ensure`); các thư mục project do code tạo; 8 section observer;
4 output profile; 19 skill; danh sách file của delivery bundle; `npm test` 332/332.

**Đã sửa vì lệch code:** `PADSTUDIO-REFERENCE.md` (số capability, mô tả delivery/QA gate đã lỗi thời, lệnh
`project:attest` đã ngừng, `project:accept`, cấu trúc project và mã nguồn, lệnh vận hành thiếu, số test cũ);
`PADSTUDIO-AGENT-REFERENCE.md` (tool preview/props/preflight hoạt họa, `animation:preview-range`,
`tool:plan`/`tool:authorize`, exit code của `quality:inspect`, ví dụ `video.export-delivery`, mục chẩn đoán);
`PADSTUDIO-AGENT-RUNTIME.md` và `README.md` (lệnh thiếu); `OPERATIONS-RUNBOOK.md` và
`PHASE6A-LOCAL-DELIVERY-SPEC.md` (điều kiện delivery hiện hành, thêm `quality.json`);
`OUTPUT-PROFILES-AND-STYLE-PLAYBOOKS.md` (4 profile, `profileId` tùy chọn); `CODE-ANIMATION-SPEC.md`
(delivery không còn bị QA chặn, preview-range); `ASSET-CAPABILITIES-SPEC.md` (stock search và
register-generated); `PROJECT-INTELLIGENCE-ADAPTIVE-WORKFLOW.md` (19 skill); `VIDEO-SEQUENCE-PRODUCTION.md`
(phân biệt sequence 1.0/1.1); `PHASE5A-OBSERVER-SPEC.md` (đủ 8 section); `SOURCE-UNDERSTANDING-SPEC.md`
và `HISTORICAL-DOCUMENTS.md` (không còn viết như chưa triển khai; liên kết OpenMontage ngoài repo thành
văn bản thường). `reports/`, `history/` và các mục có ngày trong `PADSTUDIO-CURRENT-DIRECTION.md` được giữ
nguyên vì là bằng chứng của từng thời điểm.

**Quan sát về code, chưa sửa (nằm ngoài phạm vi tài liệu):**

- `matchingDeliveryProfiles` / `deliveryProfilesForAcceptance` (`src/production/delivery-readiness.js`,
  `acceptance-readiness.js`) chỉ còn được test gọi; cả `project:accept` lẫn delivery không dùng chúng nữa.
  Có thể giữ cho kiểm tra trước duyệt hoặc xóa khi chốt hướng.
- Đường dẫn `.padstudio/projects` được ghép cứng ở 36 file CLI và `src/web/server.js`; không có biến
  môi trường để đổi gốc dữ liệu (test và script acceptance phải tự dựng store/server riêng).
- `generation` của observer duyệt toàn bộ cây file của mọi project mỗi lần poll (2 giây). Đo ngày
  2026-10-09 trên 26 project / ~33.700 file: ~300 ms mỗi lần. Chi phí tăng theo tổng số file, không theo
  mức thay đổi.
- `--from-agent-host` là lời khai của Agent host được ghi lại, không phải xác thực; tài liệu đã nói rõ
  điều này, nhưng code không thể phân biệt người dùng thật với Agent tự chạy lệnh.
- `src/tools/ffmpeg-sequence-renderer.js` có một ký tự BOM ở đầu dòng 2 (Node vẫn chạy bình thường).
- `pilot:real` (`scripts/real-project-pilot.mjs`) là script pilot một lần, gắn cứng project
  `real-pilot-longest-substring` và nguồn `vid15_*.mp4`; project đó không còn trong kho local, nên script
  không chạy được nếu không dựng lại. `observer:phase6b:test` chỉ là bí danh của smoke Phase 5A. Cả hai
  cố ý không được quảng bá trong tài liệu vận hành.
- Chưa đo chi phí đọc toàn bộ record của `ProjectStore.addResult` trên project rất lớn.

## Thứ tự nguồn sự thật

Khi các tài liệu có vẻ mâu thuẫn, dùng thứ tự sau:

1. Code, contract và test đang chạy.
2. [`PADSTUDIO-DESIGN.md`](PADSTUDIO-DESIGN.md) cho mục tiêu và ranh giới nền tảng.
3. [`PADSTUDIO-CURRENT-DIRECTION.md`](PADSTUDIO-CURRENT-DIRECTION.md) cho các quyết định thiết kế
   còn hiệu lực.
4. Trang này cho ảnh chụp trạng thái phát triển gần nhất.
5. Spec liên quan cho contract của đúng phân hệ đang xem.
6. Roadmap, Phase/Package, state report, completion report và acceptance report cho lịch sử và
   bằng chứng của từng mốc.

Không suy ra trạng thái hiện tại chỉ từ tên file, từ chữ `current`, `next`, `completion`, hoặc từ
số test nằm trong một báo cáo cũ.

## Đợt giao diện hiện tại

Web observer ưu tiên việc mở dự án, xem video và xem tư liệu. Điều hướng chính còn Video/Tư liệu;
Nội dung và Chi tiết dự án nằm trong menu. Video dọc giữ đúng tỷ lệ, nằm cạnh tên dự án lớn và
thao tác phát/tạm dừng, tải bản đã duyệt. Video ngang dùng bố cục trải rộng. Mobile xếp tên/video
thành một cột, giữ native media controls. Phiên bản và các đoạn nằm trong disclosure đóng mặc định;
exact Result, so sánh và tua theo đoạn vẫn hoạt động. Đoạn đang phát dùng `aria-current`.

Thanh điều hướng được căn giữa; tiêu đề dùng toàn bộ chiều rộng có sẵn và xuống dòng tự nhiên
khi không đủ chỗ, cỡ chữ thích ứng với chiều rộng vùng tên thay vì cân dòng sớm.
Disclosure Phiên bản cho biết bản đang xem
khi còn đóng. Trạng thái ngắn cạnh tiêu đề lấy từ Run/work item và approval đã lưu; Run có output
chờ recovery hiển thị đang chờ, không giả lập đang render. Không dựng phần trăm tiến độ hoặc suy
ra hoạt động từ một công việc chỉ ở trạng thái ready. Web đọc activity cùng các vùng nền qua GET
và chỉ tải thumbnail thư viện khi mở Tư liệu. Preview có thể xem trước acceptance/Delivery. Nếu
revision mới chưa có video, mặc định giữ bản khả dụng gần nhất; có video mới thì tự cập nhật,
trừ khi người xem đã chọn bản/lần dựng thủ công. Cập nhật giữ player khi URL video không đổi.
Tên dự án lấy nguyên từ metadata lúc tạo; giao diện không sinh hoặc đổi tên. Hoạt động/suy nghĩ
bên ngoài project của Agent host không phải dữ liệu web có thể quan sát.

Bộ chọn dự án là gallery có ảnh bìa thật từ Result, chỉ đọc ảnh khi card gần viewport, giới hạn
hai request đồng thời và cache theo generation. Project không có ảnh dùng một ô chữ. Web nhớ
dự án vừa mở trong localStorage; khi không có lựa chọn còn hợp lệ, mở dự án mới nhất. Thư viện
ưu tiên thumbnail của tư liệu gốc và media nhập; không đưa audio.tts trung gian của từng segment
lên thư viện chính. File đó vẫn nằm trong kho kết quả và project, không bị sửa hoặc xóa. Phân tích
nguồn/lời thoại nằm trong disclosure. Phần Nội dung ưu tiên lời thoại thật khi có, ý tưởng/brief/các
phương án chỉ mở khi cần. Kho kết quả, QA, provenance, run/workflow/health ở Chi tiết dự án.

Diện mạo dùng nền trung tính, điểm nhấn cyan theo logo PADStudio, typography sans lớn ở chủ thể, hạn chế khung card
và nhãn. Có chế độ sáng/tối, focus bàn phím và `prefers-reduced-motion`. Download trỏ đúng file của
Delivery mới nhất, không tạo hoặc thay đổi acceptance/delivery. Các thao tác trên web vẫn chỉ đọc,
phát media, điều hướng và giữ tùy chọn UI; lỗi kết nối hiện để thử lại.

Ảnh thương hiệu giữ nguyên trong [`ui/brand/`](../../ui/brand/README.md); bản trong suốt được
hiển thị qua SVG viewport để bỏ khoảng trống quanh logo mà không sửa PNG. Logo chữ đầy đủ và
tagline dùng trong README; header dùng biểu tượng PAD + Studio. `src/web/server.js` chỉ bổ sung
bốn static asset vào allowlist hiện có, không mở phục vụ thư mục tùy ý.

Đợt này sửa `ui/`, static asset allowlist, browser test và tài liệu trạng thái; không thay đổi API, project store,
CLI, tool, workflow, approval hoặc delivery. UI tư liệu được sửa để phát được file đã đăng ký
dưới dạng media kind hoặc MIME, và phát Result nguồn trực tiếp khi chưa có proxy riêng.
Thời gian proxy vẫn được quy đổi về đúng nguồn; test regression kiểm tra các trường hợp này.

## Các lát cắt trước đợt giao diện

Đợt này mở rộng contract `animation.choreography` lên 1.3 để Agent lập kế hoạch visual-first và
kiểm kê chữ theo beat; observer, skill authoring/review và test liên quan được cập nhật. Version
1.0–1.2 vẫn đọc được; workflow, approval, delivery, tool selection và ranh giới sản phẩm không đổi.
Chưa chạy một pilot render mới để chứng minh chất lượng sáng tạo của video đầu ra.

Vòng sửa chữa hiện tại bổ sung một shortcut project-native để tạo preview Remotion theo khoảng thời
gian từ đúng composition revision/preflight đã pass, hiển thị khoảng thời gian/frame và tùy chọn lặp
clip trong Observer để so chuyển động với tiếng, cùng lệnh `observer:ensure` có thể tái sử dụng hoặc
khởi động Observer local. Skill authoring/review hướng Agent chọn đoạn rủi ro theo nội dung và tự xem
chuyển động có voice trước khi đưa người dùng xem; đây không phải eval Greedy, template hình ảnh hay
bộ luật thẩm mỹ cứng.

Pilot recursion sau đó làm rõ hai lỗi vận hành ở đoạn chốt. `project:accept` nay kiểm tra exact media
khớp một delivery profile trước khi mở confirmation và tự đưa feedback còn chờ của đúng sequence vào
`resolvesDecisionIds`; người dùng không còn phải xác nhận lại chỉ vì lỗi profile hoặc thiếu cờ
`--resolves`. Sequence compositor xuất `yuv420p` limited range với metadata BT.709. Khi commit output,
ProjectStore xóa các thư mục runtime rỗng nhưng giữ nguyên mọi file và thư mục có nội dung. Project mới
chỉ tạo `project.json`; các kho con được tạo khi lần đầu có dữ liệu thay vì dựng sẵn nhiều thư mục rỗng.

Vòng dùng thật tiếp theo cho thấy chính profile/QA gate hậu duyệt vẫn gây lãng phí: người dùng đã chốt
file có thể sử dụng nhưng Agent phải sửa, render và xin duyệt lại để thỏa contract nội bộ. Baseline mới
coi acceptance trong Agent host là quyết định sáng tạo cuối. Agent ghi nó bằng `project:accept
--from-agent-host`; local delivery chỉ probe tối thiểu, copy exact byte và kiểm checksum. QA sâu, profile,
loudness, tail silence, promise review và freshness là kiểm tra trước duyệt hoặc evidence advisory, không
còn block local delivery sau acceptance. Terminal full-view/full-listen attestation vẫn có nhưng là tùy chọn.
