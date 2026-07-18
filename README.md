# PAD Studio

**PAD Studio — Precise Animated Demonstration Studio** là ứng dụng web chạy cục bộ, hỗ trợ sản xuất video giảng giải trực quan bằng animation.

Ứng dụng hướng đến việc giải thích thuật toán và cấu trúc dữ liệu cho người mới học bằng hình ảnh logic, dễ hiểu và đồng bộ chính xác với lời thuyết minh. Video tập trung vào bản chất của kiến thức, không hiển thị code và không phụ thuộc vào caption.

## Quy trình chính

```text
Nhập chủ đề
→ Tạo và review mạch giảng
→ Tạo và review kế hoạch voice–visual
→ Sinh và review scene Motion Canvas
→ Sinh voice
→ Đồng bộ animation
→ Render bản nháp
→ Chỉnh sửa bằng Layout Editor
→ Render video cuối
```

Người dùng có thể chỉnh vị trí, kích thước, thuộc tính và timing của các thành phần trực tiếp trên giao diện. Những scene và component tốt có thể được lưu lại làm tài nguyên tham khảo cho các video sau.

## Trạng thái

PAD Studio đang trong giai đoạn phát triển ban đầu.

Vertical slice đầu tiên đã có thể chạy:

- Nhập chủ đề và định hướng cho video.
- Validate dữ liệu ở frontend và backend.
- Lưu project draft vào `projects/<project-id>/project.json`.
- Tự động lưu thay đổi vào project hiện tại.
- Phát hiện xung đột chỉnh sửa thay vì âm thầm ghi đè dữ liệu mới hơn.
- Đăng nhập Codex và xác minh phiên bằng kết nối thật trước khi sang mạch giảng.
- Dùng toàn bộ đầu vào để AI tóm tắt yêu cầu và đề xuất mạch giảng có cấu trúc.
- Chỉnh sửa, sắp xếp, tạo lại và chốt mạch giảng trước bước voice–visual.
- Tạo kế hoạch voice–visual theo từng ý đã chốt, gồm lời thuyết minh, visual,
  chuyển động và thời lượng của từng beat.
- Chỉnh sửa, sắp xếp beat, tạo lại theo góp ý và chốt kế hoạch trước khi sinh
  scene hoặc gọi dịch vụ tạo voice.
- Sinh một scene Motion Canvas cho từng section đã chốt, kiểm tra quyền import
  và biên dịch TypeScript trước khi nhận kết quả.
- Xem source, tạo lại theo góp ý và chốt bộ scene trước khi sang bước tiếp theo.
- Lưu từng lần sinh vào workspace bất biến riêng của project để bản mới không
  ghi đè code scene đã có.
- Kết nối ElevenLabs bằng API key chỉ lưu ở backend và xác minh live qua
  subscription cùng model catalog trước khi báo đã xác thực.
- Hiển thị lượng token của lần sinh gần nhất để người dùng theo dõi.
- Liệt kê, mở lại, chỉnh sửa và xóa project cục bộ.
- Giao diện responsive cho desktop và mobile.

Thời lượng định hướng hiện dùng ba mức:

- Ngắn gọn: 1–2 phút.
- Tiêu chuẩn: 3–5 phút.
- Chuyên sâu: 6–8 phút.

Project metadata được giữ trong Git để có thể version control nội dung từng
video. Chỉ thư mục render sinh ra tại `projects/**/renders/` bị ignore.

Mỗi project có hai chỉ số độc lập:

- `version` là phiên bản cấu trúc file; dữ liệu v1, v2, v3 và v4 được đọc và nâng cấp lên
  cấu trúc hiện tại ở lần ghi tiếp theo.
- `revision` tăng sau mỗi thay đổi nội dung và được dùng với `If-Match` để
  chặn hai thao tác ghi đè lẫn nhau.

Request tạo project mang `creationId` ổn định để retry sau lỗi mạng không tạo
thêm bản trùng. Các thao tác ghi trên cùng một project được thực hiện tuần tự và
dùng file tạm riêng trước khi thay thế `project.json`. Project có dữ liệu hỏng
hoặc phiên bản chưa hỗ trợ được báo trong thư viện thay vì bị ẩn im lặng.

PAD Studio kết nối tới `codex app-server` qua stdio. Trạng thái “đã kết nối”
chỉ được trả về sau khi Codex làm mới phiên đăng nhập, đọc được rate limit và
model catalog từ dịch vụ; việc chỉ tìm thấy file credential cục bộ là chưa đủ.
Credential tiếp tục do Codex CLI quản lý và không được đọc hoặc trả về frontend.
Codex CLI tự lưu và làm mới credential nên tải lại PAD Studio không yêu cầu đăng
nhập lại. Frontend chỉ cache loại tài khoản và gói dịch vụ (không cache token
hoặc email) để nhận diện phiên cũ trong lúc xác minh nền. Cache này chỉ bị xóa
khi Codex trả về trạng thái đã đăng xuất; lỗi mạng hoặc lỗi CLI chỉ yêu cầu kiểm
tra lại.

Mạch giảng được sinh qua một thread Codex tạm thời với structured output và
sandbox chỉ đọc. PAD Studio dùng một prompt ngắn có version, không gửi lại mạch
cũ khi tạo mới, chỉ gửi khi người dùng yêu cầu AI chỉnh theo góp ý và không tự
retry làm tăng chi phí. Mỗi request có `generationId` để retry lỗi mạng không
gọi AI hai lần. Kết quả AI luôn là bản nháp; người dùng phải review và chốt
trước khi sang voice–visual.

Kế hoạch voice–visual dùng cùng cơ chế an toàn nhưng có prompt và schema riêng.
Mỗi section của mạch giảng được giữ nguyên ranh giới và chia thành các beat ngắn.
Mốc bắt đầu được suy ra từ tổng thời lượng beat để timeline không có hai nguồn dữ
liệu mâu thuẫn. Nếu đầu vào hoặc mạch giảng thay đổi, kế hoạch downstream được
đánh dấu cũ và phải tạo lại trước khi có thể chốt.

Scene Motion Canvas chỉ được sinh từ mạch giảng và kế hoạch voice–visual đã chốt,
qua structured output có schema riêng. Source bị giới hạn trong các package
Motion Canvas, không được dùng network, filesystem hoặc runtime API ngoài phạm
vi. Mỗi section được sinh bằng một Codex turn riêng và chạy song song có giới
hạn. Pipeline dùng model mặc định do Codex catalog công bố, chọn reasoning
`medium` cho lượt dựng đầy đủ và tự lùi về capability/default hợp lệ nếu catalog
hoặc model thay đổi; không hard-code một họ model cụ thể. Scene đã sinh thành công
được cache theo `generationId`, kể cả khi một scene timeout hoặc vòng sửa chưa
hoàn tất; retry chỉ chạy lại scene lỗi. Lỗi TypeScript
được gửi về một vòng sửa có định hướng cho đúng file lỗi, tối đa hai lần, thay
vì sinh lại toàn bộ video. Mỗi generation chỉ được lưu tại
`projects/<project-id>/motion-canvas/generations/<generation-id>/`; project chỉ
giữ metadata và con trỏ đến generation hiện hành sau khi toàn bộ scene biên dịch
thành công. Khi dữ liệu upstream đổi, bộ
scene được đánh dấu cũ và không thể chốt cho đến khi sinh lại.

## Chạy ở môi trường phát triển

Yêu cầu Node.js 24.12 trở lên và Codex CLI có trong `PATH`.

```bash
npm install
npm run dev
```

Frontend chạy tại `http://127.0.0.1:5173`, backend chạy tại
`http://127.0.0.1:4174`.

### Kết nối ElevenLabs

ElevenLabs cho phép dùng API trên cả gói Free, vì vậy chưa cần mua gói trả phí
để thử kết nối. Tạo API key tại
[`Developers → API Keys`](https://elevenlabs.io/app/settings/api-keys), bật
quyền đọc subscription/user và quyền Text to Speech, sau đó tạo file `.env` từ
file mẫu:

```bash
cp .env.example .env
```

Trên PowerShell có thể dùng:

```powershell
Copy-Item .env.example .env
```

Điền key vào biến sau và khởi động lại PAD Studio:

```dotenv
ELEVENLABS_API_KEY=your_api_key_here
```

API key chỉ được đọc ở backend và không được trả về frontend. Card ElevenLabs
ở bước Motion Canvas gọi thật `GET /v1/user/subscription` và `GET /v1/models`;
chỉ khi cả subscription hợp lệ và model catalog có Text to Speech thì trạng
thái mới là “đã xác thực”. Hai request kiểm tra này không tạo audio và không
tiêu credits. Có thể kiểm tra response nội bộ tại:

```text
GET /api/integrations/elevenlabs/status
```

Sau khi đã sinh scene cho một project, mở Motion Canvas editor bằng:

```bash
npm run motion:serve -- --project <project-id>
```

Kiểm tra runtime trên chính workspace đã sinh bằng:

```bash
npm run validate:motion -- --project <project-id>
```

Mặc định bước Motion Canvas dùng model mặc định trong Codex catalog và reasoning
`medium`. Deployment có thể yêu cầu model hoặc effort cụ thể bằng
`PAD_MOTION_CANVAS_MODEL` và `PAD_MOTION_CANVAS_REASONING_EFFORT`; generator sẽ
đối chiếu capability trước khi gửi request, nên không truyền effort mà model
không hỗ trợ.

## Kiểm tra và chạy production

```bash
npm run validate
npm run build
npm start
```

`npm run validate` kiểm tra schema/API/UI, build PAD Studio và khởi động runtime
Motion Canvas tạm để transform một project cùng các scene mẫu. Tham số
`--project` ở trên dùng cùng phép kiểm tra đó cho workspace thật.

Sau khi build, backend phục vụ cả API và frontend tại
`http://127.0.0.1:4174`.
