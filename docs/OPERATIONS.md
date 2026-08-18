# PAD Studio — Vận hành

## Chạy local

Cài dependency, sao chép `.env.example` thành `.env` riêng nếu cần provider thật,
sau đó chạy `npm run dev`. Backend và frontend mặc định chỉ bind loopback.

Không chạy nhiều backend process cùng ghi vào một thư mục `projects/`. File
repository có optimistic revision cho project nhưng không có multi-process lock
hoặc transaction manager.

Trước khi dùng production/render, chạy:

```powershell
npm run doctor
```

Lệnh này chỉ đọc trạng thái Node, FFmpeg, FFprobe, Chrome/Edge, runtime directory
và dấu hiệu credential; nó không sửa máy, không in secret và không gọi provider.
Trên máy chỉ phát triển source, có thể dùng:

```powershell
npm run doctor -- --allow-missing-runtime
```

Chạy `npm run validate` trước release hoặc bàn giao trên máy có đầy đủ media
runtime.

## Runtime data và backup

Dữ liệu runtime nằm trong `projects/`, `.pad-studio/` và `tmp/`; chúng không được
commit. Muốn backup, dừng backend rồi sao chép toàn bộ thư mục `projects/`.
Không commit `.env`, credential, audio/video đã sinh hoặc workspace runtime.

## Retry và khôi phục

| Công việc | Request/trạng thái | Retry an toàn | Ảnh hưởng khi restart |
| --- | --- | --- | --- |
| Narration draft | Đồng bộ; join generation trong memory | Chỉ dùng lại ID với cùng fingerprint | Join đang chạy mất; artifact project đã lưu còn nguyên. |
| Motion Canvas | Đồng bộ; registry trong memory | Cùng ID chỉ hợp lệ với cùng source | Workspace/history đã publish còn; request đang chạy phải gửi lại. |
| Motion candidate | Đồng bộ; candidate registry trong memory | Chỉ dùng lại ID cho đúng candidate source | Candidate đã lưu còn; coordination đang chạy mất. |
| Voice/TTS | Đồng bộ; registry trong memory, checkpoint chunk trên disk | Không retry mù POST mơ hồ; đổi ID nếu input hoặc độ chắc chắn thay đổi | Chunk hoàn tất có thể resume; không giả định provider chưa tính phí. |
| Animation Sync | Đồng bộ; registry trong memory, workspace trên disk | Dùng lại ID chỉ với cùng Voice/Motion fingerprint | Có thể chạy lại từ upstream artifact đã lưu. |
| Production Layout | Đồng bộ; publish workspace bất biến | Retry cùng Sync source và revision hiện hành | Layout đã duyệt còn; source stale bị từ chối. |
| Final Render | Background; status trong memory, terminal report trên disk | Kiểm tra report trước; dùng ID mới sau lỗi/unknown | Active render dừng; report completed/failed vẫn đọc lại được. |

Trước khi retry Voice, Motion hoặc Sync, kiểm tra source revision và generation
fingerprint vẫn khớp. Với Final Render, đọc terminal report trước khi tạo job mới.

Nếu thiếu FFmpeg, FFprobe hoặc browser, cài/cấu hình executable bằng các biến
trong `.env.example`, chạy lại `npm run doctor`, rồi mới retry. Credential là dữ
liệu backend-only và không được xuất hiện trong log hay báo cáo lỗi.
