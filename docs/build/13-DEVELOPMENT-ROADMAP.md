# 13 — Lộ trình phát triển PADStudio

## Vai trò của tài liệu này

Đây là lộ trình định hướng ban đầu để biết nên tìm hiểu, xây dựng và hoàn thiện PADStudio theo thứ tự tư duy nào. Nó không phải kế hoạch thời gian, không phải pipeline cố định và không khóa công nghệ.

Lộ trình này mô tả con đường từ một ý tưởng kiến trúc đến một hệ thống tạo video hoàn chỉnh. Mỗi giai đoạn có thể được chia thành nhiều task nhỏ; chỉ chốt chi tiết khi nhu cầu thực tế xuất hiện trong quá trình làm.

## Bức tranh tổng quát

```text
Định hướng và cách làm việc
            ↓
Nền tảng project, context và artifact
            ↓
Luồng Agent điều phối thích nghi
            ↓
Capability, tool, provider và runtime
            ↓
Năng lực sản xuất video
            ↓
Preview, review, sửa chữa và hội tụ
            ↓
Ổn định, phục hồi, mở rộng và vận hành
```

Voice, audio, timestamps, asset và các loại input khác là những khả năng đầu vào của hệ thống. Voice cũ chỉ là một nhánh tương thích; luồng project mới từ nội dung/ý tưởng vẫn là hướng chính.

## Nguyên tắc phát triển

- Xây theo từng lát cắt có thể quan sát, kiểm tra và trình diễn được.
- Mỗi giai đoạn phải giúp ta học thêm về hệ thống, không chỉ tạo thêm code.
- Agent đề xuất, điều phối và thực hiện; người phụ trách giữ quyền quyết định các thay đổi quan trọng.
- Chỉ mô hình hóa và đặc tả phần cần thiết cho bước hiện tại.
- Mô hình domain, contract, schema, trạng thái và cấu trúc thư mục trong các tài liệu khác là ngôn ngữ chung hoặc đề xuất ban đầu, chưa mặc nhiên là luật triển khai.
- Khi một quyết định trở thành nền tảng lâu dài, ghi lại bằng ADR. Khi chỉ là lựa chọn tạm thời, ghi rõ tính tạm thời.
- Sau mỗi giai đoạn, cập nhật bản thiết kế bằng điều đã được kiểm chứng; không biến mọi thử nghiệm thành nguyên tắc bắt buộc.

## Các giai đoạn phát triển

### Giai đoạn 0 — Nắm tư duy và thiết lập cách kiểm soát

Đọc các tài liệu định hướng, thống nhất PADStudio là hệ thống Agent-native, hiểu ranh giới giữa Agent, PADStudio, tool và provider, đồng thời thống nhất cách giao việc và kiểm tra.

Kết quả cần có:

- hiểu được luồng hoạt động chung;
- biết quyết định nào thuộc người phụ trách và quyết định nào Agent có thể tự xử lý;
- có quy tắc task, review, bàn giao và ghi nhận quyết định;
- xác định task đầu tiên có phạm vi nhỏ.

Đây là giai đoạn hiện tại, không cần viết nhiều mã nguồn.

### Giai đoạn 1 — Nền tảng workspace và project

Xây phần tối thiểu để một project có thể tồn tại, mở lại và giữ được ngữ cảnh:

- project identity và metadata cơ bản;
- nơi lưu input, output, artifact, preview và lịch sử;
- project context mà Agent có thể đọc lại;
- cách phân biệt dữ liệu nguồn, kết quả sinh ra và dữ liệu tạm;
- log hoặc dấu vết đủ để biết một kết quả được tạo ra như thế nào.

Kết quả cần có: tạo một project, đóng/mở lại, xem được những gì đã có và không làm mất ngữ cảnh.

Chưa cần chốt toàn bộ schema hoặc xây workspace hoàn chỉnh ngay từ đầu; chỉ cần cấu trúc đủ phục vụ lát cắt đầu tiên.

### Giai đoạn 2 — Lát cắt dọc tham chiếu

Xây một luồng nhỏ đi xuyên qua nhiều lớp của hệ thống, ví dụ:

```text
ý tưởng hoặc nội dung đơn giản
        ↓
Agent hiểu yêu cầu và đề xuất kế hoạch
        ↓
PADStudio thực hiện một số năng lực cơ bản
        ↓
tạo artifact và preview tối thiểu
        ↓
người dùng xem, phản hồi và tiếp tục
```

Mục tiêu không phải tạo ra video cuối cùng ngay, mà kiểm chứng rằng Agent, project context, tool, artifact, preview và phản hồi có thể phối hợp thành một vòng làm việc thật.

Kết quả cần có: một project mẫu có thể chạy từ đầu đến cuối ở mức đơn giản và có thể tiếp tục sau khi mở lại.

### Giai đoạn 3 — Tiếp nhận và hiểu đầu vào linh hoạt

Mở rộng cách bắt đầu project, không ép mọi người dùng cùng một mẫu:

- chỉ có ý tưởng hoặc chủ đề;
- có nội dung hoặc script;
- có lời thoại, voice hoặc audio;
- có timestamps hoặc thông tin căn chỉnh;
- có asset, footage, reference;
- có nhiều loại đầu vào kết hợp;
- có một phần dữ liệu từ project cũ.

Agent cần kiểm kê những gì đã có, hiểu chất lượng và mức độ tin cậy của chúng, nhận ra phần còn thiếu rồi đề xuất bước tiếp theo.

Kết quả cần có: cùng một hệ thống có thể bắt đầu từ nhiều loại input mà không biến mỗi loại thành một sản phẩm riêng biệt.

Nhánh import voice cũ có thể được xây ở đây ở mức tối thiểu, nhưng chỉ giữ audio/voice cần thiết và không mang scene cũ sang.

### Giai đoạn 4 — Agent control plane và quy trình thích nghi

Xây cơ chế để Agent thật sự điều phối project thay vì chỉ gọi một pipeline cố định:

- phiên làm việc và context liên tục;
- hiểu yêu cầu, giả định và mục tiêu hiện tại;
- đề xuất direction và kế hoạch;
- chia việc thành các bước cần thiết;
- bỏ qua, gộp, tách hoặc sắp xếp lại bước;
- chọn khi nào cần tool, khi nào cần người dùng;
- tạm dừng tại quyết định quan trọng và tiếp tục từ trạng thái đã lưu;
- giao việc cho Agent khác khi phù hợp và vẫn giữ được trách nhiệm, phạm vi và kết quả.

Kết quả cần có: Agent đưa project tiến lên theo lý do có thể giải thích, không chạy một chuỗi thao tác mù quáng hoặc làm lệch hướng sau mỗi lần hội thoại mới.

Task graph, checkpoint và agent adapter chỉ được cụ thể hóa theo nhu cầu chứng minh từ các luồng thực tế.

### Giai đoạn 5 — Capability, tool, provider và runtime

Tạo nền tảng để Agent có nhiều khả năng nhưng không bị khóa vào một công nghệ:

- mô tả capability mà hệ thống có thể thực hiện;
- gọi tool và nhận kết quả có thể kiểm tra;
- phát hiện/chọn provider hoặc runtime phù hợp;
- thay thế provider khi cần;
- biết giới hạn, chi phí, thời gian và tác động của một thao tác;
- hỗ trợ skill/playbook để hướng dẫn Agent dùng capability đúng cách;
- lưu provenance, tức nguồn gốc và cách tạo ra kết quả.

Kết quả cần có: bổ sung hoặc thay một tool/provider mà không phải viết lại toàn bộ tư duy sản xuất video.

Ban đầu có thể dùng một provider và một runtime thực dụng. Trừu tượng hóa sâu hơn chỉ làm khi có ít nhất một nhu cầu thay thế hoặc mở rộng được chứng minh.

### Giai đoạn 6 — Năng lực sản xuất video

Từng bước xây các năng lực tạo video thực tế, có thể chia thành nhiều lát cắt:

- hiểu cấu trúc nội dung và mục tiêu truyền đạt;
- phân tích lời thoại, nhịp và timestamps nếu có;
- đề xuất direction và visual grammar;
- lập beat map hoặc kế hoạch scene khi cần;
- tìm, tạo, kiểm tra và quản lý asset;
- chọn cách composition phù hợp;
- dựng, preview và render;
- giữ liên kết giữa nội dung, scene, asset, audio và video đầu ra.

Kết quả cần có: từ các dạng input hợp lệ, hệ thống có thể tạo ra preview/video có ý nghĩa để đánh giá, không chỉ sinh ra các file rời rạc.

Các khái niệm như scene plan, asset manifest hay edit plan nên được hình thành từ nhu cầu của từng năng lực, không triển khai toàn bộ chỉ vì chúng đã xuất hiện trong tài liệu.

### Giai đoạn 7 — Review, sửa chữa và hội tụ chất lượng

Xây vòng lặp giúp video tốt dần lên sau nhiều lần chỉnh sửa:

```text
tạo candidate
    ↓
preview/render
    ↓
review bằng bằng chứng cụ thể
    ↓
phân loại vấn đề và xác định phần bị ảnh hưởng
    ↓
sửa đúng phần lỗi
    ↓
review lại và chọn candidate tốt hơn
```

Hệ thống cần dần đạt được:

- review kỹ thuật, nội dung, hình ảnh, âm thanh và biên tập;
- phân biệt lỗi nghiêm trọng với đề xuất cải thiện;
- sửa cục bộ khi có thể, tránh phá hỏng phần đang tốt;
- so sánh candidate và giữ lịch sử;
- biết khi nào đạt yêu cầu hoặc cần người dùng quyết định;
- giải thích vì sao một bản được chọn.

Kết quả cần có: nhiều vòng chỉnh sửa làm video hội tụ về một bản tốt hơn, thay vì mỗi lần chạy lại tạo ra một hướng hoàn toàn khác.

### Giai đoạn 8 — Tính liên tục, phục hồi và độ tin cậy

Khi luồng sản xuất đã hữu ích, củng cố để có thể dùng lâu dài:

- resume sau khi gián đoạn;
- retry thao tác thất bại mà không nhân đôi kết quả;
- checkpoint và lịch sử đủ rõ;
- cache hợp lý;
- versioning cho artifact và cấu hình;
- provenance và khả năng tái hiện kết quả;
- kiểm thử các lớp quan trọng;
- xử lý lỗi, timeout và tác vụ bên ngoài;
- kiểm soát chi phí, tài nguyên và quyền gọi tool;
- bảo vệ dữ liệu và tránh mất dữ liệu người dùng.

Kết quả cần có: project lớn hoặc kéo dài nhiều phiên vẫn có thể tiếp tục an toàn và giải thích được trạng thái hiện tại.

Đây là giai đoạn biến một prototype hữu ích thành nền tảng đáng tin cậy, không nên cố hoàn tất trước khi đã có luồng thực tế để quan sát vấn đề.

### Giai đoạn 9 — Các bề mặt sử dụng và hệ sinh thái Agent

Sau khi lõi đã ổn định, mở rộng cách con người và Agent kết nối:

- phiên hội thoại tích hợp;
- CLI hoặc workspace workflow;
- MCP;
- HTTP/API;
- nhiều loại Agent/provider;
- Agent-to-Agent (A2A) khi có nhu cầu cộng tác;
- capability, tool, skill và playbook mở rộng;
- nhiều renderer hoặc runtime.

Kết quả cần có: người dùng có thể chọn cách làm việc phù hợp mà không thay đổi lõi project và production model.

Khả năng “dùng bất kỳ Agent nào” là mục tiêu mở rộng quan trọng, nhưng nên xây trên các ranh giới đã được kiểm chứng qua các giai đoạn trước.

### Giai đoạn 10 — Tương thích, hoàn thiện sản phẩm và vận hành

Hoàn thiện những phần cần cho việc sử dụng lâu dài:

- import voice/audio từ các project PADStudio cũ;
- kiểm tra, deduplicate và ghi nhận nguồn gốc dữ liệu nhập;
- tài liệu sử dụng riêng cho người dùng;
- cài đặt, nâng cấp và backup;
- quản lý project và thư viện asset;
- theo dõi hoạt động, chi phí và lỗi;
- quy trình hỗ trợ và xử lý sự cố;
- đánh giá định kỳ chất lượng đầu ra.

Kết quả cần có: PADStudio có thể được sử dụng như một sản phẩm, trong khi dữ liệu voice cũ vẫn được tận dụng mà không kéo theo kiến trúc scene cũ.

## Các đường đi song song

Một số việc nên diễn ra xuyên suốt, không chờ đến cuối:

- tài liệu build và context cho Agent;
- kiểm thử phù hợp với phần đang xây;
- quan sát artifact, log và kết quả;
- review của người phụ trách;
- ghi nhận quyết định kiến trúc đã thực sự được chọn;
- bảo vệ dữ liệu, chi phí và quyền hạn.

Tuy nhiên, mức độ của chúng phải tăng dần theo độ trưởng thành của hệ thống. Không cần xây đầy đủ cơ chế vận hành enterprise khi sản phẩm còn chưa chứng minh được vòng tạo preview cơ bản.

## Cách làm việc trong từng giai đoạn

```text
đọc mục tiêu và bối cảnh
        ↓
chọn lát cắt nhỏ nhất có giá trị
        ↓
Agent nêu giả định, kế hoạch và giới hạn
        ↓
triển khai và tạo kết quả quan sát được
        ↓
kiểm tra, review và ghi nhận bài học
        ↓
chốt điều gì đã ổn định, điều gì còn thử nghiệm
        ↓
chọn task tiếp theo hoặc điều chỉnh hướng
```

Mỗi task không cần giải quyết cả giai đoạn. Nó chỉ cần đóng góp một phần có thể kiểm chứng vào mục tiêu của giai đoạn.

## Điều kiện để coi một giai đoạn đã đủ trưởng thành

Không chuyển giai đoạn chỉ vì đã viết xong code. Nên chuyển khi:

- kết quả hiện tại có thể trình diễn hoặc kiểm tra;
- người phụ trách hiểu nó đang làm gì và giới hạn ở đâu;
- Agent mới có thể đọc context và tiếp tục công việc;
- vấn đề còn lại được ghi nhận rõ;
- các quyết định quan trọng đã được phân biệt giữa tạm thời và lâu dài;
- bước tiếp theo có lý do cụ thể.

## Hình dung đích đến

PADStudio hoàn thiện là một workspace nơi người dùng có thể đưa vào bất kỳ mức độ chuẩn bị nào — từ một ý tưởng đến script, voice, audio, timestamps và asset đầy đủ — rồi để Agent hiểu tình hình, chọn cách làm, điều phối capability, tạo video, xem bằng chứng, sửa từng phần và hội tụ dần đến kết quả cuối.

Lộ trình này là đường ray để giữ hướng đi và quyền kiểm soát. Nó không thay thế việc tìm hiểu, thử nghiệm có chủ đích và quyết định kiến trúc được rút ra từ thực tế.
