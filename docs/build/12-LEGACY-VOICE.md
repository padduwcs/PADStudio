# Ranh giới Legacy Voice

## Mục đích

Đây là ranh giới tái sử dụng có chủ ý duy nhất từ các project PADStudio chưa hoàn thành. Legacy scene, Motion Canvas source, layout decision, render metadata và workflow state cũ không thuộc creative foundation mới.

## Policy import

```text
Legacy project
    ↓
Locate generated voice assets
    ↓
Probe and verify audio
    ↓
Preserve the original files
    ↓
Register a Voice Take in the shared voice library
    ↓
Sử dụng nó như input bình thường trong project mới
```

Import có thể giữ alignment và metadata nếu chúng hợp lệ. Transcript text có sẵn chỉ dùng để kiểm tra hoặc khôi phục context; audio file mới là asset thực sự được tái sử dụng.

## Record của Voice Take

Một legacy Voice Take đã register phải định danh được:

```text
voiceTakeId
source project and original path
audio path and content hash
duration, format, sample rate, channels
transcript hoặc transcript hash nếu có
segment/word alignment nếu có
language và speaker/voice identity
provider/model metadata nếu có
verification status và notes
```

## Quy tắc

1. Import là read-only đối với legacy project.
2. Audio gốc không bao giờ bị ghi đè.
3. Thay đổi hình ảnh có thể dùng lại Voice Take mà không gọi TTS lần nữa.
4. Script đã đổi không được mặc định là khớp với audio file hiện có.
5. Nếu audio, transcript hoặc timestamp mâu thuẫn, phải hiển thị conflict.
6. Voice Take chỉ được dùng qua project khác khi content và quyền sử dụng cho phép.
7. Voice profile tái sử dụng và Voice Take cụ thể là hai concept khác nhau: profile có thể tạo audio mới; take là audio đã trả phí và đã tồn tại.

## Loại trừ rõ ràng

Migration không promote bất kỳ thứ nào sau đây vào thiết kế mới:

- scene plan cũ
- scene source đã sinh cũ
- visual bible hoặc palette cũ
- layout decision cũ
- render candidate cũ
- invalidation rule cũ
- aggregate state của project cũ

Legacy importer là compatibility utility, không phải production pipeline thứ hai.
