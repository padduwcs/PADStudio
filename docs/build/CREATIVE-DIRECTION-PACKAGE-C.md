# Đợt 2 — Gói C: dựng, sửa cục bộ và duyệt mẫu

Trạng thái: **đã hoàn thành và được người dùng phê duyệt**. Ngày kiểm tra: **2026-09-10**.

Gói C tiếp tục pilot `phase2-brute-force-pilot` từ direction `keys-first` + takeaway-only
đã duyệt ở Gói B. Toàn bộ mẫu dùng resource đã đăng ký, renderer FFmpeg local và chi phí 0.

## Kết quả

- Sequence revision 1 gồm 7 segment, dài dự kiến 47,4 giây.
- Render r1 `result-mtv37cli-f93956b7` thành công nhưng review yêu cầu sửa vì nhịp nối
  “chìa khóa → khả năng cần kiểm tra” chưa đủ rõ trên điện thoại.
- Sequence revision 2 `artifact-mtv3beyw-b7ed21b0` chỉ thêm caption lớn cho
  `algorithm-bridge`; 6 segment còn lại giữ nguyên.
- Render r2 `result-mtv3bvo3-2508c5de` dựng lại đúng 1/7 segment và reuse 6/7 segment từ r1.
- Combined review `review-mtv3joaw-75723312` đạt `passed_with_notes`.
- Người dùng duyệt exact r2 qua `decision-mtv400uy-fa67712a`; workflow
  `workflow-mtv36sbw-f7edf8de` hoàn tất ở revision 4.

Preview đã duyệt nằm trong project runtime tại
`.padstudio/projects/phase2-brute-force-pilot/outputs/run-mtv3bu4k-7cbe2621/preview.mp4`.
Runtime được gitignore theo thiết kế; báo cáo bằng chứng có thể review nằm tại
[`package-c-pilot.json`](../../eval/creative-direction/reports/2026-09-10/package-c-pilot.json).

## Cấu trúc nội dung

1. Chùm chìa khóa và hành động thử lần lượt.
2. Nối mỗi chìa với một khả năng cần kiểm tra.
3. Gọi tên và định nghĩa Brute Force.
4. Nhấn mạnh không bỏ sót trước khi kết luận.
5. Nêu giới hạn chậm khi số khả năng lớn.
6. Cân bằng bằng ưu điểm dễ hiểu, dễ kiểm tra và chắc chắn khi duyệt đủ.
7. Kết bằng takeaway về vai trò nền tảng và lý do cần cách nhanh hơn; không dùng CTA.

Các segment dùng source ranges có câu trọn vẹn, tham chiếu transcript verified và giữ ID ổn
định giữa hai revision.

## Kiểm tra kỹ thuật và review

- Preview r2: H.264/AAC, 1080×1920, 30 fps, 47,421333 giây.
- Giải mã toàn bộ video và audio thành công.
- Audio: AAC stereo 48 kHz, integrated loudness −16,6 LUFS, true peak −2,8 dBFS,
  không có NaN/Inf.
- SHA-256 preview khớp Result:
  `dd2a8c560cb06e6678f5f93b0c90cbad7a75dc1ab1e9e9abac115cd4967c2212`.
- Contact sheet lấy mẫu mỗi 5 giây và frame riêng xác nhận caption sửa đọc được,
  không che hình chính.
- Các điểm nối nằm sát khoảng lặng kỹ thuật; CTA nguồn bắt đầu ở 79,61 giây,
  ngoài range cuối 70,05–78,62 giây.
- Nguồn và sáu Result analysis được verify lại là `verified_current`.

Agent host không hỗ trợ nghe/phát chuyển động trực tiếp, nên review nội bộ giữ hai warning rõ
ràng thay vì tuyên bố đã thực hiện. Người dùng đã duyệt exact preview r2 sau khi được cung cấp
file và các điểm cần kiểm tra; approval không tự kế thừa nếu sequence hoặc render thay đổi sau này.

## Điểm tiếp tục

Không còn workflow hoặc approval đang chờ. Checkpoint hiện mở Gói D: bổ sung observer chỉ đọc
để thấy brief, proposal, direction, sequence, render, review và approval đúng revision.

## Cách kiểm tra lại

```powershell
npm run analysis:verify -- phase2-brute-force-pilot
npm run project:context -- phase2-brute-force-pilot
npm test
```

Giới hạn: kết quả chứng minh vòng pilot trên một video cụ thể, không chứng nhận chất lượng cho
mọi thể loại. ASR raw vẫn có thể có lỗi nhỏ; exact user approval là bằng chứng playback cuối.
