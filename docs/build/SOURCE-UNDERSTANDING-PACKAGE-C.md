# Source Understanding — gói C: adapter production

Trạng thái: **đã triển khai và kiểm chứng trên máy hiện tại ngày 2026-09-09**.
Gói này nối sáu capability media vào vòng đời gói B; không bổ sung artifact/query của
gói D, Observer của gói E hay tuyên bố nghiệm thu corpus rộng của gói F.

## Phạm vi đã triển khai

| Capability | Tool production | Result |
| --- | --- | --- |
| source.probe | ffprobe-source | source.metadata |
| video.detect-scenes | pyscenedetect-scenes | source.scenes |
| source.extract-frames | ffmpeg-source-frames | source.frames |
| audio.analyze | ffmpeg-audio-analysis | source.audio-analysis |
| audio.transcribe | faster-whisper-transcribe | source.transcript |
| source.preview | ffmpeg-source-preview | source.preview |

Tất cả tool được đăng ký trong default registry và được chọn bởi AnalysisService
qua ToolExecutor. Planner của gói B vẫn sở hữu dependency, fingerprint, lease,
retry/resume/cancel, Run/Result và commit. Adapter chỉ đọc snapshot nguồn đã
resolve, ghi vào workspace tạm, rồi trả output để executor đăng ký. Trước khi
commit, lifecycle kiểm tra lại hash nguồn; mọi file Result có size và SHA-256.

Dependency Result được truyền rõ vào request runtime. Nhờ vậy frame adapter đọc
đúng scene dataset đã fingerprint-bind thay vì tự tìm một file gần giống.
AbortSignal dừng cả cây FFmpeg/Python; stdout/stderr được giới hạn và đường dẫn
tuyệt đối được che khỏi chi tiết lỗi lưu bền vững.

Ngay trước khi frame adapter dùng scene dataset, size/SHA-256 và tính liên tục của
mọi shot được kiểm tra lại. Availability identity giữ digest của profile, model lock
và phiên bản Python liên quan; sửa profile/model/runtime không thể âm thầm tái dùng
evidence tạo bởi môi trường cũ.

## Hành vi của từng adapter

- Probe giữ metadata format/track, time base, start time, duration, SAR/display
  size, rotation, color và audio layout. Decode mặc định chỉ lấy mẫu đầu/giữa/cuối
  và ghi cảnh báo rằng đây không phải kiểm tra toàn file; có thể yêu cầu full.
  Result ghi các interval thật ở coverage `sampled`; full decode mới ghi `continuous`.
- Scene dùng PySceneDetect AdaptiveDetector, xuất các shot liên tục trong coverage
  cùng boundary kind và diagnostic score. Đây là ranh giới hình ảnh kỹ thuật,
  không phải phân đoạn ngữ nghĩa.
- Frame lấy mẫu đầu/giữa/cuối range, đại diện shot và bổ sung cho shot dài trong
  budget. Mỗi row giữ requestedTime, decoded actualTime, PTS thật, shot ID và
  display transform. Probe PTS chỉ đọc video stream đã chọn và giải mã tới mốc kết
  thúc tuyệt đối, nên seek về keyframe trước không làm ngắn mất cửa sổ tìm kiếm.
  Lượt FFmpeg ghi ảnh dùng `-copyts` và `showinfo`; PTS do chính lượt này báo phải
  trùng PTS đã chọn thì verification mới pass. Adapter frame là `1.0.1`, vì vậy
  fingerprint không tái dùng Result `1.0.0` có semantics cũ. Ảnh riêng và contact
  sheet nhiều trang đều được giữ. Khi budget
  thiếu, toàn bộ shot/range bỏ sót nằm trong dataset JSONL có checksum; phần preview
  trong metadata được giới hạn để không làm vỡ contract kích thước.
- Audio stream PCM theo window để đo min/max/RMS/dBFS, khoảng lặng theo ngưỡng,
  clipping candidate và integrated LUFS khi FFmpeg xác định được. Ngưỡng lặng
  không được mô tả như VAD.
- ASR chạy local, original-language, giữ raw segment/word timestamps, confidence,
  language diagnostic, chunk/decode range và ownership window. Chunk dài 300 giây,
  overlap 2 giây; midpoint ownership loại trùng ở biên. Không có speech trả Result
  hợp lệ với outcome 'empty' và emptyReason 'no_speech_detected'.
- Preview tạo PNG cho ảnh tĩnh, AAC/M4A cho audio và H.264/AAC MP4 cho video hoặc
  ảnh động. HDR đi qua đường transform tường minh; nếu runtime không hỗ trợ filter
  cần thiết thì unit lỗi rõ, không âm thầm coi SDR.

Nguồn có đúng một track phù hợp được chọn mặc định và ghi lại. Khi có nhiều audio
track phải chọn stream rõ (preview dùng `options.audioStream`); nhiều video track
chỉ được mặc định khi có đúng một disposition default. Trường hợp mơ hồ trả
track_selection_required; adapter không tự trộn hay đoán track. Modality thật sự
không tồn tại trả not_applicable; runtime/model/profile thiếu trả blocked. Không
có fallback model hoặc tự tải model.

Nguồn production phải là media tự chứa. Playlist/manifest cục bộ, kể cả nội dung
playlist giả phần mở rộng media, bị từ chối trước khi FFmpeg có thể lần theo file
tham chiếu; protocol whitelist vẫn chỉ cho phép file/pipe.

## Runtime và profile

Runtime production nằm trong runtime/analysis/:

- profiles.json giữ các profile kỹ thuật;
- models.lock.json khóa revision và checksum model;
- requirements-cpu.lock.txt và requirements-windows-gpu.lock.txt khóa đúng
  dependency đã kiểm chứng ở gói A;
- helper.py là giao thức stdin/stdout JSON phiên bản 1.0 cho scene và ASR.

large-v3-gpu-fp16 tiếp tục là practicalDefault; releaseDefault vẫn là null theo
§18 của đặc tả. Model nằm ngoài project tại .cache/source-eval/models/ và được
kiểm tra revision/checksum trước inference. Gói C không thay đổi system PATH và
không truy cập mạng khi chạy.

Kiểm tra máy:

~~~powershell
npm run analysis:doctor
~~~

Doctor chỉ kiểm tra runtime, lock, model và dung lượng đĩa; không tải model và
không coi việc package có mặt là bằng chứng chất lượng nội dung. Preflight cũng
kiểm tra encoder/filter bắt buộc và công bố Python/profile/model-lock digest để
chẩn đoán môi trường tái lập được.

## Chạy qua vòng đời project

~~~powershell
$request = @{
  version = "1.0"
  sources = @(@{ kind = "resource"; id = "<resource-id>"; itemPath = $null })
  operations = @("frames", "audio", "transcript", "preview")
  profiles = @{
    probe = "source-probe-v1"
    visual = "source-standard-v1"
    audio = "audio-standard-v1"
    asr = "large-v3-gpu-fp16"
    preview = "source-preview-v1"
  }
  language = "vi"
  reuse = "verified"
} | ConvertTo-Json -Depth 10

$request | npm run project:analyze -- <project-id> -
~~~

Có thể bỏ language để nhận diện tự động. Request vẫn phải nêu operation; import
không tự khởi chạy phân tích. analysis:resume và analysis:cancel của gói B giữ
nguyên.

## Kiểm chứng

Báo cáo máy đọc được:
[package-c-verification.json](../../eval/source-understanding/reports/2026-09-09/package-c-verification.json).

Kiểm chứng tự động gồm:

- registry có đủ sáu capability, contract Result/checksum và dependency provenance;
- video tổng hợp có hard cut + audio chạy probe/scenes/frames/audio/preview qua
  lifecycle thật; probe coverage phản ánh ba mẫu decode, scene score hữu hạn,
  frame actual PTS bám timestamp yêu cầu và contact sheet có đúng kích thước;
- fixture một keyframe/20 giây khóa regression long-GOP ở 15 giây và sát EOF;
  từng ảnh được so MD5 pixel giải mã với full-decode độc lập tại chính PTS đã ghi;
- ảnh tĩnh tạo frame/preview, còn scene/audio trả not_applicable;
- ảnh động được lấy mẫu theo thời gian và preview thành H.264; audio-only tạo phép đo
  cùng preview AAC;
- stream selection mơ hồ và playlist cục bộ bị từ chối; abort dừng child process thật;
- budget frame thiếu vẫn giữ đủ omitted shot/range trong dataset checksum-bound;
- ToolExecutor chuyển đúng profile context không mặc định cho availability preflight;
- profile/model production khớp cấu hình đã kiểm chứng ở gói A.

Kết quả cuối: `npm test` 119/119; `npm run analysis:test` 20/20; riêng
`test/source-analysis-tools.test.js` 10/10. `npm run analysis:doctor` trả `ready` cho
cả sáu capability.

Chính fixture trong báo lỗi `.cache/package-c-review/long-gop.mp4` đã được import
thành managed copy và chạy lại qua lifecycle. Result `result-mttimhf9-ef053e4f`
(job `analysis-mttimfh5-c831be0e`) ghi 15/15/230400 và
19.999/19.966667/306688. MD5 pixel ảnh giải mã lần lượt trùng full-decode độc lập;
verification có `output_pts_matches_metadata`. SHA-256 fixture trước/sau đều là
0ebf1854f10a3b85fc7c86b5ce8204dd5bb88ed6f363451dab778ca522a1fa86.

Kiểm chứng thực tế dùng **bản managed copy** của hai file trong D:\Test\vid:

- vd03_brute_force.mp4, range 0–30 giây: transcript 7 segment/104 word;
  scene 1 shot; frame 3 ảnh + 1 contact sheet; audio 300 window/5 khoảng lặng;
  preview H.264/AAC hợp lệ. Rerun sau sửa seek cho mapping
  requested/actual/PTS lần lượt là 0/0/0, 15/15/450,
  29.999/29.966667/899; frame cuối nằm trong half-open range. Frame 15 giây có
  MD5 pixel giải mã `6e014157344512716b925714f751547c`, trùng ảnh full-decode
  độc lập tại PTS 450. Result mới là `result-mttij8b1-50472724` với adapter 1.0.1.
- vd11_hash_table.mp4, range 0–305 giây: transcript 86 segment/1127 word,
  2 chunk. Có 1111 word thuộc ownership trái và 16 word thuộc ownership phải;
  không có ID trùng hoặc timestamp ngoài coverage. Câu qua mốc 300 giây được
  chia giữa “đếm” và “tần suất…” mà không nhân đôi.
- WAV im lặng tổng hợp 3 giây: transcript empty/no_speech_detected, 0 segment,
  0 word; JSONL rỗng vẫn được đăng ký với SHA-256 chuẩn. Result ghi rõ đây là
  outcome của model/VAD trên coverage đã chạy, không phải khẳng định tuyệt đối.

Ngoài practical default FP16, smoke 5 giây với `large-v3-gpu-int8` cũng chạy đúng
`int8_float16` (1 segment/23 word). Ca này khóa regression từng làm ToolExecutor
preflight nhầm profile mặc định; đây chỉ là kiểm tra định tuyến profile, không phải
so sánh chất lượng hai cấu hình.

Đọc transcript 30 giây cho thấy nội dung nói về tư duy brute force và ví dụ chùm
chìa khóa. Raw ASR còn lỗi khả dĩ “Trong thật toán” tại khoảng 26,43–29,63 giây
(có thể là “Trong thuật toán”); không sửa raw và không biến nhận xét này thành
gold label. contentReview của Result vẫn là not_performed: kiểm chứng kỹ thuật
không được trình bày như đã xem/nghe đầy đủ nội dung.

SHA-256 của hai file gốc sau kiểm chứng vẫn lần lượt là
25d01a85ac7603a65b56e639b8ba0d4e9302e775bb50886f933b96fc5e38fb99
và dea5e55235d5020a2e330a510a813569bd07d2a838d3c268495069e49a445e84,
khớp sourceVersion của managed copy.

## Giới hạn còn lại

- Chưa có corpus/holdout độc lập hay long-run toàn bộ 25 file cho adapter
  production; không tuyên bố đạt các ngưỡng định lượng §13.
- Scene là hard-cut kỹ thuật; dissolve, camera motion và phân đoạn ngữ nghĩa vẫn
  cần review hoặc phương pháp khác.
- Scene helper hiện chỉ nhận video stream chính; nguồn nhiều video stream muốn
  chọn stream phụ sẽ lỗi rõ thay vì âm thầm dùng sai.
- Nhận diện ảnh động dựa trên frame count/duration mà container cung cấp; metadata
  quá nghèo có thể cần probe chuyên sâu ở gói sau.
- Contact sheet dùng nhãn bitmap ASCII dựng sẵn, đủ timestamp/shot ID nhưng chưa
  phải UI review giàu tương tác.
- Integrated LUFS có thể là null với lý do rõ khi đoạn quá ngắn hoặc FFmpeg không
  xác định được; silence threshold không thay thế speech VAD.
- GOP cực dài buộc decoder đi từ keyframe hợp lệ trước đó, nên lấy frame chính xác
  có thể chậm hơn seek chỉ lấy keyframe; adapter ưu tiên đúng PTS hơn tốc độ giả tạo.
- Corpus owner hiện có stream offset bằng 0; non-zero offset/VFR đã có contract
  PTS và test đơn vị nhưng chưa có fixture thực tế để chứng nhận end-to-end.
- Chưa có artifact source.profile, transcript edit, query/search/summary (gói D)
  hay Observer/review surface (gói E).
