# Bắt đầu từ đây

## Đây là tài liệu gì

Đây là bản thiết kế để xây dựng PADStudio. Đây là ngữ cảnh đầu tiên mà chủ dự án, developer hoặc coding Agent phải đọc trước khi thay đổi hệ thống.

Nó trả lời các câu hỏi:

- PADStudio được xây dựng để làm gì?
- Trách nhiệm nào thuộc về Agent và trách nhiệm nào thuộc về PAD?
- Hệ thống tiếp nhận các kiểu input khác nhau như thế nào?
- Tool, provider, renderer và skill được mở rộng ra sao?
- Công việc, artifact, quyết định và bằng chứng chất lượng được tổ chức thế nào?
- Một người hoặc Agent mới nhận và hoàn thành task ra sao?

Đây không phải hướng dẫn sử dụng PADStudio để làm một video cụ thể. Phần đó sẽ là một bộ tài liệu runtime riêng.

## Mức độ của bản thiết kế

Đây là bản đồ tư duy và hướng đi chung của dự án, không phải danh sách mọi thứ phải xây ngay. Luồng, ranh giới và nguyên tắc là phần cần giữ; tên concept, schema, API, trạng thái, công nghệ và cách tổ chức code sẽ được hình thành dần từ các lát cắt triển khai thực tế.

## Mô hình trong một câu

PADStudio là workspace sản xuất video theo hướng Agent-native: Agent quyết định và điều phối production, còn PAD cung cấp các capability có thể khám phá, artifact bền vững, khả năng thực thi, bằng chứng và bề mặt rõ ràng để con người giám sát.

## Hình dung nhanh về hệ thống

```text
Intent và tài liệu người dùng cung cấp
                │
                ▼
      Kiểm kê và probe input
                │
                ▼
       Agent session / control plane
                │
        MCP, CLI, API, workspace
                ▼
     Production task graph động
                │
   ┌────────────┼────────────┐
   ▼            ▼            ▼
 lập kế hoạch  media      composition
 và review     tool       và rendering
   └────────────┼────────────┘
                ▼
     artifact, candidate, evidence
                │
                ▼
        video cuối và history
                │
                ▼
          Board / giám sát
```

Agent chọn task graph. Graph có thể gồm research, viết script, TTS, alignment, tạo asset, phân tích footage, animation, editing hoặc publishing tùy nhu cầu. Không một luồng page cũ nào là bản sắc của hệ thống.

## Bốn lớp cần ghi nhớ

```text
1. Intent       Người dùng muốn gì và đang có những tài liệu nào
2. Intelligence Agent suy luận, lập kế hoạch, lựa chọn, review và ủy quyền
3. Capability   Tool, provider, renderer, skill và playbook
4. Evidence     Workspace, artifact, event, checkpoint, test và output
```

Agent sở hữu các quyết định sáng tạo/điều khiển. PAD sở hữu nền tảng đáng tin cậy để biến các quyết định đó thành hành động có thể thực thi và kiểm tra. PAD không phải một creative orchestrator thứ hai.

## Nguyên tắc xây dựng không được thỏa hiệp

- Agent-first: Agent tương thích có thể điều khiển production mà không bị thay thế bởi workflow hard-code trong ứng dụng.
- Input-flexible: text, script, audio, timestamp, footage, reference, asset hoặc mọi tổ hợp đều có thể là điểm bắt đầu hợp lệ.
- Capability-neutral: Agent, provider, model, tool và renderer có thể thay thế thông qua contract.
- Artifact-first: output bền vững có tên, hash, liên kết và được bảo toàn; hội thoại không phải nguồn sự thật.
- Human-controlled: chủ dự án kiểm soát phạm vi, quyền hạn, hành động tính phí, quyết định lớn và chính sách chấp nhận.
- Evidence-driven: file render thành công chưa đủ để kết luận một kết quả đã hoàn thành.
- Extensible: capability còn thiếu có thể được bổ sung bằng tool, skill, playbook hoặc adapter extension rõ ràng.
- History-preserving: candidate mới thay thế candidate cũ theo lịch sử; không xóa kết quả cũ.
- Legacy-light: project PADStudio dang dở chỉ đóng góp voice asset; thiết kế scene lỗi không được giới hạn hệ thống mới.

## Người mới hoặc coding Agent cần đọc tài liệu này thế nào

1. Đọc file này và [`01-CHARTER.md`](01-CHARTER.md).
2. Đọc [`02-ARCHITECTURE.md`](02-ARCHITECTURE.md) để hiểu boundary.
3. Đọc task packet trước khi chạm vào code.
4. Đi theo các liên kết tới phần domain, contract, workspace hoặc quality liên quan.
5. Trước khi triển khai, nêu lại cách hiểu, phạm vi, giả định và kế hoạch kiểm tra.
6. Sau khi triển khai, báo cáo file đã đổi, quyết định, kiểm tra và vấn đề còn bỏ ngỏ.

Nếu task mâu thuẫn với bản thiết kế này, phải dừng ở điểm mâu thuẫn và yêu cầu quyết định kiến trúc. Không được âm thầm đưa vào một mô hình thứ hai để né bất đồng thiết kế.

## Mô hình nguồn sự thật

Tài liệu build được giữ ổn định có chủ ý. Nó mô tả invariant và extension point có thể thay thế, không mô tả tên provider hiện tại, số lượng project hiện tại, bug tạm thời hay một phase triển khai cụ thể.

ADR đã chấp nhận là cách chính thức để tiến hóa thiết kế. Code hiện tại là bằng chứng về thứ đang tồn tại, không phải quyền quyết định hệ thống được dự định sẽ là gì.
