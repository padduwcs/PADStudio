# PADStudio — Đợt 6A: kiểm tra và bàn giao cục bộ

Cập nhật: **2026-09-13**. Phạm vi này hoàn thiện đường bàn giao cho loại video mục tiêu đã chứng minh ở pilot; không mở nền tảng xuất bản, uploader, cloud worker hoặc provider mới.

## Mục tiêu và ranh giới

Agent chọn một 'video.sequence-render' cụ thể. Contract hiện hành (từ 2026-09-22): PADStudio chỉ xuất khi quyết định mới nhất của chính Result đó là 'accepted' với confirmation hợp lệ và byte nguồn khớp SHA-256 đã lưu. Export không render lại, không đổi codec và không sửa nội dung: nó sao chép nguyên byte đã duyệt vào một run output mới. Việc sequence còn current, feedback đã resolve và run đã finalization là điều kiện của lúc *chấp nhận* (`project:accept` tự resolve feedback cùng sequence), không phải gate chạy lại ở delivery; bản ban đầu của các gate này được giữ ở mục lịch sử bên dưới.

Input công cụ ban đầu gồm `{ resultId, profileId }`; không nhận raw path. Theo quyết định UX ngày
2026-09-22, `profileId` là tùy chọn và chỉ ghi ý định/advisory, không ép chuyển mã sau acceptance.
Capability là `video.export-delivery`, tool local là `local-delivery`. Catalog hiện có bốn profile
(`local-portrait-h264-v1`, `local-portrait-720p24-h264-v1`, `local-landscape-h264-v1`,
`local-square-h264-v1`; xem [OUTPUT-PROFILES-AND-STYLE-PLAYBOOKS.md](OUTPUT-PROFILES-AND-STYLE-PLAYBOOKS.md)).
Profile đầu tiên `local-portrait-h264-v1` cố ý hẹp:

- MP4, H.264, 'yuv420p', 1080×1920, 30 fps;
- AAC stereo 48 kHz;
- integrated loudness từ -24 đến -14 LUFS, true peak không quá -1 dBTP;
- tail silence không quá 0,75 giây.

## Gate fail-closed ban đầu và quyết định UX hiện hành

Trước và trong run, hệ thống kiểm tra: exact user acceptance; current artifact/dependencies; pending feedback; trạng thái run nguồn; size và SHA-256; ffprobe profile; full audio/video decode; duration; loudness; true peak; tail silence; checksum sau copy. Một gate lỗi làm run failed và không commit Result/bundle.

Từ quyết định ngày 2026-09-22, danh sách trên là lịch sử của contract 6A ban đầu, không còn là gate
cho local delivery sau khi người dùng đã chốt. Contract hiện hành chỉ bắt buộc exact acceptance, file
nguồn còn nguyên theo SHA-256, media probe tối thiểu và checksum bản copy. Profile và QA nếu có được
ghi advisory; không render lại hoặc đổi codec. Các kiểm tra phát hành theo chuẩn nền tảng có thể chạy
trước duyệt hoặc trong một workflow xuất bản riêng khi người dùng yêu cầu.

Mọi file của Result mới đều được ProjectStore gắn SHA-256. Đường tải thường kiểm tra path/type/size; thao tác delivery dùng 'verifyResultFile' để bắt cả thay byte cùng kích thước. Result cũ được phép dùng checksum primary trong 'result.data.sha256'; thiếu cả hai thì delivery từ chối.

## Bundle và provenance

Mỗi lần xuất tạo thư mục bất biến trong output của run:

    video/output.mp4
    metadata/manifest.json
    metadata/provenance.json
    metadata/reviews.json
    metadata/approval.json
    metadata/quality.json        (thêm ở Lượt 4: bằng chứng QA advisory, hoặc status "not_run")
    metadata/checksums.sha256

'delivery.bundle' tham chiếu Result nguồn, artifact và resources; lưu profile, media measurement, approval Decision và source/output SHA-256. Observer có section Delivery chỉ đọc và link tải từng file.

## Sửa lỗi nền đi kèm

- Project Decision và Result Decision dùng chung lock 'decisions', tránh trùng timestamp/mất ghi khi concurrent.
- Observer/full-project snapshot đo generation trước và sau assemble, retry tối đa ba lần; ETag trả về luôn gắn với snapshot ổn định.
- Feedback legacy r9 của pilot được giải quyết bằng một Decision append-only nhắm chính xác r10; không backfill hoặc sửa lịch sử.

## Nghiệm thu

- regression test cho generic Result checksum và same-size tampering;
- gate test cho accepted/current/pending feedback và bundle evidence;
- concurrent Project Decision test;
- snapshot mutation-during-build test;
- full repository test, source-analysis harness, pilot r10 real export;
- observer endpoint/module và lock cleanup.

Bằng chứng máy hiện tại nằm ở [phase6a-delivery-acceptance.json](../../reports/phase6a-delivery-acceptance.json). Giới hạn human listening, provider thật và release gates rộng vẫn giữ nguyên, không được suy diễn từ kiểm tra kỹ thuật này.
