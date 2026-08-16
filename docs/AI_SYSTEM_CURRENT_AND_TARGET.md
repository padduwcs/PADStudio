# Hệ thống AI của PAD Studio: hiện trạng và kiến trúc đích

Tài liệu này tách bạch hai thứ:

1. **Hiện trạng (as-is):** chính xác theo mã nguồn đang chạy.
2. **Kiến trúc đích (to-be):** chuẩn cần triển khai để AI linh hoạt, có ngữ cảnh đúng, không lẫn project và không đẩy người dùng vào ngõ cụt khi lỗi.

`project.json` và các artifact bất biến trong thư mục project là nguồn dữ liệu chuẩn. Thread Codex không phải nguồn dữ liệu chuẩn, cũng không được dùng làm trí nhớ dài hạn.

---

## Phần I — Hiện trạng

### 1. Bản đồ tổng thể

```text
Người dùng
  │
  ├─ TopicInput ──────────────┐
  │                           │
  ├─ [Codex] Gợi ý chủ đề     │  (chỉ là gợi ý, chưa là dữ liệu dự án)
  │                           ▼
  ├─ [Codex] Outline ───────► TeachingOutline
  │                              │
  │                              ├─ chỉnh tay / candidate / reviewer Codex
  │                              ▼
  ├─ [Codex] Voice–visual ──► VoiceVisualPlan
  │                              │
  │                              ├─ chỉnh tay / candidate / reviewer Codex
  │                              ▼
  ├─ [Codex] Motion Canvas ─► MotionCanvas workspace
  │                              │
  │                              ├─ validate → repair → compile → reviewer
  │                              ▼
  ├─ [ElevenLabs] Voice ────► WAV + alignment + chunk checkpoints
  │                              ▼
  ├─ [Deterministic] Sync ──► workspace animation đã gắn audio/timing
  ├─ [Deterministic] Layout ► layout bundle/override
  └─ [Deterministic] Render ► MP4 + render report
```

`[Codex]` là tạo hoặc đánh giá nội dung. `[ElevenLabs]` là TTS. Các bước Sync, Layout và Render không gọi AI tạo nội dung.

### 2. Dữ liệu gốc được mang theo giữa các stage

```text
TopicInput
  = topic + learningGoal + videoDirection + audience + duration
  + targetDurationMinutes + background

TopicInput + Outline
  → VoiceVisualPlan

TopicInput + Outline + VoiceVisualPlan
  → Motion Canvas

VoiceVisualPlan
  → ElevenLabs narration

Motion Canvas + Voice bundle
  → Animation sync → Layout → Render
```

Các prompt Codex được tạo lại từ dữ liệu project trong mỗi lượt gọi. Không có prompt nào dựa vào việc model còn nhớ lượt trước.

| Stage Codex | Dữ liệu model đọc | Kết quả model trả | Điều được backend bảo vệ |
|---|---|---|---|
| Gợi ý topic | `TopicInput` đang nhập | goal, direction, angles gợi ý | Gợi ý chưa tự ghi vào project |
| Outline mới | toàn bộ `TopicInput`, duration budget | outline đầy đủ | schema, số section, thời lượng |
| Outline candidate | `TopicInput` + toàn outline nền + scope + góp ý | patch trong scope | section ngoài scope giữ nguyên byte-for-byte |
| Outline reviewer | bản gốc + patch + bản đã ghép đầy đủ | coherence report | không tự sửa nội dung |
| Voice–visual mới | `TopicInput` + outline đầy đủ + narration budget | plan đầy đủ | section/outline IDs, timing contract |
| Voice–visual candidate | `TopicInput` + outline + plan nền đầy đủ + scope | patch beat/field | beat ngoài scope giữ nguyên |
| Voice–visual reviewer | toàn outline + plan đã ghép | coherence report | không tự sửa nội dung |
| Motion scene mới | `TopicInput`, central message, voice/visual direction, flow toàn video, section+beats của scene | source của một scene | package policy, timing, semantic keys, compile |
| Motion candidate | context như trên + source scene nền của scene chọn | source scene thay thế | scene không chọn giữ nguyên byte-for-byte |
| Motion reviewer | outline, voice–visual, scene đã đổi và source scene kề | coherence report | không tự sửa source |

### 3. Luồng tạo mới hiện tại

```text
0. Người dùng nhập TopicInput
   ├─ Có thể gọi Codex lấy gợi ý.
   └─ Chỉ dữ liệu người dùng cuối cùng lưu vào project mới đi tiếp.

1. Generate outline
   ├─ Codex thread tạm, structured JSON.
   ├─ Backend validate rồi lưu outline draft.
   └─ Người dùng chỉnh tay / chốt outline.

2. Generate voice–visual
   ├─ Chỉ cho phép khi outline approved và còn khớp TopicInput.
   ├─ Codex nhận TopicInput + outline toàn bộ.
   ├─ Backend chuẩn hóa timing/narration rồi lưu plan draft.
   └─ Người dùng chỉnh tay / chốt plan.

3. Generate Motion Canvas
   ├─ Chỉ cho phép khi outline + voice–visual approved và khớp nhau.
   ├─ Một Codex thread cho mỗi scene; có thể chạy song song có giới hạn.
   ├─ Workspace validate source, TypeScript và timing contract.
   └─ Lưu generation workspace bất biến rồi cho người dùng chốt.

4. Generate voice
   ├─ Không gọi Codex.
   ├─ ElevenLabs nhận narration đã chốt; có thể chia chunk.
   └─ Backend tạo master WAV và alignment toàn cục.

5. Sync / Layout / Render
   ├─ Không gọi Codex hoặc ElevenLabs mới.
   └─ Là các phép biến đổi/preview/render từ artifact đã lưu.
```

### 4. Luồng tạo lại hoặc sửa hẹp hiện tại

#### 4.1 Outline

```text
Outline hiện hành
  + TopicInput + editScope + guidance
  → Codex editor đọc TOÀN BỘ outline
  → trả patch chỉ cho section/field được phép
  → backend ghép patch vào bản đầy đủ
  → Codex reviewer đọc bản đã ghép đầy đủ
  → candidate {ready | warning | blocked | needs-scope}
  → Apply / Reject / tạo candidate con từ candidate đang pending
```

- AI nhìn thấy phần không sửa để giữ logic tổng thể.
- AI không có quyền thay phần đó; backend mới ghép patch.
- `rootBaseContextHash` ngăn Apply khi topic hoặc outline nền đã đổi.
- Reviewer fail thì candidate được giữ với warning; không mất kết quả editor.

#### 4.2 Voice–visual

```text
Plan hiện hành
  + TopicInput + outline đầy đủ + beat scope + guidance
  → Codex editor
  → patch cho beat/field được chọn
  → backend ghép vào plan đầy đủ
  → Codex reviewer đọc toàn plan
  → candidate / review record trong bộ nhớ UI
  → Apply / Reject / candidate con
```

- AI thấy toàn bộ outline, toàn bộ plan và các beat không được sửa.
- Hiện review có tính tư vấn: candidate mang `coherence_blocked` vẫn có thể Apply. Đây là điểm không nhất quán về tên trạng thái.
- Standalone review chưa được lưu bền vững; reload trang sẽ mất kết quả review đó.

#### 4.3 Motion Canvas

```text
Workspace hiện hành + scene scope + guidance
  → đọc toàn source nền
  → Codex chỉ sinh scene được chọn
  → ghép với source scene không chọn (nguyên byte)
  → prepare workspace / TypeScript validate
       ├─ lỗi: Codex repair tối đa một vòng ở route
       ├─ lỗi: generator có repair/regenerate riêng theo scene
       └─ vẫn không ổn: có thể local-safe-fallback
  → Codex reviewer kiểm tra scene đổi + scene kề
  → candidate
       └─ frontend có thể tự tạo candidate con sửa theo reviewer
  → preview source/workspace → Apply / Reject
```

- Mỗi scene mới chỉ nhận source của chính nó; scene khác được biểu diễn bằng flow toàn video, visual direction và review lân cận.
- Đây giúp giảm context/token nhưng chưa đủ để đảm bảo nhất quán mỹ thuật giữa các scene xa nhau.
- Auto reviewer-repair hiện nằm một phần ở frontend (`sessionStorage`), khác với outline và voice–visual.

### 5. Invalidation: khi dữ liệu cũ còn dùng được?

```text
TopicInput đổi
  → outline và toàn bộ downstream cũ

Outline đổi / restore / candidate apply
  → voice–visual, motion, voice, sync, layout, render cũ

Voice–visual đổi
  → motion, voice, sync, layout, render cũ

Motion đổi
  → visual design, sync, layout, render cũ

Voice đổi
  → sync, layout, render cũ

Sync đổi
  → layout, render cũ

Layout đổi
  → render cũ
```

Các predicate stale và `projectState` thực thi quan hệ này. Artifact lịch sử vẫn ở đĩa nhưng không còn đủ điều kiện chốt/đi tiếp.

### 6. Vòng đời Codex hiện tại

```text
Node backend
  └─ một Codex app-server process dùng chung
       ├─ runCodexStructuredGeneration() #1
       │    └─ thread/start { ephemeral: true } → turn/start → complete
       ├─ runCodexStructuredGeneration() #2
       │    └─ thread/start { ephemeral: true } → turn/start → complete
       └─ ...
```

- App-server process dùng chung credential, RPC và quota; **không phải shared model memory**.
- Mỗi `runCodexStructuredGeneration` tạo fresh ephemeral thread, sandbox read-only, không cho tool call.
- Một candidate có thể sinh nhiều thread độc lập: editor, JSON repair, reviewer; Motion có thêm scene repair/regenerate.
- `GenerationRegistry` chỉ join retry cùng `generationId` trong RAM của backend. Nó không là hàng đợi, không bền qua restart và không giới hạn tổng số turn Codex.

### 7. Các tình huống lỗi hiện tại

| Tình huống | Hành vi hiện tại | Vấn đề còn lại |
|---|---|---|
| Cùng request retry khi process còn sống | join Promise qua `generationId` | reload khác tab/ID mới/server restart có thể gọi lại |
| Model trả JSON sai | một số stage tự repair | chính sách repair rải rác, không có job timeline |
| Reviewer lỗi | thường lưu warning và giữ candidate | người dùng không luôn biết cần làm gì tiếp |
| Upstream đổi khi generation chạy | commit cuối có thể conflict hoặc candidate stale | token/workspace đã tốn, không chủ động cancel |
| Motion compile lỗi | nhiều lớp repair/fallback | logic nằm cả generator, route và frontend |
| Fallback local | tiếp tục được workspace hợp lệ | chất lượng suy giảm chỉ hiện trong chuỗi model |
| Quota/auth/connectivity | trả lỗi provider | thiếu trạng thái công việc để nối lại có kiểm soát |
| Standalone review voice–visual | chỉ ở state UI | reload mất audit/kết quả |
| History rất dài | artifact/version/candidate giữ lại | chưa có retention/archive policy |

### 8. Các điểm hiện tại không linh hoạt về biên tập

- Prompt có nhiều chỉ dẫn cố định về giọng kể, nhịp, visual và format.
- Constraint kỹ thuật và quyết định biên tập đang trộn trong cùng prompt.
- Chế độ sửa hẹp luôn ưu tiên “giữ nguyên phần tốt”; chưa có chế độ reframe cho phép kể lại theo hướng khác.
- Motion chỉ có `visualDirection` chung; chưa có Visual Bible bền vững để định nghĩa phong cách xuyên scene.

---

## Phần II — Kiến trúc đích cần triển khai

### 1. Nguyên tắc kiến trúc

```text
Canonical project data  >  thread memory
Explicit context        >  suy đoán từ lượt trước
Candidate có provenance >  ghi đè trực tiếp
Bounded recovery        >  retry/repair vô hạn
Actionable failure      >  thông báo lỗi chung chung
Editorial freedom       >  template cứng
```

### 2. Mô hình dữ liệu đích

```text
TopicProject
  ├─ Canonical artifacts
  │   ├─ TopicInput
  │   ├─ Outline
  │   ├─ VoiceVisualPlan
  │   ├─ Motion Canvas / voice / sync / layout / render
  │   └─ EditorialDirection + VisualBible
  │
  ├─ Context snapshots (bất biến)
  │   └─ snapshotId + projectRevision + hashes + exact inputs
  │
  ├─ Generation jobs (bền vững)
  │   └─ projectId + stage + generationId + snapshotId
  │
  └─ History
      ├─ versions
      ├─ candidates
      └─ audit/review records
```

`EditorialDirection` trả lời “cách kể nào hợp nội dung này?”; `VisualBible` trả lời “toàn video cần có ngôn ngữ hình ảnh nào?”. Cả hai có thể do AI đề xuất nhưng chỉ thành canonical data khi người dùng chấp nhận/chỉnh sửa.

### 3. Context snapshot đích

```text
buildContext(project, stage, target, mode)
  → ContextSnapshot
      - TopicInput
      - editorial direction / visual bible phù hợp stage
      - artifact upstream đúng revision
      - artifact nền cần bảo vệ
      - selected scope
      - user guidance
      - hard constraints kỹ thuật
      - project revision + content/context hashes
```

Mọi prompt và mọi reviewer dùng cùng snapshot. Nếu snapshot đã stale, job không được commit. Không stage nào tự ghép context bằng logic riêng rải rác.

### 4. Generation job và Codex broker

```text
UI action
  → POST /generation-jobs
  → tạo snapshot + Job(queued)
  → CodexBroker xếp hàng
  → Job(running)
       ├─ step editor / generator      → fresh Codex thread
       ├─ step structural repair?      → fresh Codex thread
       ├─ step compiler repair?        → fresh Codex thread
       └─ step reviewer                → fresh Codex thread
  → validate provenance + snapshot còn hiệu lực
  → Job(awaiting_user | succeeded | recoverable_failure | stale)
```

Broker có ba mức kiểm soát:

1. Một project chỉ có một job ghi vào cùng stage tại một thời điểm.
2. Tổng Codex concurrency có giới hạn cấu hình; Motion được chạy scene song song trong ngân sách đó.
3. Job upstream mới có thể cancel hoặc mark stale các job downstream.

Vẫn chỉ cần một app-server process. Isolation cần thiết là **thread/job context**, không phải tạo OS process cho mỗi project.

### 5. Luồng tạo mới đích

```text
TopicInput + optional AI suggestions
  → người dùng chốt input
  → AI đề xuất/chốt EditorialDirection (optional)
  → Outline job
  → người dùng review/chốt outline
  → Voice–visual job
  → người dùng review/chốt plan
  → AI đề xuất/chốt VisualBible (nếu chưa có)
  → Motion job (scene children)
  → người dùng review/chốt workspace
  → ElevenLabs voice job
  → deterministic sync → layout → render
```

AI suggestion chưa được chấp nhận không được truyền ngầm sang stage sau.

### 6. Luồng sửa hẹp đích

```text
Người dùng chọn scope + guidance + mode=conservative
  → snapshot toàn artifact nền
  → editor đọc toàn cục, chỉ trả patch trong scope
  → backend áp patch quyết định, không tin model tự giữ phần còn lại
  → reviewer đọc bản ghép hoàn chỉnh
  → candidate với diff + provenance + actionable status
  → Apply / Reject / sửa tiếp / mở rộng scope
```

Candidate con lấy candidate cha làm nền, nhưng vẫn giữ root snapshot. Khi root context đổi, cả nhánh candidate bị stale thay vì cố nối vào dữ liệu mới.

### 7. Luồng tạo lại linh hoạt đích

```text
mode=conservative
  → giữ cấu trúc/giọng/định hướng, sửa hẹp.

mode=reframe
  → giữ facts và learning goal đã chốt,
    cho phép đổi narrative strategy, ví dụ, nhịp, cách diễn đạt, visual concept.

mode=regenerate_downstream
  → upstream đã đổi; tạo artifact mới hoàn toàn từ snapshot mới.
```

Constraint được chia thành:

| Loại | Ví dụ | Cách xử lý |
|---|---|---|
| Hard technical | schema, ID, scope, timing, compile, sandbox | validator/backend bắt buộc |
| Hard factual | facts người dùng khóa, terminology, learning goal | snapshot/prompt + reviewer |
| Editorial direction | audience, tone, narrative strategy | người dùng/AI đề xuất, có thể reframe |
| Visual direction | palette, typography, motif, transitions | Visual Bible, áp xuyên Motion |
| Preference | độ ngắn, mức sáng tạo, ví dụ yêu thích | có thể điều chỉnh không làm stale facts |

### 8. Motion Canvas đích

```text
VisualBible + ContextSnapshot
  → scene jobs theo section
  → validate source/timing/policy
       ├─ structural repair, giới hạn rõ
       ├─ compiler repair, giới hạn rõ
       ├─ regenerate scene từ snapshot
       └─ degraded fallback (không được che giấu)
  → compile workspace
  → coherence review toàn chuỗi
  → candidate / artifact
```

- Auto repair là backend step của cùng job, không phải side effect frontend.
- Fallback tạo trạng thái `degraded`; mặc định không cho approve/render.
- Reviewer có Visual Bible và summary scene lân cận; khi cần có thể đọc source lân cận theo policy context budget.

### 9. Trạng thái candidate/review thống nhất

```text
ready                 → Apply được
warning               → Apply được, cần hiểu cảnh báo
requires_scope_expand → không Apply; chọn thêm phần cần sửa
blocked               → không Apply; sửa/reframe/regenerate
degraded              → không tự approve; sửa lại hoặc xác nhận ngoại lệ
stale                 → không Apply; tạo từ snapshot mới
```

Không dùng nhãn `blocked` cho trạng thái thực tế vẫn cho Apply. Standalone review được lưu bền vững, gắn `snapshotId`, target hash và provenance.

### 10. Luồng lỗi và khôi phục đích

```text
Job chạy
  ├─ lỗi input/scope             → blocked: “Sửa input”
  ├─ context đổi                 → stale: “Tạo lại từ bản mới”
  ├─ auth/quota/network          → retryable_failure: “Kết nối lại / thử lại”
  ├─ response schema sai         → bounded structural repair
  ├─ nội dung ngoài scope        → candidate blocked, giữ diff
  ├─ compiler/runtime lỗi        → bounded repair → regenerate → degraded
  ├─ provider unknown acceptance → unknown_provider_state: kiểm tra turn trước retry
  ├─ user cancel                 → cancelled, giữ artifact an toàn
  └─ lỗi cuối                    → failed với trace + next action
```

Mọi failure card phải trả lời bốn câu:

1. Lỗi ở stage/step nào?
2. Dữ liệu nào vẫn an toàn?
3. Có được retry cùng job không?
4. Người dùng nên bấm nút nào tiếp theo?

Ví dụ action: `Nối lại`, `Thử lại cùng job`, `Sửa input`, `Mở rộng scope`, `Tạo candidate mới`, `Sinh lại scene`, `Giữ fallback có chủ đích`, `Quay về version ổn định`, `Hủy`.

### 11. Invalidation và cancellation đích

```text
Upstream commit
  → invalidate artifact downstream
  → mark job downstream stale
  → interrupt Codex turn nếu còn chạy
  → giữ snapshot/trace để giải thích, không commit kết quả cũ
```

Kết quả AI chỉ được commit theo điều kiện nguyên tử:

```text
job.snapshotId còn hợp lệ
AND project revision/hash còn đúng
AND artifact validate thành công
AND job chưa bị cancel
```

### 12. Retention, audit và observability đích

- Giữ vô thời hạn: version đã Apply, checkpoint, restore, render đã xuất.
- Giữ có thời hạn/có pin: candidate reject, candidate stale, workspace tạm, diagnostic lớn.
- Mỗi job có audit trail: snapshot → turn IDs → prompt version → model → usage → validator/reviewer result → user decision.
- UI có “chi tiết kỹ thuật” gấp gọn; người dùng bình thường chỉ thấy lời giải thích và hành động tiếp theo.

### 13. Thứ tự triển khai

```text
1. ContextSnapshot + GenerationJob store/API
2. CodexBroker, per-project lock, job status UI
3. Di chuyển Motion auto-repair từ frontend về backend
4. Chuẩn hóa candidate/review/fallback status
5. Cancellation + stale commit guard
6. EditorialDirection + VisualBible + conservative/reframe
7. Lưu review bền vững, retention/audit/diagnostics
8. E2E tests: retry, reload, restart, conflict, stale, bad AI output, quota,
   compiler failure, fallback và Apply/Restore
```

### 14. Tiêu chí hoàn thành

- Không project/stage/job nào dùng chung Codex conversation context.
- Mọi lần AI gọi đều truy được exact snapshot đã đọc.
- Reload/restart không làm người dùng mất job hoặc vô tình tạo job mới.
- Không có lỗi terminal nào thiếu next action.
- Không artifact degraded nào tự masquerade là output AI hoàn chỉnh.
- Chỉnh hẹp giữ dữ liệu ngoài scope bằng backend merge, không bằng lời hứa của prompt.
- Reframe đủ tự do về biên tập nhưng không phá facts, scope, timing và provenance.
