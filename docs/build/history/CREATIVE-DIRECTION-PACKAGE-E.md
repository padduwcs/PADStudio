# Đợt 2 — Gói E: nghiệm thu

Trạng thái: **đã hoàn thành ở phạm vi practical trên máy owner**. Ngày kiểm tra: **2026-09-11**.

Gói E đóng vòng pilot `phase2-brute-force-pilot` bằng một cổng nghiệm thu chạy lại được. Cổng này
kiểm tra mở lại project, provenance/revision, exact approval, stale dependency, render/reuse,
lỗi và phục hồi, observer chỉ đọc, freshness của nguồn và trình duyệt responsive.

## Kết quả nghiệm thu

- Repository: **138/138 test đạt**, không có test lỗi.
- Source evidence: **6/6 Result `verified_current`**, 0 stale; search index có 22 dòng.
- Runtime doctor: **ready** với practical default cục bộ; `releaseDefault` vẫn là `null`.
- Browser: đạt ở **390/768/1440 px**; tìm kiếm, player qua polling và toàn bộ creative workspace đều đạt.
- Pilot: brief, proposal, direction `keys-first`, sequence r2, review và exact approval liên kết đúng.
- Render r2 giữ reuse **6/7 segment**; không còn workflow hoặc approval đang chờ.
- Không dùng mạng, provider trả phí hay phát sinh chi phí.

Báo cáo máy đọc được: [phase2-creative-direction-acceptance.json](../../../reports/phase2-creative-direction-acceptance.json).

## Chạy lại

```powershell
npm run creative:acceptance -- --project phase2-brute-force-pilot --report reports/phase2-creative-direction-acceptance.json
```

## Giới hạn được giữ rõ

Đây là nghiệm thu thực dụng trên một pilot đại diện, không phải chứng nhận mọi thể loại video.
Approval chỉ có hiệu lực với exact render đã duyệt, không tự kế thừa. Agent host hiện không tự nghe
playback nên xác nhận nghe/xem cuối vẫn thuộc người dùng. Đợt 1 cũng không bị ngầm nâng thành release
rộng: `releaseDefault` tiếp tục để trống.
