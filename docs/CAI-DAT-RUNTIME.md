# Cài đặt runtime tùy chọn

PADStudio chạy được ngay với **Node.js 20+** và **FFmpeg + ffprobe** trong `PATH`. Các phần dưới đây là **tùy chọn**: cài cái nào
bạn cần. PADStudio không bao giờ tự tải hay tự cài chúng; bạn (hoặc Agent theo yêu cầu của bạn) tự chạy các lệnh dưới đây.

Mọi runtime nằm trong thư mục `.runtime-tools/` ở gốc dự án (Git bỏ qua). Các lệnh viết cho **PowerShell trên Windows**, chạy từ gốc
dự án. Các mục A–D đã được chạy từng lệnh trên một bản clone sạch (Windows 11, Node 24, Python 3.12, FFmpeg 8.1) và cả sáu công cụ hoạt họa
và giọng đọc báo sẵn sàng sau đó.

| Bạn muốn | Cài | Dung lượng |
| --- | --- | --- |
| Hoạt họa bằng Remotion hoặc HyperFrames | [A](#a-remotion-và-hyperframes) (+ [B](#b-chrome-headless-shell-cho-remotion) cho Remotion) | ~0,6 GB |
| Hoạt họa toán học bằng Manim | [C](#c-manim) | ~0,4 GB |
| Giọng đọc miễn phí trên máy | [D](#d-piper-giọng-đọc-tiếng-việt-trên-máy) | ~0,2 GB |
| Cắt cảnh và phiên âm video quay sẵn | [E](#e-phân-tích-video-có-sẵn-cắt-cảnh-và-phiên-âm) | ~6 GB (có model) |
| Giọng đọc ElevenLabs | Không cần cài: dán khóa ở trang **Công cụ** | — |

**Đặt dự án ở đường dẫn ngắn** (ví dụ `D:PADStudio`). Windows giới hạn 260 ký tự cho một đường dẫn, và `pip install` sẽ lỗi
"No such file or directory" nếu thư mục dự án nằm sâu. Nếu gặp, hãy dời dự án lên gần gốc ổ đĩa rồi cài lại.

Sau mỗi phần, kiểm tra bằng `npm run tool:list -- --capability <capability>` hoặc mở trang **Công cụ** (nút *Kiểm tra lại*).
`npm run padstudio:doctor` tóm tắt toàn bộ.

## A. Remotion và HyperFrames

Hai thư viện này, cùng React, được ghim phiên bản trong [`runtime/animation/package.json`](../runtime/animation/package.json) kèm file khóa.

```powershell
New-Item -ItemType Directory -Force .runtime-tools\code-animation-node | Out-Null
Copy-Item runtime\animation\package.json, runtime\animation\package-lock.json .runtime-tools\code-animation-node\
npm ci --prefix .runtime-tools\code-animation-node
```

- **HyperFrames** dùng Chrome hoặc Edge đã cài trên máy (hoặc bản ở mục B). Có thể chỉ định bằng biến môi trường `PADSTUDIO_CHROME_PATH`.
- **Remotion** cần đúng bản Chrome Headless Shell ở mục B. PADStudio không tự chọn Chrome thường để tránh lỗi chính sách gỡ lỗi từ xa.
- `npm audit` có thể báo cảnh báo ở các gói con của Remotion/HyperFrames; chúng chỉ chạy cục bộ trong thư mục này. Đừng chạy
  `npm audit fix --force`: nó sẽ phá việc ghim phiên bản đã kiểm thử.

Kiểm tra: `npm run tool:list -- --capability animation.render`.

## B. Chrome Headless Shell cho Remotion

Tải bản đã ghim và so checksum SHA-256 trước khi giải nén:

```powershell
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell 5.1 tải rất chậm khi vẽ thanh tiến trình
$version = '153.0.8010.47'
$expected = '9f405cfaf7bc08bf9e046e653cd3086c0faa1d4e25907de857f7e7f093a20122'
New-Item -ItemType Directory -Force .runtime-tools\downloads | Out-Null
$zip = ".runtime-tools\downloads\chrome-headless-shell-win64-$version.zip"
Invoke-WebRequest "https://storage.googleapis.com/chrome-for-testing-public/$version/win64/chrome-headless-shell-win64.zip" -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Checksum không khớp, không giải nén.' }
Expand-Archive $zip -DestinationPath .runtime-tools\chrome-headless-shell -Force
```

Muốn dùng bản khác, đặt `PADSTUDIO_CHROME_PATH` trỏ tới `chrome-headless-shell.exe` (hoặc Chrome for Testing).

## C. Manim

```powershell
py -3.12 -m venv .runtime-tools\manim-venv
.runtime-tools\manim-venv\Scripts\python.exe -m pip install manim==0.21.0
```

PADStudio tìm `manim.exe` trong `.runtime-tools\manim-venv\Scripts`, hoặc theo biến `PADSTUDIO_MANIM_PATH`. Công thức viết bằng LaTeX
(`MathTex`, `Tex`) cần thêm một bản LaTeX như MiKTeX; PADStudio không kiểm tra điều đó.

Kiểm tra: `npm run tool:list -- --capability animation.render`.

## D. Piper: giọng đọc tiếng Việt trên máy

```powershell
py -3.12 -m venv .runtime-tools\piper-venv
.runtime-tools\piper-venv\Scripts\python.exe -m pip install piper-tts
New-Item -ItemType Directory -Force .runtime-tools\piper-models | Out-Null
Push-Location .runtime-tools\piper-models
..\piper-venv\Scripts\python.exe -m piper.download_voices vi_VN-vais1000-medium
Pop-Location
```

Rồi khai báo trong `padstudio.local.json` ở gốc dự án (tạo file từ mẫu `padstudio.local.example.json`, dùng dấu `/` trong đường dẫn).
Đường dẫn chương trình chỉ sửa được trong file này, không sửa được từ trang web, vì PADStudio sẽ chạy chúng:

```json
{
  "piper": {
    "pythonCommand": "D:/PADStudio/.runtime-tools/piper-venv/Scripts/python.exe",
    "modelDirectory": "D:/PADStudio/.runtime-tools/piper-models",
    "defaultModel": "vi_VN-vais1000-medium"
  }
}
```

Kiểm tra: `npm run tool:list -- --capability tts.synthesize`. Hãy xem giấy phép của từng giọng trước khi phân phối video.
Chi tiết: [`docs/build/TTS-CAPABILITY.md`](build/TTS-CAPABILITY.md).

## E. Phân tích video có sẵn (cắt cảnh và phiên âm)

Chỉ cần khi bạn đưa video quay sẵn cho Agent xử lý. Làm video từ đầu không cần phần này; `padstudio:doctor` sẽ báo `attention` (không
chặn) cho đến khi bạn cài. Cần Python 3.12 và hai model Whisper (~5 GB), cài một lần theo mục “Cài môi trường” của
[`eval/source-understanding/README.md`](../eval/source-understanding/README.md), rồi kiểm tra bằng `npm run analysis:doctor`.

## Khi một công cụ vẫn báo "Cần cài thêm"

- **Vừa cài xong mà vẫn báo thiếu?** Lần kiểm tra đầu tiên sau khi cài có thể chậm (Windows đang quét hàng nghìn file mới) và hết thời gian chờ.
  Bấm **Kiểm tra lại** trên trang Công cụ hoặc chạy lại `npm run tool:list`; lần sau sẽ thấy.
- Mở **Công cụ → Tổng quan → Chi tiết kỹ thuật** của mục đó: lý do được in nguyên văn.
- Chạy `npm run padstudio:doctor` rồi `npm run tool:list`.
- Kiểm tra `PATH` có `ffmpeg` và `ffprobe`: `ffmpeg -version`, `ffprobe -version`.
- Đường dẫn trong `padstudio.local.json` phải tồn tại và dùng dấu `/`.
- Nếu vẫn kẹt, mở một [issue](https://github.com/padduwcs/PADStudio/issues/new/choose) kèm kết quả `padstudio:doctor` (đã xóa thông tin riêng tư).
