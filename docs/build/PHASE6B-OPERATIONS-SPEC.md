# PADStudio — Đợt 6B: vận hành ổn định và bàn giao hệ thống

Cập nhật: **2026-09-13**. Đây là lát cắt đóng Đợt 6 ở mức practical trên máy owner. Nó không mở provider, uploader, cloud worker, tài khoản hay pipeline bắt buộc mới.

## Người dùng và Agent làm được gì mới

- chạy một lệnh doctor thống nhất để biết runtime/capability/disk/project nào ready, attention hoặc blocked;
- xem project health và hướng xử lý ngay trong Observer chỉ đọc;
- lập kế hoạch phục hồi toàn project mà chưa thay đổi dữ liệu, rồi áp dụng riêng các finalization đã chứng minh là recoverable;
- mở lại project sau gián đoạn và tiếp tục mà không render/gọi provider/tính phí lại;
- dùng runbook để setup, khởi động, backup, phục hồi, kiểm tra và bàn giao.

## Hợp đồng doctor

`padstudio:doctor` trả JSON có version, status, runtime, machine profile, disk, capability requirements, project health và remediation. Mặc định không hash toàn bộ media; `--deep` xác minh checksum mọi Result file có checksum đã biết. Doctor:

- không cài package, tải model, sửa project hay tự fallback provider;
- tách capability bắt buộc của vòng practical hiện tại khỏi capability khuyến nghị (cắt cảnh và ASR cần runtime Python cài riêng; thiếu chỉ làm trạng thái `attention`) và capability tùy chọn;
- chỉ dùng `blocked` cho thiếu điều kiện hệ thống bắt buộc; project issue làm trạng thái `attention`;
- giữ rõ `releaseDefault: null` và các gate phát hành rộng chưa đo.

## Project health

Health là projection, không phải nguồn dữ liệu mới. Nó tổng hợp missing resource/file, pending finalization recoverable hoặc unrecoverable, pending feedback, checkpoint freshness và delivery hiện có. Lịch sử run failed không tự biến thành blocker nếu không còn trạng thái dang dở.

Observer thêm section Health chỉ đọc. Nó không có endpoint mutation và không tự bấm recover.

## Phục hồi

`project:recover -- <project-id>` mặc định chỉ lập kế hoạch. Thêm `--apply` mới thay đổi trạng thái. Recovery:

- chỉ gọi cơ chế `recoverRunFinalization` hiện có cho mục `recoverable: true`;
- không xóa output, Result, Decision, lock hoặc run lỗi;
- tuần tự hóa ở cấp project và từng run;
- đọc lại plan bên trong lock trước khi apply;
- báo từng action completed/failed/skipped và cho phép chạy lại idempotent;
- paid run chỉ hoàn tất khi receipt/authorization state hiện có chứng minh an toàn.

## Acceptance end-to-end

Runner tạo project tạm mới và media local có hình/âm thanh, import resource, tạo sequence, render với finalization bị ngắt có chủ ý, đóng/mở store, recover không render lại, record exact user acceptance, export delivery, verify mọi checksum, doctor deep, API/Observer và browser ba viewport. Dữ liệu acceptance nằm ngoài project thật và được dọn sau chạy.

Ngoài ra phải chạy toàn bộ repository tests, source-analysis harness, doctor trên workspace thật và kiểm tra không còn mutation lock.

## Giới hạn được giữ

- practical acceptance trên máy owner không phải chứng nhận mọi máy/codec/corpus;
- human listening cho Piper và release gates corpus/benchmark rộng vẫn chưa hoàn thành;
- không tự động sửa project blocked; remediation cần Agent/người vận hành quyết định.
