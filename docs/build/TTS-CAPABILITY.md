# TTS capability — Piper local và ElevenLabs

Trạng thái: đã triển khai hoàn chỉnh sau baseline `7f82f9e`. Hai backend cùng cung cấp
`tts.synthesize` qua Registry → Executor → Run/Result. Không có selector tự động và không
fallback giữa hai backend.

## Hợp đồng và đầu ra

- `piper-local`: local, không dùng credit, xuất `audio.tts` WAV.
- `elevenlabs`: cloud, có credit, xuất `audio.tts` MP3 sau authorization dùng một lần.

Cả hai Result có file `primary` với `mediaType: "audio"`. Observer tự hiển thị
`<audio controls>`; Result có thể làm nguồn cho các audio tool hoặc narration trong
`video.sequence`. Request không được truyền output path.

Backend đã chọn mà thiếu model, thiếu key, lỗi provider hoặc hết credit thì run thất bại.
PADStudio không tự đổi backend hay model.

## Cấu hình local và bí mật

Sao chép `padstudio.local.example.json` thành `padstudio.local.json`. File đích đã được
`.gitignore`; cũng có thể trỏ tới file khác bằng `PADSTUDIO_LOCAL_CONFIG`.

Chỉ loader local đọc `elevenLabs.apiKey`. Key không phải input của tool và không được ghi
vào project, Run, Result, authorization, log hoặc output CLI. Không đặt key trong request,
checkpoint hay tài liệu được commit. Nên tạo key ElevenLabs với scope tối thiểu và giới hạn
credit ở phía provider.

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

`vi_VN-vais1000-medium` là voice một speaker, 22.05 kHz; model card công bố CC BY 4.0.
Không dùng `vi_VN-vivos-x_low` làm mặc định vì model card ghi CC BY-NC-SA 4.0.
PADStudio không tự tải hoặc tự đổi model.

Ví dụ chạy:

```powershell
@'
{
  "capability": "tts.synthesize",
  "tool": "piper-local",
  "purpose": "Lời đọc tiếng Việt cho đoạn mở",
  "inputs": {
    "text": "Xin chào, đây là PADStudio.",
    "model": "vi_VN-vais1000-medium"
  }
}
'@ | npm run tool:run -- <project-id> -
```

## ElevenLabs: kiểm tra kết nối và chọn tiếng Việt

Điền `elevenLabs.apiKey` trong file local rồi chạy:

```powershell
npm run tts:inspect -- vi
```

Lệnh gọi thật các API chỉ đọc về subscription, model và voice theo ngôn ngữ. Output không
chứa key; nó giữ quota, model TTS, ngôn ngữ, giới hạn ký tự, hệ số credit, voice id/name,
`verifiedLanguages` và `previewUrl`. Agent/người dùng phải chọn rõ `modelId` và
`voiceId`; có thể nghe preview để đánh giá phát âm tiếng Việt.

Request mẫu:

```json
{
  "capability": "tts.synthesize",
  "tool": "elevenlabs",
  "purpose": "Lời đọc tiếng Việt bản đã duyệt",
  "inputs": {
    "text": "Xin chào, đây là PADStudio.",
    "modelId": "eleven_multilingual_v2",
    "voiceId": "<voice-id>",
    "outputFormat": "mp3_44100_128"
  }
}
```

## Phê duyệt credit

ElevenLabs bắt buộc ba bước:

1. `npm run tool:plan -- <project-id> -` kiểm tra kết nối/model và ước lượng credit.
2. `npm run tool:authorize -- <project-id> -` ghi phê duyệt của người dùng.
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

Authorization bind SHA-256 với capability, tool, purpose và toàn bộ inputs. Sửa một ký tự
cũng bị từ chối. Trước khi gửi, Executor ước lượng lại và chặn nếu vượt trần đã duyệt.
Authorization được claim nguyên tử và chỉ dùng một lần. Thành công ghi `consumed` cùng
`character-cost`, request id và trace id. Lỗi chắc chắn trước khi gửi giải phóng authorization;
lỗi sau khi bắt đầu request được ghi `usage_unknown` và không thể tái dùng. Không auto-approve.

## Verification và giới hạn

Test tự động bao phủ Piper giả lập, ElevenLabs API giả lập, catalog tiếng Việt, request binding,
single-use, trần credit, trạng thái usage không chắc chắn, Result audio và việc key không lọt vào
project. Piper thật chỉ chạy khi runtime/model đã cài.

Máy nghiệm thu hiện tại chưa có API key do người dùng cung cấp, vì vậy chưa gọi ElevenLabs cloud
thật và chưa đánh giá chất lượng voice thật. Đây là trạng thái kiểm thử môi trường, không phải TODO
tích hợp.
