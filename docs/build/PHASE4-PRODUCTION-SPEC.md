# Đợt 4 — dựng hình, chữ và âm thanh

Phạm vi được người dùng duyệt: timing, phối âm, typography, lớp phủ hình/chữ,
animation cơ bản, chuyển cảnh, timeline quan sát, sửa cục bộ và phục hồi.
Chat điều khiển; web chỉ quan sát. Không thêm provider, raw media path, timeline
kéo thả, keyframe tổng quát hoặc thay đổi kho project.

## Hợp đồng triển khai

`video.sequence` 1.0 tiếp tục được đọc. Phiên bản 1.1 thêm:

- narration: `offsetSeconds`, `durationSeconds`, fade in/out; `startSeconds` vẫn
  là vị trí lấy trong nguồn, không phải vị trí trên timeline.
- visual: fit/crop, motion preset và automation volume theo khoảng.
- captions: style toàn video và override từng cue; animation vào/ra.
- overlays: nguồn ảnh/video đã đăng ký, hình chữ nhật theo tỷ lệ khung, khoảng
  hiển thị, fit và animation. Tối đa tám lớp mỗi đoạn.
- transition sau đoạn: cut/crossfade/fadeBlack; overlap được trừ khỏi tổng thời gian.
- music: nguồn audio, vị trí bắt đầu, thời lượng, volume/fade, loop, ducking.
- audio: loudness mục tiêu tùy chọn cho bản mix cuối.

Các tham số phải được validate trước khi chạy. Tham chiếu, hash, dependency,
cache key và observer phải bao phủ cả nguồn mới. Review/approval không kế thừa.
Nhạc là bước mix cuối để sửa nhạc không bắt buộc dựng lại hình từng đoạn.

## Kiểm chứng

Giữ regression 1.0; render thật ba tình huống: lời đọc trên footage, graphic có
timing/animation và nhiều đoạn có nhạc/chuyển cảnh. Kiểm tra pixel/audio theo
thời gian, thời lượng, source drift, reuse, stale references và recovery.
Observer kiểm tra timeline/seek và bảo toàn player qua polling ở ba viewport.
Pilot dùng nguyên liệu local; không gửi request trả phí. Kết quả tự động không
thay thế human listening/creative approval.

## Quy tắc chính xác

- 1.1 giữ format/segments/references của 1.0. Các field lạ bị từ chối. 1.0
  không nhận field 1.1; không tự nâng cấp project cũ.
- visual.fit: pad hoặc crop (căn giữa). motion: none, zoomIn, zoomOut,
  panLeft, panRight; motion chỉ nhận ảnh tĩnh. volumeRanges là các khoảng
  không chồng nhau trong segment, với volume 0–2; ngoài khoảng dùng visual.volume.
  visual.fadeInSeconds/fadeOutSeconds áp dụng vào tiếng gốc.
- narration.startSeconds: vị trí nguồn; offsetSeconds: vị trí trong đoạn.
  durationSeconds tùy chọn cắt rõ độ dài cần lấy. Không khai báo thì dùng toàn
  phần audio còn lại, báo lỗi nếu không vừa đoạn. Fade không vượt độ dài audio.
- captionStyle: font (Arial, Segoe UI, Tahoma, Verdana), fontSize 12–240 pixel,
  bold, color #RRGGBB, background tùy chọn, outline 0–10 pixel, position
  top/center/bottom, margin 0.02–0.25 tỷ lệ khung, lineSpacing 1–2.
  Mỗi cue có thể override style và animation. Wrap bảo thủ theo số ký tự,
  giữ newline chủ động; từ quá dài hoặc block vượt vùng an toàn gây lỗi.
- animation: enter none/fade/slideLeft/slideUp, exit none/fade,
  durationSeconds không quá nửa khoảng hiển thị. Áp dụng caption/overlay;
  xuất hiện từng bước bằng các khoảng start/end riêng.
- overlay: id, source, sourceStartSeconds, startSeconds/endSeconds, x/y/width/height
  theo tỷ lệ khung; phải nằm trong khung. Thứ tự array là thứ tự lớp từ dưới lên.
  Audio của video overlay không được trộn. fit pad giữ alpha ở phần viền.
- transition là chuyển tiếp SAU segment; đoạn cuối chỉ cut. crossfade/fadeBlack
  có overlap, thời lượng khớp frame và không quá nửa mỗi đoạn liền kề. Âm thanh
  hai đoạn crossfade cùng overlap. Tổng video bằng tổng đoạn trừ tổng overlap.
- music tối đa 4 track. startSeconds là thời gian video SAU overlap. Có source,
  sourceStartSeconds, durationSeconds, volume, fadeInSeconds/fadeOutSeconds,
  loop và ducking. Loop phải được yêu cầu rõ; nó lặp file nguồn. Ducking dùng
  foreground mix (tiếng gốc + lời đọc), không dùng các music track khác làm key.
- audio.loudnessTargetLufs tùy chọn -30 đến -10. Dùng loudnorm dynamic ở bản
  mix cuối; đo lại integrated LUFS/true peak và giữ số đo. Không hứa LUFS đạt
  chính xác cho mọi nguồn; nguồn im lặng có thể không đo được (null).
- Renderer 1.1.0 chỉ reuse Result cùng phiên bản renderer. Result cũ vẫn xem
  được, muốn dùng cache mới cần render lại lần đầu. Music-only change tái dùng
  segment khi source/spec/hash còn khớp; bản mix cuối luôn được tạo mới.
- Font là font local, không tải mạng. Không chứng nhận typography giống hệt
  mọi máy. Kiểm tra nghe/nhìn vẫn cần review đúng Result.

## Ví dụ 1.1

```json
{
  "version": "1.1",
  "changeReason": "Căn lời đọc và thêm graphic",
  "format": {"width": 1080, "height": 1920, "fps": 30},
  "captionStyle": {"font": "Segoe UI", "fontSize": 52, "position": "bottom", "margin": 0.08},
  "segments": [{
    "id": "opening", "title": "Mở đầu", "intent": "Nêu vấn đề", "durationSeconds": 6,
    "visual": {"source": {"kind": "resource", "id": "resource-REPLACE"}, "volume": 0},
    "narration": {"text": "Lời dẫn", "source": {"kind": "result", "id": "result-REPLACE", "file": "primary"}, "offsetSeconds": 0.5, "durationSeconds": 4},
    "captions": [{"text": "Một ý chính", "startSeconds": 0.5, "endSeconds": 4.5, "animation": {"enter": "slideUp", "exit": "fade", "durationSeconds": 0.3}}]
  }]
}
```

## Chạy kiểm chứng và xem mẫu

- `npm run production:pilot`: tạo revision mới từ pilot Đợt 3 local, giữ baseline;
  ghi phản hồi đã có, tạo graphic typography mới và preview 8 giây; chờ user review.
- `npm run production:acceptance`: repository tests, Python harness, browser
  timeline/seek/player/3 viewport; fail nếu pilot thiếu. Report tại
  `reports/phase4-production-acceptance.json`, log dưới `.cache/phase4-acceptance`.
- `test/sequence-composition.test.js`: delayed narration, volume automation,
  overlay pixel timing, styled captions, transition pixels/duration, music xuyên
  đoạn, mix-only reuse, local change, recovery và missing overlay.
- Các test sequence 1.0, rollback/path safety và paid recovery tiếp tục chạy.

Đây là bàn giao kỹ thuật. Review chất giọng, font và nhịp của bản mẫu mới chưa
được người dùng chấp thuận; không ghi practical creative approval tự động.
