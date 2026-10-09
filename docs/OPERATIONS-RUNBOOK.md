# PADStudio — runbook vận hành practical

## 1. Điều kiện và khởi động

Yêu cầu nền: Windows, Node.js 20+, FFmpeg/ffprobe, Python/profile phân tích đã khóa và Chrome cho graphic/browser acceptance. Không cần ElevenLabs nếu dùng Piper local.
Python phân tích (cắt cảnh, ASR) và model Whisper được cài một lần theo [`eval/source-understanding/README.md`](../eval/source-understanding/README.md),
mục “Cài môi trường”; sau đó `npm run analysis:doctor` phải báo `ready`. Doctor xếp cắt cảnh và ASR vào nhóm “khuyến nghị”: máy chưa cài
chỉ báo `attention` kèm cách cài, không `blocked`, vì việc dựng video từ đầu không cần chúng.

Từ thư mục repository:

    npm run padstudio:doctor
    npm run system:profile
    npm start

Mở `http://127.0.0.1:7603`. Server chỉ bind localhost và không có endpoint nào ghi vào project. Trang **Công cụ**
(`/?panel=tools`) là chỗ duy nhất web ghi: khóa API và dịch vụ người dùng khai báo, vào `padstudio.local.json`. Nó chỉ nhận request
từ chính trang đó (cùng Origin, JSON, header `X-PADStudio-Intent`) và không bao giờ trả lại khóa. File này chứa khóa API: khi sao lưu,
giữ nó riêng tư; đổi khóa ở nhà cung cấp nếu file bị lộ.

Doctor nhanh kiểm runtime, disk, capability và health metadata. Khi nghi file Result bị đổi hoặc trước bàn giao quan trọng:

    npm run padstudio:doctor -- --deep <project-id>

Doctor không cài dependency, không tải model và không sửa project. Exit code 0 là ready/attention có JSON chi tiết; 2 là system blocked; 1 là lỗi gọi/đọc.

`system:profile` là lớp lập kế hoạch read-only: CPU/RAM/GPU/disk, FFmpeg encoder candidate, live
capability menu, composition runtime, setup offer và resource risk. Nó không benchmark, không đọc giá
trị secret và không thay thế exact availability/preflight của tool được chọn.

## 2. Tạo, nhập và quan sát project

    npm run project:create -- <project-id> "Tên project"
    npm run project:import -- <project-id> "D:\path\to\media"

Agent đọc context và điều khiển công việc; web chỉ quan sát. Không đặt raw path vào artifact/tool input: luôn dùng resource/result/artifact ID đã đăng ký.

### Thư mục dữ liệu

Mặc định mọi project nằm ở `.padstudio/projects` cạnh mã nguồn và archive ở `.padstudio/archive/projects`. Đặt biến môi trường
`PADSTUDIO_PROJECT_ROOT` (tuyệt đối, hoặc tương đối so với thư mục đang chạy) để dùng kho khác; archive mặc định nằm cạnh đó
(`<root>/../archive/projects`) hoặc đặt riêng bằng `PADSTUDIO_ARCHIVE_ROOT`. Mọi lệnh CLI và observer dùng cùng cấu hình này; giá trị
rỗng bị từ chối thay vì lặng lẽ dùng mặc định. Các script acceptance lịch sử trong `scripts/` vẫn dùng đường dẫn mặc định.

## 2.1 Dung lượng

Output của một Run đã hoàn tất chỉ nên chứa file mà Result của nó đăng ký. Executor tự xóa phần còn lại (thư mục làm việc tạm, cache
của bundler) trước khi lưu output, nhưng các Run cũ trước thay đổi này đã để lại hàng chục GB scratch (tại 2026-10-09: 42,9 GB trong tổng 53,4 GB
của 26 project). Hai lệnh dưới đây xử lý phần đó; cả hai chỉ lập kế hoạch/đo mặc định:

    npm run project:usage -- --all                 # tổng dung lượng và phần có thể thu hồi theo từng project
    npm run project:usage -- <project-id> [--full] # phân tích một project, theo Run
    npm run project:prune -- <project-id>          # kế hoạch dọn, không xóa gì
    npm run project:prune -- <project-id> --apply  # thực sự xóa
    npm run project:prune -- --all [--apply]       # mọi project
    npm run project:prune -- <project-id> --run <run-id,...> [--apply]

Chỉ file nằm trong output của Run **đã hoàn tất** mà không Result nào đăng ký mới bị xóa. File đã đăng ký, `inputs/`, bản ghi JSON, Run
đang chạy hoặc đã lỗi, thư mục không có bản ghi Run và thư mục tạm `.run-*` không bao giờ bị chạm tới. Apply lập lại kế hoạch bên trong
khóa project, ghi một bản ghi append-only vào `prunes/` và kiểm tra mọi file đăng ký của các Result bị ảnh hưởng vẫn còn nguyên (nếu không,
trạng thái là `integrity_failure` và lệnh thoát với mã 2). Chạy lại là idempotent. Sau khi dọn, `padstudio:doctor --deep` xác minh lại checksum.

### Sau khi chốt: chỉ giữ bản cuối

    npm run project:finish -- <project-id> | --all           # kế hoạch: giữ gì, phát hành gì
    npm run project:finish -- <project-id> | --all --apply   # thực sự phát hành

Với project đã có Delivery và quyết định duyệt, giữ nguyên Delivery mới nhất và Result nguồn của nó, cùng audio và văn bản (lời đọc, nhạc, kịch bản, mã nguồn hoạt họa)
của mọi thứ bản cuối được làm từ đó; phát hành file còn lại (video/ảnh trung gian, frame, QA, phân tích). Không bao giờ chạm tới bản ghi (Result/Run/decision/artifact/review), `inputs/` hay Delivery. Lệnh ghi `releases/<id>.json` **trước khi**
xóa, nên một file vắng mặt sau đó được biết là cố ý (`released`) chứ không phải hỏng; `padstudio:doctor` và health không báo nó. Từ chối
khi chưa có Delivery nguyên vẹn (SHA-256), thiếu quyết định duyệt hoặc còn Run đang chạy. Không hoàn tác được: bản đã phát hành chỉ còn
trong Delivery.

## 3. Phục hồi

Đầu tiên chỉ lập kế hoạch:

    npm run project:recover -- <project-id>

Đọc từng action. Chỉ khi action `safeToApply: true`:

    npm run project:recover -- <project-id> --apply

Apply chỉ hoàn tất run đã có đúng một Result/output bền vững và runCompletion. Nó không render lại, không gọi provider và không xóa dữ liệu. Chạy lại là idempotent. Action blocked/skipped cần kiểm tra thủ công Result, output và authorization receipt.

Với một run đã biết, lệnh tương thích cũ vẫn tồn tại:

    npm run project:run:recover -- <project-id> <run-id>

## 4. Backup và restore

Khi backup nhất quán:

1. dừng PADStudio và bảo đảm không còn tool/analysis đang chạy;
2. chạy doctor, xử lý hoặc ghi nhận pending finalization;
3. sao chép nguyên thư mục `.padstudio` sang volume backup để giữ cả project active và archive;
4. giữ nguyên cấu trúc file và kiểm checksum của công cụ backup.

Restore vào một thư mục trống, không trộn từng phần của hai snapshot. Sau restore chạy doctor `--deep` trước khi tiếp tục. Không sửa JSON lịch sử bằng tay để “khớp” file.

## 4.1 Archive project đã hoàn thành

Archive chỉ dùng khi PADStudio và các Agent khác đã dừng, project không còn Run đang chạy:

    npm run project:archive -- archive <project-id> "Lý do archive" --confirm-stopped
    npm run project:archive -- list

Project được di chuyển nguyên vẹn từ `.padstudio/projects` sang `.padstudio/archive/projects` và có `archive.json`; observer/Agent runtime mặc định không còn liệt kê nó. Khôi phục mà không trộn dữ liệu:

    npm run project:archive -- restore <project-id> --confirm-stopped

Lệnh từ chối ghi đè project active/archive cùng ID và từ chối archive khi còn Run `in_progress`.

## 5. Bàn giao video

Delivery chỉ dùng exact `video.sequence-render` có Decision mới nhất là `accepted` (ghi bởi `project:accept`, hợp lệ với đúng Result đó) và byte nguồn còn khớp SHA-256 đã lưu. Delivery không render lại, không đổi codec và không chặn vì QA, profile, loudness hay dependency freshness; các bằng chứng đó, nếu có, được đóng gói ở trạng thái advisory. Bundle gồm:

    video/output.mp4
    metadata/manifest.json
    metadata/provenance.json
    metadata/reviews.json
    metadata/approval.json
    metadata/quality.json
    metadata/checksums.sha256

Tải qua khu vực Delivery trong Observer. Kiểm `checksums.sha256` sau khi chép bundle sang nơi nhận.

## 6. Chẩn đoán thường gặp

| Trạng thái | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `missing_resources` | File nguồn đã mất/di chuyển | Khôi phục đúng bytes hoặc import resource mới và rebase |
| `missing_result_files` | Output lịch sử mất/sai kích thước | Restore backup hoặc chạy lại từ nguồn; không sửa Result cũ |
| `recoverable_finalizations` | Result đã bền vững, run chưa completed | Plan rồi `--apply` |
| `unrecoverable_finalizations` | Thiếu bằng chứng an toàn | Kiểm output/Result/receipt; không lặp paid request |
| `claimed_authorizations` | Credit authorization chưa settle | Đối chiếu provider receipt và run |
| `pending_feedback` | Changes requested chưa resolve | Tạo/review bản thay thế và resolve bằng Decision |
| `blocked_active_production` | Current sequence stale/missing | Khôi phục nguồn hoặc tạo revision mới |
| `stale_checkpoint` | Có hoạt động mới hơn checkpoint | Xác nhận rồi ghi checkpoint mới |

## 7. Nâng cấp và rollback

Trước nâng cấp: backup project, ghi commit hiện hành, chạy full acceptance. Nâng code bằng commit mới nhưng không migrate/sửa dữ liệu lịch sử ngoài migration đã review. Nếu code mới lỗi, quay lại commit code trước và dùng snapshot project tương ứng; không dùng Git để reset thư mục project của người dùng.

Các lệnh nghiệm thu:

    npm test
    npm run analysis:test
    npm run delivery:acceptance
    npm run operations:acceptance

Giới hạn: practical readiness trên máy owner không phải chứng nhận phát hành rộng; `releaseDefault` vẫn `null`.
