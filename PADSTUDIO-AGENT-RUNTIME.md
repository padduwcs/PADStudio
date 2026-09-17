# PADStudio — bootstrap ngắn cho Agent vận hành

Đây là tài liệu mặc định khi **dùng PADStudio để làm video**. Không đọc tài liệu build, test, report hay project khác để bắt đầu một project.

Chat và quyết định sáng tạo nằm ở Agent host bên ngoài. Web PADStudio chỉ quan sát. Mọi thay đổi đi qua CLI/tool contract và được lưu vào đúng project.

## Bắt đầu an toàn

Luôn làm việc với một project ID tường minh.

```powershell
# Project mới
npm run project:create -- <project-id> "<tiêu đề>"
npm run project:resume -- <project-id>

# Project đã có
npm run project:resume -- <project-id>
```

`project:resume` là context mặc định. Nó chỉ trả checkpoint, việc hiện hành, artifact active cần tiếp tục, sequence/render mới nhất, feedback, health, budget và trạng thái phân tích cô đọng. Không dùng full context theo thói quen.
Nếu `checkpointFreshness.authority` là `advisory`, `checkpoint.pending` và `checkpoint.next` chỉ là lịch sử;
không chạy lại chúng trước khi đối chiếu trạng thái bền vững hiện tại trong `work`, `production`, `animation`,
decision và review. Sau khi người dùng nói đã tự chạy một lệnh approval/acceptance, luôn đọc lại
`project:resume` rồi mới tiếp tục; không yêu cầu lại cùng exact Result chỉ vì cuộc chat hoặc checkpoint chưa cập nhật.

Chỉ khi resume thiếu dữ kiện cho việc cụ thể:

```powershell
npm run project:context -- <project-id> --view summary
npm run analysis:read -- <project-id> '<query-json>'
```

Full `project:context` là công cụ chẩn đoán cuối cùng, không phải bootstrap.

Project đã hoàn thành chỉ được đưa khỏi danh sách active khi người dùng yêu cầu, PADStudio/Agent khác đã dừng và không còn Run đang chạy:

```powershell
npm run project:archive -- archive <project-id> "<lý do>" --confirm-stopped
npm run project:archive -- list
npm run project:archive -- restore <project-id> --confirm-stopped
```

Archive di chuyển nguyên project và ghi manifest; không xóa lịch sử. Không archive project đang được một Agent khác sử dụng.
Run local bị ngắt chỉ được đánh dấu thất bại bằng
`npm run project:run:abandon -- <project-id> <run-id> "<lý do>" --confirm-stopped`
sau khi người vận hành đã xác nhận process thực sự dừng. Nếu Run đã có output bền vững hoặc
authorization thì phải dùng recovery, không abandon.

## Ranh giới file và trạng thái final

- Mọi input, asset tạo ngoài, render và output có giá trị tiếp tục phải được import hoặc tạo qua contract để trở thành Resource/Result/Artifact/Delivery của đúng project. Không dùng raw path hay file rời làm nguồn sự thật.
- Không tự sao chép preview/render vào root repo, Desktop hoặc thư mục tùy ý để thay cho delivery. `preview.mp4` và mọi `video.sequence-render` vẫn là preview, kể cả khi được đổi tên thành `final.mp4`.
- `final` là trạng thái có bằng chứng, không phải tên file. Chỉ mô tả video là final/đã bàn giao khi exact render đã được người dùng chấp nhận, QA của chính render đó đạt và `video.export-delivery` đã tạo một Delivery Result.
- Không suy diễn approval từ việc người dùng yêu cầu xem thử, không phản hồi hoặc chỉ nhận xét một phần. Không tự ghi Decision/attestation nếu người dùng chưa thực sự quyết định hoặc xem/nghe đủ.
- Nếu thiếu approval, QA, review, provenance hoặc finalization, báo rõ đây là preview hay đang bị chặn và thực hiện đúng bước còn thiếu; không bypass bằng FFmpeg, lệnh copy hoặc công cụ ngoài Executor.
- Chỉ tạo bản sao ngoài project sau khi đã có official Delivery và người dùng yêu cầu rõ vị trí. Bản sao đó chỉ để tiện sử dụng; Delivery Result cùng checksum trong project vẫn là bản chuẩn, và checkpoint phải ghi Delivery Result cùng vị trí bản sao.
- Trước khi báo hoàn tất, đọc lại `project:resume`: không được còn pending feedback/finalization liên quan, `health.counts.deliveries` phải có delivery vừa tạo, và câu trả lời phải nêu exact Delivery Result thay vì chỉ đưa raw path.

## Đọc theo nhu cầu

- Đọc đúng các skill trong `work.relevantSkillIds` bằng `npm run skill:read -- <skill-id> <project-id>`.
- Khi chọn tool, lọc capability cụ thể bằng `npm run tool:list -- --capability <capability>`; chỉ dùng `--view full` khi cần schema.
- Transcript, scene, frame và audio phải được đọc theo `resultId`/`sourceKey`, range, cursor và limit; không nạp toàn bộ JSONL.
- Không đọc `docs/build/`, `reports/`, `test/`, project khác hoặc lịch sử Git trong một phiên vận hành bình thường.

## Thực thi và lưu dấu vết

- Import file/folder bằng `project:import`; URL/asset web đã chọn dùng tool phù hợp để giữ nguồn và quyền sử dụng.
- Media do Agent/provider ngoài tạo phải được đăng ký bằng capability phù hợp trước khi đưa vào sequence; không dựng trực tiếp từ file sinh ra chưa được quản lý.
- Request chạy phải nêu exact `capability`, `tool`, `purpose` và inputs. Không fallback ngầm.
- Tool trả phí cần budget và authorization chính xác trước khi gọi provider.
- Ý tưởng, brief, direction, sequence và workflow quan trọng phải được lưu thành artifact/workflow; không chỉ nằm trong chat.
- Kết quả, lỗi, quyết định và feedback phải gắn đúng Resource/Result/Artifact revision.
- Sau thay đổi quan trọng, cập nhật checkpoint ngắn với goal, constraints, selectedResources, pending và next.

## Dựng, review và delivery

Khi project cần hoạt họa bằng code, đọc skill `code-animation`. Tạo/revise source bằng
`animation.source`, chạy `animation.validate`, rồi lưu `animation.composition` bằng
`project:animation`. Render chỉ được chạy sau khi người dùng tự chạy lệnh tương tác
`npm run project:approve-code -- <project-id> <source-result-id>` và chấp thuận việc thực thi
đúng source Result. Agent phải kết thúc lượt tại gate này; không chạy lệnh, gõ câu xác nhận,
pipe stdin hoặc soạn JSON approval thay người dùng. Static validation
không phải sandbox; host hiện không cưỡng chế cách ly mạng. Không tự cài runtime, không gọi `npx`
để tải package và không đổi Manim/Remotion/HyperFrames ngầm. `animation.render` là Result video
có thể dùng trực tiếp làm source của `video.sequence`.

Chỉ xin approval sau khi source/props/asset/composition đã ổn định và static validation pass; không
dùng approval để debug compile. Lặp lại lệnh với đúng source đã duyệt sẽ trả lại Decision cũ mà
không hỏi lại. Nếu byte source đổi, phải nói rõ đây là trust target mới nên cần approval mới.
Sau một approval hợp lệ, `animation.preflight`, `hyperframes-preview`,
`hyperframes-motion-preview` và `animation.render` của đúng source/composition revision phải dùng lại
Decision đó; không dừng để xin lại giữa các bước. Motion preview chỉ dùng có chọn lọc cho selector/đoạn
khó đánh giá, không phải gate bắt buộc cho mọi composition.

Nếu một lỗi contract/runtime của PADStudio chặn công việc, không sửa `src/`, `test/` hay tài liệu build ngay
trong phiên vận hành video. Ghi lại exact Run/Result và lỗi, báo rõ đây là lỗi hệ thống, rồi chỉ chuyển sang
phát triển codebase khi phạm vi đó đã được xác nhận.

1. Tạo hoặc cập nhật `video.sequence` với revision và `changeReason`.
2. Render exact artifact bằng `video.render-sequence`; chỉ reuse Result khi contract/hash khớp.
3. Chạy `video.inspect-output` trên exact render. Với video có lời, truyền `expectedSpeech.text`
   và các `expectedSpeech.terms` quan trọng khi sequence không lưu narration text; QA sẽ đối chiếu
   ASR và lấy frame phủ đều toàn timeline.
4. Agent review đúng Result; người dùng xem trong observer và phản hồi trong chat.
5. Sau QA hợp lệ, Agent dừng và yêu cầu người dùng tự chạy
   `npm run project:accept -- <project-id> <render-result-id>` trong terminal tương tác. Lệnh hiển thị
   exact Result, revision, thời lượng, checksum và yêu cầu người dùng xác nhận đã xem/nghe trọn vẹn.
   Agent không được chạy lệnh, gõ câu xác nhận hoặc tạo attestation/acceptance bằng JSON.
6. `video.export-delivery` chỉ dùng exact Result có confirmed human review, confirmed acceptance và QA hợp lệ.

`project:decide` vẫn dùng cho feedback, rejection và quyết định không thuộc hai gate tin cậy trên.
`project:attest` dạng JSON đã ngừng nhận human attestation. Một yêu cầu kiểu “cứ làm đi” ở trước đó
không tự động phê duyệt source/render xuất hiện về sau; mỗi gate gắn với đúng immutable Result.

Render verification chỉ chứng minh file dựng được tạo đúng contract; nó không thay thế exact-output QA, review của Agent hay việc người dùng xem/nghe. Khi lời thoại, subtitle hoặc hình ảnh được sửa, tạo revision/render mới rồi lặp lại QA và approval trên đúng Result mới.

Nguồn thiếu, evidence stale, QA fail hoặc finalization dang dở phải được báo rõ; không tự bỏ qua. Dùng lệnh recovery hiện có để hoàn tất output đã bảo toàn mà không chạy lại provider.

## Khi cần chi tiết

Tra cứu [`PADSTUDIO-AGENT-REFERENCE.md`](PADSTUDIO-AGENT-REFERENCE.md) theo đúng mục đang làm. Không đọc toàn bộ reference nếu chỉ cần một lệnh hay contract. Trạng thái thực của project luôn đến từ `project:resume`, không đến từ tài liệu hoặc ký ức cuộc chat.
