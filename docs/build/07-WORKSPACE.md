# Repository và Workspace

## Tách biệt trách nhiệm

PADStudio có hai loại file không được nhầm lẫn:

```text
Repository     source code, build contract, test, skill, tool adapter
Workspace      project người dùng, media, artifact, run, preview, render
```

Build documentation thuộc `docs/build/`. Hướng dẫn runtime cho production Agent thuộc khu vực tài liệu runtime riêng. User data không thuộc source repository.

Cấu trúc bên dưới là bản đồ boundary và một đề xuất tổ chức, không phải layout cuối cùng bắt buộc. Khi bắt đầu triển khai, chỉ tạo những thư mục và dữ liệu cần cho lát cắt hiện tại; điều quan trọng là không trộn source code, user data, artifact và file tạm một cách thiếu kiểm soát.

## Cấu trúc repository khuyến nghị

Đây là bản đồ boundary logic. Ngôn ngữ implementation có thể là TypeScript, Python, ngôn ngữ khác hoặc kết hợp nhiều ngôn ngữ, miễn là boundary vẫn rõ ràng.

```text
PADStudio/
├── AGENTS.md                    # điểm vào cho coding Agent
├── README.md                    # định hướng ngắn về project
├── docs/
│   ├── build/                   # build blueprint này
│   └── runtime/                 # sau này: hướng dẫn cho production Agent
├── apps/
│   └── studio/                  # ứng dụng cho user và Board
├── packages/
│   ├── domain/                  # domain concept và invariant
│   ├── contracts/               # schema và protocol type
│   ├── agent-surface/           # Agent session và tool/resource interface
│   ├── artifact-store/          # identity, lineage và persistence của artifact
│   ├── run-store/               # run, checkpoint, event, decision
│   ├── capability-registry/     # khám phá capability và hỗ trợ lựa chọn
│   ├── review/                  # evidence và quality evaluation
│   └── board/                   # state projection và human surface
├── tools/
│   ├── analysis/
│   ├── audio/
│   ├── graphics/
│   ├── video/
│   ├── composition/
│   └── providers/
├── pipelines/                  # định nghĩa workflow/playbook dễ đọc
├── skills/                     # knowledge pack build/runtime phù hợp
├── schemas/                    # contract có thể machine-validate
├── tests/
│   ├── contracts/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/
│   ├── quality/
│   └── evaluation/
└── scripts/                   # maintenance repository và developer tool
```

Các folder source cụ thể có thể thay đổi qua ADR. Hướng phụ thuộc không được bị che giấu bởi một folder tiện tay nhưng rối.

## Runtime workspace khuyến nghị

```text
PAD workspace/
├── library/
│   ├── voices/
│   ├── styles/
│   ├── assets/
│   └── references/
├── projects/
│   └── <project-id>/
│       ├── project.json        # chỉ identity và reference được chọn
│       ├── inputs/             # file gốc user cung cấp
│       ├── artifacts/          # artifact có cấu trúc, bất biến
│       ├── assets/             # media local của project và provenance
│       ├── compositions/       # workspace renderer theo candidate
│       ├── previews/           # still, contact sheet, short sample
│       ├── renders/            # output candidate và output published
│       ├── runs/               # run state, checkpoint, event, decision
│       └── history/            # reference bị thay thế và audit material
├── cache/                      # có thể bỏ và tạo lại
└── tmp/                        # workspace execution tạm
```

## Policy của project index

`project.json` là index, không phải một aggregate database thứ hai. Nó chứa identity, reference artifact được chọn, active run, policy và workspace metadata. Artifact chi tiết, media, history và evidence nằm trong directory riêng.

## Quy tắc workspace

1. Input gốc của người dùng được bảo toàn và không bao giờ ghi đè.
2. Artifact được tạo ghi vào vị trí run/candidate trước khi promote.
3. Artifact ưu tiên project-relative path; path bên ngoài phải có external-resource record rõ ràng.
4. Mỗi media file có asset identity ổn định và content hash.
5. File render/build tạm được tách khỏi output đã promote.
6. Có thể xóa cache mà không làm hỏng project.
7. Secret không bao giờ nằm trong source, prompt, artifact content hoặc event log.
8. History là append-only xét từ góc nhìn decision của production.
9. Board đọc workspace qua application projection; Board không được trở thành nơi duy nhất chứa state.

## Naming và identity

Tên phải ổn định, dễ đọc và an toàn trên nhiều platform. ID không được chỉ phụ thuộc filename hoặc timestamp. Đổi tên file không được làm đổi identity của artifact hoặc asset.

## Ranh giới của build documentation

`docs/build/` mô tả repository và system contract. Nó không được biến thành nơi đổ dữ liệu project đã sinh, log run hiện tại, menu provider hoặc ghi chú troubleshoot tạm thời.
