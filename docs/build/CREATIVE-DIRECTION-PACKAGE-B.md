# Đợt 2 — Gói B: khởi tạo pilot và chốt điểm duyệt hướng

Trạng thái: **đã hoàn thành, hướng pilot đã được người dùng phê duyệt**. Ngày kiểm tra: **2026-09-10**.

Gói này hiện thực hóa pilot đã chốt trong [đặc tả Đợt 2](./CREATIVE-DIRECTION-SPEC.md).
Nó không dựng sample; việc đó thuộc Gói C sau khi người dùng duyệt hướng.

## Kết quả

Project local `phase2-brute-force-pilot` đã được tạo trong `.padstudio/projects/`, gồm:

- bản sao resource của `vd03_brute_force.mp4`, không tham chiếu raw path trong artifact;
- một analysis job với đủ probe, scenes, frames, audio, transcript và preview;
- `project.brief`, `source.understanding`, `creative.proposal` và active `creative.direction`;
- review và quyết định phê duyệt gắn đúng workflow/output revision;
- workflow phê duyệt đã hoàn tất và checkpoint mở lại ở đầu Gói C.

Project runtime được gitignore theo thiết kế. Báo cáo bằng chứng có thể review nằm tại
[`package-b-pilot.json`](../../eval/creative-direction/reports/2026-09-10/package-b-pilot.json).

## Bằng chứng nguồn

- Nguồn: 85.589 giây, 1080×1920, H.264 30 fps, AAC stereo.
- Job `analysis-mtv0yw1a-3c8b2329`: completed, 6/6 unit succeeded, chi phí thực tế 0 USD.
- Transcript: 22 segment, 281 word, phủ liên tục bằng large-v3 GPU FP16.
- Visual: 2 shot candidate, 7 frame và 1 contact sheet; scene boundary không được diễn giải
  thành chương nội dung.
- Audio: integrated loudness khoảng −16.7 LUFS, không có clipping candidate.
- Lần verify cuối xác nhận cả sáu Result là `verified_current`.

## Ba phương án

1. `keys-first` — mở bằng chùm chìa khóa, rồi nối sang thử lần lượt các khả năng.
2. `not-guessing` — mở bằng câu phản trực giác “Brute Force không phải đoán mò”.
3. `slow-but-sure` — mở bằng đánh đổi “chậm nhưng nếu duyệt đủ thì chắc chắn đúng”.

Agent khuyến nghị `keys-first` vì cụ thể nhất cho người mới và có cả lời/hình gốc phù hợp.
Người dùng đã chọn phương án này và chọn kết thúc bằng takeaway kiến thức, không dùng CTA.
Lựa chọn được ghi trong active direction `artifact-mtv2gjv3-8e1b4682` revision 3.

## Phê duyệt và điểm tiếp tục

Decision `decision-mtv2i4lg-c0d63afa` ghi nhận phê duyệt rõ ràng của người dùng và được bind tới:

- direction revision 3 nêu trên;
- review `review-mtv2i4hz-a6af8a8c`;
- workflow `workflow-mtv2i4g2-ce41e255`, đã hoàn tất ở revision 3.

Không còn pending approval hay active workflow. Checkpoint hiện yêu cầu bắt đầu Gói C bằng
`video.sequence` khoảng 45 giây, sau đó render, review và sửa cục bộ/reuse.

## Phục hồi đã kiểm chứng

Trong lần đầu, direction được ghi ở status `draft` và vì thế dependency analyzer đánh dấu
`not_active_revision`. Hệ thống không xóa hay sửa lịch sử: tạo revision 2 active, abandon workflow
gắn draft với lý do rõ ràng, rồi tạo workflow approval tối giản và review lại đúng active revision.
Khi người dùng chốt thêm `takeaway-only`, hệ thống tạo direction revision 3 thay vì sửa revision 2,
abandon workflow đã bind bản cũ, review lại và chỉ gắn approval vào revision 3. Context cuối không
còn affected work item, pending approval hoặc active workflow.

## Cách kiểm tra lại

```powershell
npm run analysis:verify -- phase2-brute-force-pilot
npm run project:context -- phase2-brute-force-pilot
npm test
```

Giới hạn: nội dung transcript là ASR raw và một số chữ nguồn nhỏ; subtitle/sample ở Gói C vẫn
cần review thủ công. Probe chỉ decode mẫu đầu/giữa/cuối, không chứng nhận giải mã toàn file.
