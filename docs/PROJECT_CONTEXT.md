# PAD Studio — Bối cảnh sản phẩm

PAD Studio biến nội dung giảng dạy thành video ngắn có narration và hình minh
hoạ động. Sản phẩm hoạt động local-first: người dùng sở hữu project và artifact
trên máy, còn provider chỉ được gọi khi họ chủ động tạo nội dung hoặc giọng đọc.

## Trải nghiệm cốt lõi

Workflow có đúng năm bước: **Nội dung**, **Cách đọc**, **Sản xuất**,
**Chỉnh scene** và **Xuất video**.

- Nội dung chuẩn bị nguồn của project.
- Cách đọc làm rõ lời thoại và quy tắc phát âm.
- Sản xuất tạo các artifact Voice/Motion đã khóa theo nguồn được duyệt.
- Chỉnh scene đồng bộ hình, tiếng và timeline trong một editor.
- Xuất video tạo MP4 cuối cùng.

Không tồn tại các trang Outline, VoiceVisual hoặc Layout thuộc workflow cũ.
Narration là nguồn thời gian của scene. Khi đầu vào upstream thay đổi, hệ thống
phải invalidate artifact downstream thay vì âm thầm trộn nhiều phiên bản.
Watermark và render settings phải phản ánh giống nhau ở preview và video cuối.

## Nguyên tắc phát triển

- Giữ project schema v16 và transition do backend sở hữu.
- Mỗi bước có một mục đích và một hành động chính rõ ràng.
- Không làm mất draft hoặc artifact hợp lệ khi request lỗi.
- Không retry mù request TTS có kết quả không xác định.
- Credential chỉ tồn tại ở backend local; không log hoặc commit secret.
- Project runtime, workspace và media không được đưa vào source control.
- Ưu tiên regression test tập trung cho lifecycle, invalidation và API contract.
- Preview phải phản ánh đúng artifact sẽ được dùng để render.

## Bản đồ source

| Khu vực | Vai trò |
| --- | --- |
| `src/frontend` | Năm page React, editor, router và API client. |
| `src/backend` | HTTP route, project state, provider, workspace và render. |
| `src/shared` | Schema v16, pipeline predicate, timing và media contract. |
| `motion-canvas-runtime` | Runtime preview/render Motion Canvas. |
| `docs/ARCHITECTURE.md` | Ranh giới module và bất biến kỹ thuật. |
| `docs/OPERATIONS.md` | Môi trường, backup, retry và khôi phục. |
