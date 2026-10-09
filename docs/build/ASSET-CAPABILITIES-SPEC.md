# Đợt 3 — nguyên liệu dùng chung, gói đầu

Gói đầu bổ sung ba capability dùng lại được qua Registry → Executor → Run/Result.
Không phụ thuộc pilot, loại video hoặc workflow cố định. Đây là phạm vi đầu của Đợt 3,
chưa phải toàn bộ hệ thống sinh nội dung.

| Khả năng | Công cụ | Công dụng |
| --- | --- | --- |
| graphic.render | browser-graphic | PNG thẻ chữ, biểu đồ cột có số âm/dương, sơ đồ bước |
| audio.prepare | ffmpeg-audio-prepare | Tách/cắt audio từ audio/video, gain, fade, loudness hai lượt |
| media.acquire | https-media | Tải file media từ URL công khai đã được Agent chọn, giữ attribution và hash |
| tts.synthesize | piper-local / elevenlabs | Tạo Result lời đọc audio local hoặc cloud có approval credit |

Ưu tiên dựa trên tính dùng chung, kết hợp được với tool hiện có và có đường chạy local.
TTS đã được bổ sung ở gói kế tiếp với Piper local và ElevenLabs cloud, dùng chung contract và
gate authorization credit. Không có dịch vụ tính phí được gọi trong nghiệm thu do chưa có API key
người dùng; xem [TTS-CAPABILITY.md](TTS-CAPABILITY.md).

Hai capability bổ sung sau đó, không nằm trong bảng gói đầu ở trên:

| Khả năng | Công cụ | Công dụng |
| --- | --- | --- |
| media.search-stock | wikimedia-stock | Tìm candidate ảnh/video/audio trên Wikimedia Commons (`query`, `mediaType`, `limit`), giữ creator, license, source page; chưa nhập asset nào. Cần HTTPS, không cần key. |
| media.register-generated | external-generated-media | Đăng ký file do Agent/provider ngoài tạo (đã import vào project) kèm provider, model, prompt, rightsBasis và cost provenance; không gọi provider và không biến rights/content review thành passed. |

Ảnh AI tự sinh bởi PADStudio vẫn chưa có: ảnh/audio/video do provider ngoài tạo đi vào project qua
`media.register-generated`. Skill tương ứng: `stock-sourcing`, `asset-preparation`, `tool-selection`.

## Hợp đồng và ví dụ

Gửi request bằng tool:run; chỉ dùng ID resource/result cho media thuộc project.
Các JSON dưới đây là trường inputs, không phải toàn bộ request.

graphic.render:
~~~json
{"kind":"card","title":"Ý chính","body":"Một ý rõ ràng cho người xem.","width":720,"height":1280,"theme":"dark"}
~~~
kind là card (body), bar-chart (items: [{label,value}]) hoặc steps (steps: [text]).
Chỉ nhận field tương ứng loại đồ họa. Có title, footer tùy chọn, theme dark/light,
accent màu hex, width/height chẵn 320–3840 và artifactIds tùy chọn để gắn đúng revision.
Không nhận HTML, script, URL, font hay path từ request. Text không vừa kích thước đọc tối thiểu
sẽ lỗi, không cắt mất hoặc tự chuyển thành loại khác. PNG và layout checks được giữ.
Font hệ thống có thể khác giữa máy; layout pass không phải creative approval.
Cần Chrome/Edge/Chromium local hoặc PADSTUDIO_BROWSER_PATH.

audio.prepare:
~~~json
{"source":{"kind":"resource","id":"resource-REPLACE"},"startSeconds":1,"endSeconds":5,"fadeInSeconds":0.2,"fadeOutSeconds":0.3,"loudnessTargetLufs":-18}
~~~
Nguồn audio/video đã đăng ký, audioStream là thứ tự track audio (mặc định 0).
Bỏ endSeconds để lấy đến hết track; một kết quả tối đa 1800 giây.
gainDb -30..12, fade 0..30 giây, loudnessTargetLufs -30..-10 tùy chọn.
Xuất WAV PCM16 stereo 48 kHz, giữ nguồn/hash và range. Loudness dùng hai lượt đo/xử lý;
audio im lặng không đo được sẽ báo lỗi khi yêu cầu normalize. Không khử nhiễu hoặc TTS.
Thời gian range tương đối với track audio đã đưa mốc đầu về 0.
Kết quả dùng được với narration của sequence hoặc audio.overlay; cần nghe review riêng.

media.acquire:
~~~json
{"url":"https://example.org/media.png","mediaType":"image","name":"Hình minh họa","attribution":{"creator":"Tên tác giả","license":"Thông tin giấy phép","sourcePage":"https://example.org/source"}}
~~~
Agent chọn file cụ thể trước khi chạy. Không có search, cookie, authentication, playlist,
provider fallback hoặc auto retry. Chỉ HTTPS công khai IPv4, port mặc định, không credentials,
tối đa 3 redirect và 128 MiB. DNS từng hop được kiểm tra/pin; từ chối địa chỉ nội bộ.
Tối đa 30 phút, 3840×2160 pixel cho hình/video; MIME phải thuộc danh sách hỗ trợ trong adapter.
expectedSha256 tùy chọn ràng buộc byte đã biết. File được kiểm tra stream/decode/hash rồi mới
đăng ký Result. Attribution do người gọi cung cấp, không được trình bày là giấy phép đã xác minh.
URL được giữ trong Run/Result nên không dùng URL chứa token bí mật.
Nguồn tải được lưu thành Result (nguyên liệu thu thập), không giả thành upload gốc của người dùng.

## Lưu trữ, phiên bản và giao diện

Không tạo kho asset riêng. Mỗi lần tạo nguyên liệu sinh Run/Result bất biến; Agent dùng artifact,
workflow, review, decision và checkpoint hiện có để ghi nhu cầu/lựa chọn. Graphic có thể liên kết
artifactIds; audio trỏ inputResources/inputResults; acquisition giữ requested/final URL,
redirects, attribution, thời điểm và SHA-256. Không kế thừa approval khi tạo bản mới.
Output chỉ ghi trong workspace Executor, rollback/recovery dùng cơ chế chung.
Observer hỗ trợ audio player, ảnh, thông số và attribution; web tiếp tục chỉ đọc.

## Nghiệm thu

test/asset-capabilities.test.js dùng ba project giáo dục, marketing, business và cả khung dọc/ngang.
Kiểm tra đồ họa đưa vào sequence thật, audio resource→result→result, source hash, HTTP byte range,
phê duyệt không kế thừa, finalization recovery, dữ liệu sai, quá chữ, MIME/size/redirect/private IP,
corrupt download và checksum mismatch. Download transport được tiêm fixture để nghiệm thu lặp lại
không phụ thuộc mạng; không coi đó là chứng nhận mọi website.
Chạy node --test để kiểm tra toàn repository.

## Tham khảo có chọn lọc

Đã đọc D:/OpenMontage/tools/graphics/diagram_gen.py, tools/video/showcase_card.py và
schemas/artifacts/asset_manifest.schema.json ở checkout cd9f3c1. Học cách cung cấp đồ họa
và giữ provenance; implementation mới dùng contract/output workspace PADStudio.
Không mang raw path, silent fallback hoặc pipeline stage vào lõi.


## Kết quả nghiệm thu gói đầu

Mốc nghiệm thu ban đầu của gói là 144/144 và 160/160 sau khi tích hợp TTS và pilot (số liệu của các
ngày đó; số hiện hành nằm ở [PADSTUDIO-DEVELOPMENT-STATUS.md](PADSTUDIO-DEVELOPMENT-STATUS.md)); browser
khi ấy đạt PNG/audio, attribution, giữ player qua polling và viewport 390/768/1440. Báo cáo gói: [phase3-asset-capabilities-acceptance.json](../../reports/phase3-asset-capabilities-acceptance.json).
Chạy lại bằng `npm test` và `npm run assets:acceptance` (Windows, Chrome/Edge). Runner tạo project
fixture riêng dưới `.cache/asset-browser-projects`; không dùng project owner. Không coi fixture
transport là kiểm chứng mạng ngoài. Bằng chứng kết hợp asset + Piper + sequence thật nằm trong
[phase3-vd04-pilot-acceptance.json](../../reports/phase3-vd04-pilot-acceptance.json).
