# Chốt gói A theo nhu cầu sử dụng thực tế

Đã kiểm tra lại hội thoại và kết quả sau gián đoạn quota: ba baseline ASR và scene đều hoàn thành 25/25 video; 19 test harness, 81 test repository và smoke đã qua. Không dừng ở một lần chạy dở. Phần chưa đóng trước đây là gate dataset/nhãn, không phải thiếu bộ công cụ.

Theo chỉ đạo mới của owner, **đóng gói A ở mức chuẩn bị kỹ thuật và chọn cấu hình dùng trên máy hiện tại**. Không yêu cầu owner tạo dataset khác trước khi tiếp tục. Điều chỉnh được ghi tại §18 đặc tả. Phạm vi này không đồng nghĩa đã làm xong các adapter/UI/job gói B–F.

## Chọn cấu hình

Dùng **large-v3 / GPU FP16**: đã xử lý gần 101 phút media trong 6 phút 45 giây; GPU peak toàn thiết bị khoảng 5,97 GiB trên card 12 GB. INT8 chạy chậm hơn trong lần đo và chủ yếu có lợi về bộ nhớ. Medium nhanh hơn nhưng các mẫu đọc có nhiều lỗi chính tả/thuật ngữ hơn, chưa có lý do đổi sang medium khi ưu tiên chất lượng.

`profiles.json` ghi `practicalDefault: large-v3-gpu-fp16`. Đây cũng là mặc định CLI đã có. `releaseDefault` vẫn null: chưa có chứng nhận chất lượng rộng. Không tự fallback, không chạy cả ba model cho mọi file.

## Đã đọc thử và thấy gì

Review văn bản các mẫu của ba profile: đọc sâu năm clip đầu và các đoạn đầu/giữa/cuối được chọn ở danh sách còn lại. Không nghe audio hay xem video trong lượt review này; không tuyên bố đọc từng câu toàn bộ 101 phút. Review nhằm đánh giá khả năng hiểu nội dung và tìm điểm cần kiểm tra, không tính phần trăm chính xác.

- Large-v3 giữ đoạn giải thích mạch lạc hơn trong các mẫu brute force, space complexity, insertion sort; medium có các dạng “Root Force/BruteFox”, “xó xanh”, “mạ băm”.
- Large-v3 không thắng ở mọi câu: medium ghi “Competitive Programming” và “2 chiều” hợp ngữ cảnh, còn large-v3 ghi “Comparative Programming” và “2 triệu”.
- Video nhị phân: FP16 ghi “8 x 0 x 2 x 1 bằng 11”, mâu thuẫn toán học; INT8 và medium ghi phép cộng. Đây là ví dụ rõ review ngữ nghĩa có ích dù không có dataset.
- Queue có “5-4” trong câu giải thích First In, First Out; cuối transcript lại ghi FIFO. Hashing bị ghi “Harshing”.
- “Karane” xuất hiện cả tên file lẫn transcript: có thể là vấn đề nguồn, không được tự kết luận ASR sai rồi sửa thành Kadane.

Sáu nhận xét cụ thể có raw text, source hash, prediction hash, segment ID và timestamp ở [semantic-review.json](reports/2026-09-08/semantic-review.json). Các gợi ý đều mang nhãn suy luận ngữ nghĩa, chưa nghe xác nhận. Không sửa prediction gốc hoặc tạo gold giả.

## Cách sử dụng tiếp

1. Chạy large-v3 FP16 làm nguồn transcript chính; dùng để tìm hiểu, tìm đoạn và tóm tắt có dẫn chứng.
2. Agent đọc thuật ngữ, số, công thức, tính nhất quán giữa câu; ghi điểm nghi vấn kèm thời gian.
3. Với đoạn ảnh hưởng tới nội dung cuối, đối chiếu âm thanh/hình nguồn; có thể yêu cầu chạy lại đoạn bằng profile khác. Sự đồng thuận model là gợi ý, không thay nguồn.
4. Hiệu chỉnh được lưu riêng, có lý do và giữ raw; không phát hành phụ đề/công thức chỉ vì văn bản nghe có vẻ hợp lý.

Gói A đủ cơ sở để chuyển sang thiết kế/triển khai gói B khi owner yêu cầu. Dataset/holdout có thể bổ sung sau nếu cần đo chính xác rộng hơn; thiếu chúng không chặn cách dùng thực tế đã chốt.
