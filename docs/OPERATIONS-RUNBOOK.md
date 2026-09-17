# PADStudio — runbook vận hành practical

## 1. Điều kiện và khởi động

Yêu cầu nền: Windows, Node.js 20+, FFmpeg/ffprobe, Python/profile phân tích đã khóa và Chrome cho graphic/browser acceptance. Không cần ElevenLabs nếu dùng Piper local.

Từ thư mục repository:

    npm run padstudio:doctor
    npm run system:profile
    npm start

Mở `http://127.0.0.1:7603`. Server chỉ bind localhost và Observer không có mutation endpoint.

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

Delivery chỉ dùng exact `video.sequence-render` có latest user Decision là `accepted`, dependency current, feedback đã resolve và run đã finalization. Bundle gồm:

    video/output.mp4
    metadata/manifest.json
    metadata/provenance.json
    metadata/reviews.json
    metadata/approval.json
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
