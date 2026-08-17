# PAD Studio — Bối cảnh sản phẩm

## Mục tiêu

PAD Studio giúp tạo video giải thích ngắn từ nội dung học. Sản phẩm cần rõ ràng, ít thao tác và để người dùng tập trung vào nội dung thay vì điều phối nhiều công cụ.

## Trải nghiệm cốt lõi

Luồng chính có năm bước: **Nội dung → Cách đọc → Giọng đọc & scene → Chỉnh scene → Xuất video**.

Giọng được tạo trước. Từ narration đó, hệ thống sinh scene và đồng bộ thời lượng. Ở bước chỉnh scene, người dùng chỉ thấy **một editor**: visual, timeline và audio chạy cùng playhead. Họ sửa các điểm lệch, thêm/bớt nội dung hoặc watermark, sau đó xuất video.

## Nguyên tắc UX

- Đưa lựa chọn quan trọng lên sớm; không yêu cầu người dùng đồng bộ lại một cách thủ công khi hệ thống đã có đủ dữ liệu.
- Mỗi bước chỉ có một mục đích và một CTA chính.
- Mặc định tốt hơn nhiều tuỳ chọn. Chỉ hiện điều khiển nâng cao khi việc đó cần thiết.
- Preview phải phản ánh kết quả xuất: đúng scene, lời đọc, thời lượng và watermark.
- Thông báo lỗi cần nêu việc người dùng có thể làm tiếp theo; không làm mất dữ liệu đang nhập.
- Giao diện tiếng Việt, ngắn gọn, nhất quán về thuật ngữ và font.

## Dữ liệu và các bất biến

- Project là nguồn sự thật cho toàn bộ tiến trình và artefact.
- Quy tắc phát âm có phạm vi `project` hoặc `global`; lưu ngay khi thêm/sửa/xoá thành công.
- Narration là nguồn thời gian cho scene. Khi narration thay đổi, các artefact phụ thuộc phải được làm mới hoặc đánh dấu cần tạo lại.
- Chỉ tồn tại một timeline chỉnh scene đang hoạt động cho một project. Audio phải theo playhead của timeline đó.
- Watermark thuộc cấu hình render, được preview tại editor và phải đi vào file xuất.
- Render hoàn tất chỉ khi file video được xác thực có video H.264 và audio AAC.

## Bản đồ kỹ thuật ngắn

| Khu vực | Vai trò |
| --- | --- |
| `src/frontend` | React UI, router, trạng thái workflow, editor và API client. |
| `src/backend` | HTTP routes, project state, ElevenLabs, generation, workspace, render. |
| `src/shared` | Schema, pipeline, timing, phát âm và quy tắc video dùng chung. |
| `motion-canvas-runtime` | Runtime render/preview cho Motion Canvas. |
| `docs/ARCHITECTURE.md` | Quyết định kiến trúc, adapter và ràng buộc chi tiết. |

Media và workspace là dữ liệu runtime. Chúng không phải asset nguồn để đưa vào git. Secret chỉ tồn tại ở backend qua biến môi trường.

## Quy tắc phát triển

- Giữ UI tối giản; tránh tạo thêm màn hình hoặc preview song song khi một editor đã đáp ứng đủ.
- Sửa state tại nguồn và để pipeline invalidation rõ ràng; không vá bằng dữ liệu tạm ở frontend.
- Bảo toàn dữ liệu người dùng khi API lỗi hoặc chuyển bước không hợp lệ.
- Với API tính phí, không retry mù quáng sau timeout hay ngắt kết nối mơ hồ.
- Khi thêm tính năng render, kiểm tra cả preview lẫn artefact MP4 cuối cùng.
- Ưu tiên test unit/integration cho flow thay đổi và chạy build trước khi bàn giao.

## Kiểm chứng tối thiểu

```powershell
npm test
npm run build
```

Dùng `npm run validate` trước các thay đổi lớn hoặc release. Với ElevenLabs/Codex thật, dùng project ngắn để kiểm tra end-to-end và giữ chi phí ở mức thấp.
