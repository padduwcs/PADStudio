# Báo cáo gói A — 2026-09-08

**Cập nhật theo chỉ đạo mới của owner:** gói A được chốt cho sử dụng thực tế với `large-v3-gpu-fp16`, có review ngữ nghĩa; xem [PRACTICAL-REVIEW.md](PRACTICAL-REVIEW.md). Các yêu cầu corpus bên dưới là trạng thái nghiệm thu định lượng cũ, không còn chặn sử dụng gói A trên máy owner.

**Báo cáo baseline lịch sử:** Đã triển khai và kiểm tra bộ nền benchmark. Chưa nghiệm thu chất lượng gói A và chưa chốt quality profile phát hành**, vì chưa có corpus gán nhãn/holdout đáp ứng đặc tả. `releaseDefault` được giữ `null`.

## Đã bàn giao

- CLI doctor, kiểm kê nguồn có SHA-256, setup model theo revision/checksum đã khóa, benchmark ASR/cảnh offline, mẫu gán nhãn, audit corpus, khóa holdout, chấm CER/token/cảnh/timing/cụm trọng yếu và tổng hợp baseline.
- Môi trường Python riêng và lock dependency CPU/GPU; model manifest pin hai snapshot Systran. GPU DLL chỉ được cấu hình trong tiến trình, không đổi driver hệ thống.
- Mỗi run có báo cáo và prediction riêng, giữ coverage, model/profile/packages, hash nguồn, thời gian và bộ nhớ lấy mẫu. Worker có deadline và lưu dấu vết khi timeout/native failure. Mỗi file nguồn được kiểm tra trước/sau xử lý.
- Hướng dẫn tái lập: [README.md](README.md). Không sửa code kho project, executor hay giao diện production. Các thay đổi sẵn có của owner trong tài liệu build được bảo toàn.

## Môi trường và tư liệu

Windows 11; Python 3.12.10 x64; RTX 5070 12 GB VRAM; RAM 33.407.430.656 bytes; 16 logical CPUs; FFmpeg/ffprobe 8.1.2; faster-whisper 1.2.1, CTranslate2 4.8.2, PySceneDetect 0.7.1. Doctor và phiên bản đầy đủ ở [doctor.json](reports/2026-09-08/doctor.json).

Nguồn `D:\Test\vid`: **25 video, 6.056,725 giây = 100 phút 56,7 giây**, 546.789.572 bytes. File ngắn nhất 85,589 giây, dài nhất 369,082 giây. Audio/video start_time bằng 0 trong corpus này. File gốc giữ nguyên; manifest/hash ở [corpus.owner-videos.json](reports/2026-09-08/corpus.owner-videos.json).

Tư liệu owner cho phép dùng đánh giá local; không suy ra quyền phân phối lại. Đây là corpus exploratory, không phải holdout chưa được sử dụng. Không đoán vùng giọng hay độ khó từ tên file.

## Baseline thực tế

Cả ba profile ASR chạy cùng 25 file, cùng hash và coverage toàn clip. Mỗi profile được chạy tuần tự để tránh cạnh tranh GPU giữa các benchmark.

| Cấu hình | Thành công | Thời gian xử lý | RTF | RAM peak lấy mẫu | GPU peak toàn thiết bị |
| --- | --- | --- | --- | --- | --- |
| large-v3 / CUDA float16 | 25/25 | 405,46 s (~6:45) | 0,06694 | 2,81 GiB | 5,97 GiB |
| large-v3 / CUDA int8_float16 | 25/25 | 457,86 s (~7:38) | 0,07560 | 2,93 GiB | 4,15 GiB |
| medium / CUDA float16 | 25/25 | 302,81 s (~5:03) | 0,05000 | 1,43 GiB | 4,01 GiB |
| AdaptiveDetector / PyAV | 25/25 | 543,94 s (~9:04) | 0,08981 | Xem JSON | Xem JSON |

Scene detector trả **255 hard-cut candidates**; chưa có nhãn thủ công để tính precision/recall trên video thật. Một số container báo `Unknown cover type: 0x1` từ FFmpeg/PyAV; các clip vẫn hoàn tất. Không bỏ warning để suy ra mọi thành phần container đều được hỗ trợ.

Model load lần lượt khoảng 1,96 / 3,22 / 0,98 giây, tách khỏi thời gian clip. Thời gian clip gồm đọc/hash/decode/inference, không bao gồm download/model load. Bộ nhớ là số đo lấy mẫu trên desktop đang hoạt động; GPU gồm app khác, không phải VRAM riêng model. Đây không phải benchmark hiệu năng release được kiểm soát.

Bảng đầy đủ, warm RTF và checksum: [baseline-summary.json](reports/2026-09-08/baseline-summary.json). Bản sao report run nằm cùng thư mục; prediction lớn nằm local tại `.cache/source-eval/runs/<run-id>/`. Bản sao report giữ đường dẫn prediction tương đối của run gốc, cần mở cùng thư mục run gốc khi dùng lệnh score/summarize.

Các baseline được chạy trong quá trình hoàn thiện harness; report lưu hash phiên bản đã chạy. Những bổ sung sau đó gồm provenance/diagnostics, kiểm metadata, khóa model/dependency, cảnh báo timestamp và audit; không thay tham số inference GPU. Đã chạy smoke trên mã cuối. Không coi đây là holdout với code đã khóa trước tuning.

**Đề xuất kỹ thuật tạm thời:** tiếp tục đánh giá large-v3 FP16 làm ứng viên chất lượng trên máy này; INT8 giảm bộ nhớ nhưng chậm hơn trong lần đo. Medium nhanh hơn nhưng chưa có bằng chứng chất lượng để thay large-v3. Chưa chọn profile phát hành.

## Kiểm tra

- 19 test harness qua: chuẩn hóa tiếng Việt/số, CER và token, matching cảnh 1:1, timestamp, ownership từ qua biên chunk, chống nguồn/metadata/model/dependency thay đổi, nhãn máy không được coi là gold, audit/holdout, ghi nguyên tử. [Log](reports/2026-09-08/analysis-tests.txt).
- 81/81 test repository qua, không skip. [Log](reports/2026-09-08/repository-tests.txt).
- Smoke thật trên mã cuối: phát hiện đúng hai cut synthetic ở 2 và 4 giây; ASR CPU không sinh text trên silence/tone; timeout worker được ghi failed đúng và dừng tiến trình. [Report](reports/2026-09-08/synthetic-smoke.json).
- Inference CPU trên đoạn lời nói thật 15 giây đã chạy; CPU cuối khai báo `int8_float32` đúng kiểu backend thực tế. CPU chưa chạy toàn corpus/gate chất lượng.
- 100 prediction của bốn baseline được kiểm checksum khi tổng hợp; các hash nguồn được đối chiếu lại cuối đợt. Không chạy UI test vì gói A không thay UI.

## Những điểm còn chặn nghiệm thu

[Corpus audit](reports/2026-09-08/corpus-audit.json) vẫn báo blocked:

1. Chưa có transcript/cảnh gold do người nghe/xem xác nhận; không có điểm CER/token, scene precision/recall hay timing p95 trên media thật.
2. Hiện 25 clip, đặc tả cần tối thiểu 36 clip audio và phân nhóm: clean/hard mỗi nhóm ≥20 phút, không lời ≥10 phút, đa dạng giọng/ngôn ngữ/nhiễu. Tổng thời lượng hiện đủ 90 phút nhưng tính đa dạng chưa được xác nhận.
3. Chưa có ≥100 hard cuts và ≥300 biên lời nói được người kiểm tra gán nhãn. 255 cut máy dự đoán không thay thế nhãn gold.
4. Chưa có holdout độc lập được khóa theo người nói/nguồn trước tuning. Cần bổ sung media phù hợp và review nhãn trước khi khóa profile.
5. Chưa chứng nhận nguồn 2 giờ, video 4K, VFR, stream offset, các trường hợp ảnh/animation hoặc performance query/UI; thuộc các vòng tích hợp/nghiệm thu tiếp theo. Corpus dài nhất hiện khoảng 6 phút, không thể dùng nó để tuyên bố đã kiểm tra 2 giờ.

Đã chuẩn bị `.cache/source-eval/review-corpus.json` và 25 file trong `review-corpus-labels/` để bổ sung nhãn mà không sửa transcript máy. Có kịch bản/phụ đề gốc thì có thể dùng làm bản nháp đối chiếu; vẫn cần nghe xác nhận. Chưa có câu trả lời về nguồn nhãn nên không tự điền hoặc giả báo đã duyệt.

Bước tiếp theo để đóng gói A là hoàn thiện corpus/nhãn, khóa holdout, chạy chấm ba profile và đối chiếu gate §13. Hạ tầng để thực hiện các bước đó đã sẵn sàng; không tự chuyển sang gói B/C hay coi chất lượng đã đạt.
