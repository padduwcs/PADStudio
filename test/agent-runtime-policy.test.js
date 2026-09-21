import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime bootstrap preserves managed-output and final-delivery guardrails", async () => {
  const [router, runtime, reference] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("PADSTUDIO-AGENT-RUNTIME.md", "utf8"),
    readFile("PADSTUDIO-AGENT-REFERENCE.md", "utf8")
  ]);

  assert.match(router, /Không tự sao chép preview\/render ra ngoài project/);
  assert.match(router, /final.*exact user acceptance.*video\.export-delivery.*Delivery Result.*giữ nguyên byte/s);
  assert.match(router, /QA sâu.*không phải blocker hậu duyệt/s);

  assert.match(runtime, /Không dùng raw path hay file rời làm nguồn sự thật/);
  assert.match(runtime, /preview\.mp4.*vẫn là preview.*final\.mp4/s);
  assert.match(runtime, /final.*trạng thái có bằng chứng, không phải tên file/s);
  assert.match(runtime, /Không suy diễn approval/);
  assert.match(runtime, /không bypass bằng FFmpeg, lệnh copy hoặc công cụ ngoài Executor/);
  assert.match(runtime, /Chỉ tạo bản sao ngoài project sau khi đã có official Delivery và người dùng yêu cầu rõ vị trí/);
  assert.match(runtime, /health\.counts\.deliveries/);
  assert.match(runtime, /Render verification.*QA sâu không thay thế đánh giá sáng tạo.*không phủ quyết acceptance/s);

  assert.match(reference, /Không dùng `copy`, FFmpeg hay.*để né các gate/s);
  assert.match(reference, /delivery\.bundle.*video\.export-delivery/s);
});
