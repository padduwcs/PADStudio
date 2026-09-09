# Gói A — nền kiểm chứng Source Understanding

**Cập nhật sử dụng thực tế:** đã chọn `practicalDefault: large-v3-gpu-fp16` theo chỉ đạo owner; corpus định lượng không còn chặn đóng gói A. Xem [PRACTICAL-REVIEW.md](PRACTICAL-REVIEW.md). Hướng dẫn gold/holdout dưới đây dành cho đánh giá mở rộng, không bắt buộc để bắt đầu dùng.

Harness khảo sát local, độc lập với kho project và các tool production. Không thay đổi input, workflow, quyền UI hay contract Run/Result. Gói B/C nay đã có lifecycle và adapter production riêng; thư mục này vẫn là bộ đo gói A, không phải đường chạy project.

## Cài môi trường

Cấu hình đã thử: Windows 11, **Python 3.12.10 x64**, FFmpeg/ffprobe 8.1.2, RTX 5070 12 GB, RAM khoảng 32 GB. Đặc tả đề xuất Python 3.11; gói A dùng bản 3.12.10 đang có và kiểm chứng trực tiếp. Các lock hiện dành cho môi trường này; nền tảng khác cần benchmark riêng.

Chạy từ repository root trong PowerShell:

```powershell
py -3.12 -m venv .runtime-tools/source-eval
.runtime-tools/source-eval/Scripts/python.exe -m pip install -r eval/source-understanding/requirements-cpu.lock.txt
# GPU Windows: bổ sung DLL NVIDIA vào chính venv, không đổi driver/system PATH.
.runtime-tools/source-eval/Scripts/python.exe -m pip install -r eval/source-understanding/requirements-windows-gpu.lock.txt
npm run analysis:eval -- doctor
```

CPU/GPU là profile riêng, không tự fallback. CPU int8 khai báo chính xác compute type `int8_float32`; backend resolve khác profile thì từ chối. Dependency runtime phải khớp lock trước khi benchmark. `analysis:eval -- doctor` không tải model; `inferenceVerified: false` là chủ ý: phải kiểm tra report của lần chạy model thật. Package/compute type có mặt chưa chứng minh inference dùng được. DLL được thêm vào search path của tiến trình từ venv. CPU lock không yêu cầu package NVIDIA.

Setup model là **lệnh online riêng**, tải từ `Systran/faster-whisper-large-v3` và `Systran/faster-whisper-medium` trên Hugging Face; không gửi media lên mạng:

```powershell
npm run analysis:eval -- setup-model --model large-v3
npm run analysis:eval -- setup-model --model medium
```

Hai model tổng khoảng 5 GB; GPU runtime khoảng 1,4 GB file tải, cần thêm đĩa cho venv/cache và bản giải nén. Model đặt ở `.cache/source-eval/models/`, ngoài project media store. Revision/checksum mặc định lấy từ `models.lock.json`; khác lock thì từ chối. Inference chỉ mở model local và kiểm tra lại toàn bộ hash. Không cần token để tải model công khai. Không đặt secret vào manifest.

## Kiểm kê và baseline

```powershell
npm run analysis:eval -- inventory --source D:\Test\vid --output .cache/source-eval/corpus.json
npm run analysis:eval -- run --manifest .cache/source-eval/corpus.json --operation scenes
npm run analysis:eval -- run --manifest .cache/source-eval/corpus.json --operation asr --profile large-v3-gpu-fp16
```

Manifest đã có thì inventory từ chối ghi đè để bảo toàn nhãn/split. Mỗi file có path tương đối, SHA-256 toàn bộ bytes, metadata track, nguồn/quyền sử dụng, trường gán nhãn và split. File nguồn được hash trước/sau xử lý; duration/track được probe lại để tránh RTF sai do manifest bị sửa nhầm. Link thoát corpus root bị từ chối. Nguồn do owner cung cấp chỉ được ghi quyền dùng cho đánh giá local, không suy ra quyền phân phối lại.

Chọn clip bằng `--clip <id>` (lặp option để chọn nhiều); lấy ID từ manifest, không dùng số thứ tự. `--max-seconds 15` chạy prefix smoke và ghi coverage rõ. Không có giới hạn này thì chạy toàn clip. Nếu nhiều audio track, phải thêm `--audio-stream <index>`; không đoán theo tên file. Mặc định ngôn ngữ của các profile thử nghiệm hiện tại là `vi`, được ghi rõ trong `profiles.json`; corpus ngôn ngữ khác cần profile khai báo phù hợp trước khi chạy, không dùng kết quả profile vi để kết luận chất lượng tiếng Anh.

Profile so sánh: `large-v3-gpu-fp16`, `large-v3-gpu-int8`, `medium-gpu-fp16`, `large-v3-cpu-int8`. `releaseDefault` vẫn `null` cho đến khi đủ gate chất lượng.

Output nằm ở `.cache/source-eval/runs/<run-id>/`: `report.json`, prediction từng clip và log worker. Lần chạy mới không ghi đè lần trước. Report giữ profile, package/model hash, hash harness, coverage, thời gian nạp model, thời gian từng clip, RTF, precision thực tế và bộ nhớ lấy mẫu. Dữ liệu kỹ thuật chạy thành công vẫn `qualityStatus: unscored` nếu chưa chấm bằng nhãn chuẩn.

- RTF = thời gian clip (gồm hash/decode/inference/output preparation) / thời lượng media đã xử lý; `chunks[].inferenceSeconds` đo inference riêng. Không bao gồm download hay model load trong RTF clip. Clip đầu được đánh dấu `firstInference` để không gọi nó là warm.
- RAM là RSS tổng cây tiến trình lấy mẫu. GPU là bộ nhớ **toàn thiết bị**, có thể gồm app khác; không giả thành VRAM riêng model. Không dùng số đo baseline trên desktop đang làm việc để chứng nhận hiệu năng release.
- ASR chia ownership 300 giây, context overlap 2 giây; từ thuộc chunk theo midpoint timestamp. `temperature=0`, beam 5, VAD 500 ms, word timestamps, không tự dịch. Không có timing thì giữ text và cảnh báo unaligned. Fixture xác nhận ownership cơ học; chất lượng câu nói thật qua biên vẫn cần người nghe.
- Baseline ASR hiện từ chối audio stream lệch thời điểm bắt đầu so với container quá 1 ms; cần adapter timebase của gói B/C trước khi chứng nhận trường hợp đó. Corpus owner hiện có offset bằng 0.
- Scene baseline dùng AdaptiveDetector, backend PyAV, threshold 3, min 15 frames, window 2, min-content 15. Thời gian scene do thư viện cung cấp; VFR/stream offset chưa được chứng nhận cho runtime production. Không coi hard cuts là ranh giới ngữ nghĩa.
- `--timeout-seconds` mặc định 14400; worker riêng, timeout/Ctrl+C dừng cây tiến trình thuộc worker và giữ báo cáo lỗi. Report từng clip được chốt sau clip; đây không phải hệ thống job/resume gói B. Clip đã có prediction vẫn được giữ sau lỗi.
- stdout là JSON (chạy script trực tiếp nếu không muốn dòng banner của npm); stderr là progress. Exit 0 khi command hoàn tất, 1 input/setup lỗi, 2 run partial/failed hoặc corpus bị chặn. Xem trạng thái trong report khi chấm một run cũ.

## Nhãn chuẩn và chấm điểm

```powershell
npm run analysis:eval -- prepare-labels --manifest .cache/source-eval/corpus.json --output .cache/source-eval/review-corpus.json
npm run analysis:eval -- audit --manifest .cache/source-eval/review-corpus.json
```

`prepare-labels` tạo bản manifest review riêng cùng file JSON trống từng clip. `text: null`/`cuts: null` = chưa gán nhãn; `text: ""`/`cuts: []` = đã xác nhận không có lời/cut. Không dùng transcript máy làm gold tự động.

Người kiểm tra nghe/xem file gốc, điền `text`, `cuts` (hard-cut seconds), `segments` (`startSeconds`, `endSeconds`, text), `criticalTokens` (cụm tên riêng/số cần giữ). Ghi `reviewer`, `status: human_verified`, tăng `version` và `annotationVersion` khi thay nhãn. Coverage cần đúng phạm vi đã đối chiếu; corpus audit chỉ nhận nhãn full clip. Transcript kịch bản có thể làm bản nháp, vẫn phải nghe đối chiếu.

Trong manifest review, phân nhóm `vi_clean`, `vi_hard`, `no_speech`; thêm `speakerGroup`, `sourceGroup`, `tags` và `split: development | holdout`. Cả một người nói/nguồn phải nằm một phía; không chia hai đoạn cùng bản ghi cho development và holdout. Cả 25 file hiện để `unassigned`, chưa đoán giọng/vùng miền từ tên video. Chúng đã dùng cho exploratory baseline; nên dành nguồn độc lập chưa dùng để tuning cho holdout chính thức, không đổi nhãn một bộ đã xem thành “holdout chưa đụng tới”.

Audit kiểm tra nguồn/hash, nhãn xác nhận, tối thiểu 36 clip/90 phút audio, clean/hard mỗi nhóm 20 phút, không lời 10 phút, 12 clip/100 hard cuts, 300 biên lời nói, tags đa dạng và rò rỉ split. Tỷ lệ duration holdout mục tiêu 60%, khoảng kiểm tra 55–65%. Có tags không thay thế review độ đại diện của corpus. Cần manual corpus review dù audit cơ học hết blocker.

```powershell
npm run analysis:eval -- lock-holdout --manifest .cache/source-eval/review-corpus.json --output .cache/source-eval/holdout.lock.json --reviewer "Tên người kiểm tra"
# Chọn rõ các clip holdout đã khóa; không chạy tuning trên chúng.
npm run analysis:eval -- run --manifest .cache/source-eval/review-corpus.json --operation asr --profile large-v3-gpu-fp16 --holdout-lock .cache/source-eval/holdout.lock.json
npm run analysis:eval -- score --manifest .cache/source-eval/review-corpus.json --report .cache/source-eval/runs/<run-id>/report.json --output .cache/source-eval/scores.json
```

Lock giữ hash manifest, profiles, annotation, model lock, metrics và dependency lock. Không ghi đè lock; đổi phương pháp/nhãn thì cần vòng đánh giá mới được ghi rõ, không hạ ngưỡng sau khi xem holdout. Bổ sung annotation sau baseline được phép để chấm exploratory; thay source hash/split thì không nhận prediction cũ. Không gọi exploratory score là holdout.

Metric có raw CER, normalized CER, lỗi token theo khoảng trắng (không gọi là linguistic WER tiếng Việt), false-speech token count, scene precision/recall với matching 1:1 trong ±0,20 giây, và kết quả từng clip/nhóm. Chuẩn hóa NFC, lowercase, bỏ punctuation thông thường, **giữ dấu và dấu số như 3.14/-12**; không tự đổi “mười hai” thành “12”. Cụm trọng yếu chấm exact normalized phrase, không suy ra confidence từ score ASR.

Để chấm p95 timing, người review thêm `timingMatches` vào annotation: mỗi phần tử gồm `predictionHash`, `segmentId`, `startSeconds`, `endSeconds` gold. Segment dự đoán được resolve từ prediction đã kiểm checksum, không ghép hai danh sách theo index. Timing match thuộc prediction cụ thể; không có match thì metric là null, không coi là 0 lỗi. `segments` gold dùng đếm độ phủ bộ biên; `timingMatches` là đối chiếu với từng model run.

`releaseAccepted` luôn false trong report metric: script cung cấp bằng chứng, không thay thế toàn bộ nghiệm thu §13. Cần đối chiếu các ngưỡng trong SOURCE-UNDERSTANDING-SPEC.md và review các nhóm/timing/không lời/biên chunk. Chưa đủ corpus hoặc nhãn thì báo blocker và giữ releaseDefault null.

## Kiểm tra

```powershell
npm run analysis:test
.runtime-tools/source-eval/Scripts/python.exe -I eval/source-understanding/smoke.py
npm test
```

Smoke tạo media synthetic trong cache, kiểm tra 2 hard cuts chuẩn, ASR CPU trên silence/tone, và timeout thật. Không thay corpus tự nhiên. Báo cáo lần triển khai và kết quả thực tế: [BASELINE-REPORT.md](BASELINE-REPORT.md).

## Acceptance gói F

Sau khi có một project local với preview/transcript, nhiều Result set và transcript đủ phân trang,
chạy gate đóng phạm vi practical:

```powershell
npm run analysis:acceptance -- --browser-project <project-id> --report eval/source-understanding/reports/<date>/package-f-verification.json
```

Runner chạy repository test, harness, doctor, `analysis:verify` và browser acceptance; thiếu project
browser sẽ trả `incomplete`. Report tách các gate practical đã đạt khỏi corpus/scale release còn
`not_measured`. Kết quả hiện tại: [package-f-verification.json](reports/2026-09-09/package-f-verification.json).

Thư viện tham chiếu: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [CTranslate2 installation](https://opennmt.net/CTranslate2/installation.html), [PySceneDetect AdaptiveDetector](https://www.scenedetect.com/docs/latest/api/detectors.html). Lock lưu phiên bản đã cài/thử, không lấy benchmark của thư viện làm kết quả PADStudio.

Tổng hợp nhiều baseline (kiểm checksum prediction và cùng coverage ASR):

```powershell
.runtime-tools/source-eval/Scripts/python.exe -I eval/source-understanding/summarize.py <report-1.json> <report-2.json> --output .cache/source-eval/summary.json
```
