# PAD Studio

## Workflow hiện tại

PAD Studio chỉ có đúng năm trang theo thứ tự: **Nội dung → Cách đọc → Sản xuất
→ Chỉnh scene → Xuất video**.

1. **Nội dung** — tạo hoặc chỉnh sửa nguồn nội dung của project.
2. **Cách đọc** — duyệt lời thoại và quy tắc phát âm riêng/dùng chung.
3. **Sản xuất** — tạo giọng đọc và scene Motion Canvas từ kế hoạch nội bộ.
4. **Chỉnh scene** — đồng bộ narration với animation và duyệt bố cục hình ảnh.
5. **Xuất video** — render và tải MP4 cuối cùng.

`TeachingOutline` và `VoiceVisualPlan` là artifact nội bộ được tạo theo cách xác
định; chúng không phải các bước giao diện bổ sung.

Dùng `npm run doctor` để kiểm tra điều kiện chạy production/render mà không sửa
máy. Trên máy phát triển không có FFmpeg, FFprobe hoặc browser, dùng
`npm run doctor -- --allow-missing-runtime` để kiểm tra source và cấu hình.

PAD Studio biến nội dung học thành video ngắn có lời đọc, hình minh hoạ động và bản xuất sẵn dùng. Ứng dụng ưu tiên một quy trình liền mạch: tạo giọng trước, sinh cảnh đã khớp lời, rồi chỉ chỉnh những chỗ cần thiết.

## Luồng sử dụng

1. **Nội dung** — nhập chủ đề hoặc kịch bản.
2. **Cách đọc** — thêm quy tắc phát âm riêng cho project hoặc dùng chung.
3. **Giọng đọc & scene** — chọn giọng ElevenLabs, tạo narration và các scene theo narration đó.
4. **Chỉnh scene** — chỉnh trực tiếp trong một editor có cả hình lẫn tiếng; có thể sửa timeline, chữ, hình, âm lượng và watermark.
5. **Xuất video** — render MP4 đã ghép hình, tiếng và watermark.

## Tính năng chính

- Chọn, nghe thử và tạo lời đọc bằng ElevenLabs.
- Từ điển cách đọc theo project hoặc dùng chung.
- Sinh scene Motion Canvas theo lời đọc; timeline đồng bộ với audio.
- Preview/chỉnh scene trong một khung duy nhất, có phát hình + tiếng.
- Watermark chữ hoặc ảnh, đặt vị trí và độ trong suốt.
- Render MP4 H.264/AAC, kiểm tra media trước khi trả kết quả.
- Lưu project, lịch sử sinh và workspace trên máy chủ local.

## Chạy local

Yêu cầu: Node.js `>= 24.12`, npm, FFmpeg và Chrome/Edge để render. Cài dependency rồi tạo file cấu hình:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Mở địa chỉ được in ra bởi lệnh `dev` (mặc định là `http://localhost:5173`).

Để dùng voice thật, điền `ELEVENLABS_API_KEY` trong `.env`. Các biến timeout, đường dẫn FFmpeg và browser đều là tuỳ chọn; xem chú thích trong [.env.example](.env.example).

## Lệnh thường dùng

```powershell
npm run dev             # frontend + backend
npm run build           # kiểm tra TypeScript và build frontend
npm test                # unit/integration tests
npm run validate        # toàn bộ kiểm tra trước khi bàn giao
npm run smoke:live      # kiểm tra tích hợp live (cần credential)
```

## Tài liệu kỹ thuật

- [Kiến trúc](docs/ARCHITECTURE.md): module, API, state và các ràng buộc runtime.
- [Bối cảnh sản phẩm](docs/PROJECT_CONTEXT.md): mục tiêu UX và quy tắc phát triển.

## Lưu ý vận hành

- API key chỉ ở backend; không đưa vào frontend, log hay commit.
- Media, workspace và dữ liệu project là dữ liệu runtime, không phải source asset để commit.
- Không tự retry các yêu cầu TTS đã timeout/mất kết nối vì có thể phát sinh chi phí hai lần.
