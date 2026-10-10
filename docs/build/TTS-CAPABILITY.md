# TTS capability — Piper local và ElevenLabs

Trạng thái: đã triển khai và nghiệm thu contract/integration. Hai backend cùng cung cấp
`tts.synthesize` qua Registry → Executor → Run/Result. Người gọi chọn backend, model và voice
rõ ràng; hệ thống không tự chọn và không fallback.

## Hợp đồng và đầu ra

- `piper-local`: local, không dùng credit, xuất Result `audio.tts` WAV PCM16.
- `elevenlabs`: cloud, có credit, xuất Result `audio.tts` MP3 sau authorization dùng một lần.

Cả hai Result có file `primary`, `mediaType: "audio"`, nghe được bằng `<audio controls>` trong
observer và dùng trực tiếp làm source `{ "kind": "result", "id": "...", "file": "primary" }`
cho `audio.prepare`, `audio.overlay` hoặc narration của `video.sequence`. Text trung gian của
Piper bị xóa trước khi commit output; thư mục output thành công chỉ giữ file đã khai báo.

Backend đã chọn mà thiếu runtime/model/key, bị provider từ chối hay hết credit thì Run thất bại.
Không tự đổi backend/model và không tự gửi lại request cloud.

## Cấu hình local và bí mật

Người dùng dán khóa ElevenLabs ở trang Công cụ của observer (`/?panel=tools`); trang ghi vào `padstudio.local.json` ở thư mục
repository. Cũng có thể sao chép `padstudio.local.example.json` thành `padstudio.local.json` rồi sửa tay. File đích nằm trong
`.gitignore`; có thể dùng file khác qua `PADSTUDIO_LOCAL_CONFIG`. Mẫu để key rỗng, vì vậy sao
chép nguyên mẫu không làm ElevenLabs xuất hiện như đã cấu hình.

Chỉ loader local đọc `elevenLabs.apiKey`. Key không thuộc input tool và không được ghi vào
project, Run, Result, authorization, log hay output CLI; trang Công cụ chỉ hiện "đã lưu" cùng bốn ký tự cuối. Không đặt key trong request/checkpoint
hoặc tài liệu được commit. Nên tạo key ElevenLabs có scope tối thiểu và giới hạn credit ở provider.

## Cài Piper và model tiếng Việt

Piper hiện được duy trì tại
[OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl). Cài runtime và voice:

```powershell
py -m pip install piper-tts
New-Item -ItemType Directory -Force D:\Models\piper
Set-Location D:\Models\piper
python -m piper.download_voices vi_VN-vais1000-medium
```

Thư mục phải có cả `vi_VN-vais1000-medium.onnx` và
`vi_VN-vais1000-medium.onnx.json`. Cấu hình:

```json
{
  "piper": {
    "pythonCommand": "python",
    "modelDirectory": "D:/Models/piper",
    "defaultModel": "vi_VN-vais1000-medium"
  }
}
```

Integration chỉ nhận voice id bắt đầu bằng `vi_VN-`, không nhận path. Metadata phải khai báo
`language.code: "vi_VN"`, sample rate hợp lệ và số speaker hợp lệ. `speakerId` phải là số
nguyên nằm trong range; WAV sinh ra phải có đúng một stream PCM16, sample rate đúng metadata và
duration dương. `vi_VN-vais1000-medium` là voice một speaker, 22.05 kHz. Hãy kiểm tra license
của từng voice trước khi phân phối; PADStudio không tự tải hoặc tự đổi model.

Ví dụ:

```json
{
  "capability": "tts.synthesize",
  "tool": "piper-local",
  "purpose": "Lời đọc tiếng Việt cho đoạn mở",
  "inputs": {
    "text": "Xin chào, đây là PADStudio.",
    "model": "vi_VN-vais1000-medium",
    "speakerId": 0
  }
}
```

Chạy bằng `npm run tool:run -- <project-id> <request.json>`.

## ElevenLabs: kiểm tra kết nối và chọn tiếng Việt

Lưu khóa (trang Công cụ có nút **Kiểm tra kết nối** gọi đúng phép kiểm tra này) hoặc chạy:

```powershell
npm run tts:inspect -- vi
```

Lệnh gọi thật các API chỉ đọc subscription, toàn bộ các trang voice khớp ngôn ngữ và catalog
model. Output không chứa key; nó gồm quota, model TTS, ngôn ngữ, giới hạn text/request, khả năng
style/speaker boost, hệ số credit, voice id/name, `verifiedLanguages` và `previewUrl`.
`supportsRequestedLanguage` là `true/false` khi provider công bố danh sách, hoặc `null` khi
catalog không đủ dữ liệu. Model công bố không hỗ trợ ngôn ngữ đã chọn, voice không có trong
catalog ngôn ngữ, hoặc style/speaker boost không được model hỗ trợ đều bị từ chối trước request.
Mẫu tiếng Việt dùng `eleven_v3`; `eleven_multilingual_v2` không hỗ trợ tiếng Việt theo danh sách
hiện hành của provider.
Người dùng nên nghe preview và duyệt cách phát âm tiếng Việt trước khi tạo hàng loạt.

Request mẫu:

```json
{
  "capability": "tts.synthesize",
  "tool": "elevenlabs",
  "purpose": "Lời đọc tiếng Việt bản đã duyệt",
  "inputs": {
    "text": "Xin chào, đây là PADStudio.",
    "languageCode": "vi",
    "modelId": "eleven_v3",
    "voiceId": "<voice-id>",
    "outputFormat": "mp3_44100_128"
  }
}
```

`languageCode` là mã ISO 639-1 chữ thường, mặc định `vi`, được gửi rõ trong request synthesize.
Model và voice khả dụng phụ thuộc tài khoản/provider tại thời điểm chạy; dùng output inspect thay
vì hard-code một voice id.

Catalog voice được lấy với `include_custom_rates=false`. Voice có custom rate (thường là giọng từ Voice Library) vẫn dùng được nếu
provider trả về, nhưng PADStudio không chứng minh được một trần credit chỉ từ số ký tự: hệ số thực tế còn phụ thuộc rate của voice. Khi đó
`estimateUsage` trả mức ước tính thường (số ký tự x hệ số model) kèm `uncertain: true` và `basis` có `estimate_is_not_a_ceiling`;
`executor.plan` và authorization lưu cờ này. Mỗi lần tạo vẫn cần phê duyệt dùng một lần đúng văn bản, và số credit thực tế (header
`character-cost`) được ghi vào authorization (`exceededApprovedCeiling` nếu vượt mức đã duyệt). Hệ quả: với giọng như vậy, trần credit
theo dự án chỉ chặn được *sau* lần tạo vượt mức, không chặn trước. Chỉ khi model catalog không có multiplier hữu hạn dương thì
plan/estimate dừng với `approval_limit_unknown` và không gửi request trả phí.

`ffprobe` là dependency bắt buộc để xác minh file audio. Availability kiểm tra dependency này trước
khi plan/authorize, và Executor kiểm tra lại ngay trước POST để không dùng credit nếu môi trường đã
thay đổi giữa hai bước.

## Chọn giọng và model trên trang Công cụ

Sau khi có khóa, mục ElevenLabs của trang Công cụ có bộ chọn giọng và model (`ui/voice-picker.js`). Nó gọi ba endpoint chỉ đọc của
observer, đều là POST sau cùng lớp bảo vệ với việc lưu cài đặt (Host, Origin, JSON, `X-PADStudio-Intent`) để trang khác không bắt server
gọi ElevenLabs bằng khóa đã lưu:

- `POST /api/settings/elevenlabs/models` — model TTS của tài khoản, kèm hỗ trợ ngôn ngữ, hệ số credit và giới hạn ký tự. Chỉ model
  hỗ trợ ngôn ngữ và có hệ số credit hữu hạn mới `usable`.
- `POST /api/settings/elevenlabs/voices` — tìm giọng theo tên (`search` ≤ 100 ký tự), mỗi trang 30 giọng, `pageToken` để tải thêm.
  Luôn gửi `include_custom_rates=false`; giọng provider vẫn trả mà có custom rate hiện ra, chọn được, kèm `costNote` cảnh báo ước tính chỉ là mức tối thiểu.
- `POST /api/settings/elevenlabs/voice` — tra một giọng theo mã (giọng người dùng đã dùng). Chỉ giọng nằm trong tài khoản; không thấy thì
  trả 404 kèm gợi ý thêm giọng vào My Voices.

Tất cả đều miễn phí (không tạo audio, không tốn credit). `previewUrl` chỉ được chuyển cho trang khi là https tới `elevenlabs.io`,
`*.elevenlabs.io` hoặc `storage.googleapis.com/eleven-…`; trình duyệt tải bản nghe thử trực tiếp từ ElevenLabs khi người dùng bấm ▶.

Lựa chọn lưu vào `elevenLabs.voiceId`, `elevenLabs.voiceName` và `elevenLabs.modelId` trong `padstudio.local.json`. Đó là mặc định để
Agent đề xuất (`environment.voice` trong `project:resume`), không phải mặc định ngầm: `tts.synthesize` vẫn bắt buộc `modelId` và
`voiceId` trong từng request. Danh sách model hiển thị là danh sách thật của tài khoản, nên model mới của ElevenLabs xuất hiện mà không cần đổi code.

## Trần credit theo dự án

Ngân sách USD (`project:budget`) không giới hạn được ElevenLabs vì tool này tính bằng credit. `npm run project:credits -- <project-id>
[show | set <credit> | clear]` đặt trần credit cho một dự án (`credit-budget.json`). Mọi authorization được cộng: `consumed` theo
`character-cost` thực tế của provider, `claimed` và `usage_unknown` theo ước tính (coi như đã tốn), `released` không tính, `approved` chưa
chạy chưa tính. `tool:plan` trả `creditBudget`; `tool:authorize` từ chối khi ước tính vượt phần còn lại; `tool:run` kiểm tra lại ngay
trước khi claim authorization, trong cùng một khóa với việc claim. Chưa đặt trần thì không kiểm tra gì thêm.

## Phê duyệt credit

ElevenLabs bắt buộc ba bước:

1. `npm run tool:plan -- <project-id> <request.json>` kiểm tra model và ước lượng credit.
2. `npm run tool:authorize -- <project-id> <authorization.json>` ghi phê duyệt của người dùng.
3. Thêm `authorizationId` vào đúng request rồi gọi `npm run tool:run`.

Input authorize:

```json
{
  "request": { "...": "request ElevenLabs nguyên vẹn" },
  "approval": {
    "approvedBy": "user",
    "maxCredits": 120,
    "reason": "Duyệt đúng lời đọc này"
  }
}
```

`maxCredits` phải là số nguyên không âm và không thấp hơn estimate. Authorization bind SHA-256
với capability, tool, purpose và toàn bộ inputs; sửa một ký tự cũng bị từ chối. Executor ước
lượng lại trước khi gửi và chặn khi vượt trần. Authorization được claim nguyên tử, link trực tiếp
trong Run và chỉ dùng một lần.

- Ngay khi provider trả response headers: receipt gồm usage từ `character-cost`, request id và
  trace id được lưu trước cả lúc đọc audio body, ghi hoặc probe file cục bộ. Authorization sau đó là
  `consumed`, kể cả khi body bị đứt hay kiểm tra file lỗi, vì request cloud đã hoàn tất và credit
  không thể hoàn tác.
- Lỗi chắc chắn trước POST: `released`; đây vẫn là record terminal, cần phê duyệt mới nếu chạy lại.
- Lỗi mạng trong/sau POST mà chưa nhận được response, hoặc không biết provider đã nhận chưa:
  `usage_unknown`, không tái dùng.
- Nếu output đã commit nhưng lưu Result/đóng Run lỗi, Executor giữ MP3 và pending Result draft rồi
  trả `finalization_pending`. Chạy `npm run project:run:recover -- <project-id> <run-id>` để ghi
  Result còn thiếu, settle authorization còn `claimed` từ receipt và hoàn tất Run. Recovery là
  idempotent, không gọi lại tool/provider và không phát sinh request trả phí thứ hai.
- Không có auto-approve, auto-retry hoặc fallback.

## Verification và giới hạn

Test tự động bao phủ Piper/ElevenLabs giả lập, UTF-8 tiếng Việt, metadata/speaker/sample rate,
voice pagination/custom rate, model-language/multiplier, giới hạn credit, exact binding/single-use,
preflight `ffprobe`, receipt trước khi đọc response body, phục hồi Result và authorization không gọi
lại provider, không lưu key, thư mục output chỉ có file khai báo và Result audio dùng được làm
source video.

Máy nghiệm thu hiện tại đã cấu hình Piper local `vi_VN-vais1000-medium` trong runtime bị ignore và
đã tạo Result thật cho pilot vd04. Lời dẫn cuối được ASR xác nhận đủ 17 từ theo thứ tự; bản mix
không có clipping candidate. Chưa có API key người dùng nên ElevenLabs cloud thật không được gọi;
chưa có human listening review nên không tuyên bố chất giọng tự nhiên đã đạt. Chạy lại contract gate
bằng `npm run tts:acceptance`; xem [report TTS](../../reports/phase3-tts-acceptance.json) và
[report pilot](../../reports/phase3-vd04-pilot-acceptance.json). Trước sản xuất hàng loạt, vẫn cần
nghe Result trong observer và chỉ duyệt credit cloud cho exact request khi thật sự cần.
