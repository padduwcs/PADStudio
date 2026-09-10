# Đợt 2 — Gói B: khởi tạo pilot và chốt điểm duyệt hướng

Trạng thái: **hoàn thành đến đúng ranh giới phê duyệt của người dùng**. Ngày kiểm tra: **2026-09-10**.

Gói này hiện thực hóa pilot đã chốt trong [đặc tả Đợt 2](./CREATIVE-DIRECTION-SPEC.md).
Nó không dựng sample; việc đó thuộc Gói C sau khi người dùng duyệt hướng.

## Kết quả

Project local `phase2-brute-force-pilot` đã được tạo trong `.padstudio/projects/`, gồm:

- bản sao resource của `vd03_brute_force.mp4`, không tham chiếu raw path trong artifact;
- một analysis job với đủ probe, scenes, frames, audio, transcript và preview;
- `project.brief`, `source.understanding`, `creative.proposal` và active `creative.direction`;
- review proposal và review direction gắn đúng workflow/output revision;
- workflow hiện hành dừng ở `awaiting_approval` và checkpoint mở lại được.

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
Active direction `artifact-mtv1k3wk-51601995` là ứng viên hiện hành, **không phải bằng chứng
người dùng đã phê duyệt**.

## Điểm tiếp tục

Workflow `workflow-mtv1krag-744cc2ee` revision 2 đang chờ người dùng:

- chọn `keys-first`, `not-guessing` hoặc `slow-but-sure`;
- chọn kết thúc bằng takeaway kiến thức hay giữ CTA theo dõi.

Sau quyết định, hệ thống phải ghi decision có binding tới review/output hiện hành, hoàn tất work
item rồi mới mở Gói C. Không được tự kế thừa approval từ draft hoặc workflow cũ.

## Phục hồi đã kiểm chứng

Trong lần đầu, direction được ghi ở status `draft` và vì thế dependency analyzer đánh dấu
`not_active_revision`. Hệ thống không xóa hay sửa lịch sử: tạo revision 2 active, abandon workflow
gắn draft với lý do rõ ràng, tạo workflow approval tối giản và review lại đúng active revision.
Context cuối không còn affected work item và pending approval trỏ đúng active artifact.

## Cách kiểm tra lại

```powershell
npm run analysis:verify -- phase2-brute-force-pilot
npm run project:context -- phase2-brute-force-pilot
npm test
```

Giới hạn: nội dung transcript là ASR raw và một số chữ nguồn nhỏ; subtitle/sample ở Gói C vẫn
cần review thủ công. Probe chỉ decode mẫu đầu/giữa/cuối, không chứng nhận giải mã toàn file.
