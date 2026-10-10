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

test("runtime bootstrap keeps the viewer, not the specification, as the measure of a finished video", async () => {
  const runtime = await readFile("PADSTUDIO-AGENT-RUNTIME.md", "utf8");
  const [intake, review, narration, choreography] = await Promise.all([
    "project-intake", "result-review", "voice-narration", "visual-choreography"
  ].map((id) => readFile(`skills/${id}.md`, "utf8")));

  assert.match(runtime, /Thước đo là người xem/);
  assert.match(runtime, /người xem lần đầu, chưa biết đáp án/);
  assert.match(runtime, /Đạt mọi yêu cầu mà người xem\s+không hiểu thì chưa xong/);
  // The same question is asked where the work starts, where the words are written, where the pictures are
  // planned and where the result is judged.
  assert.match(intake, /Name the viewer/);
  assert.match(narration, /reason before the method/i);
  assert.match(choreography, /Keep the viewer's attention in one place/);
  assert.match(review, /review it as the viewer the brief names/);
});

test("the narration skill asks for one request and for a script that cannot be misread, not for passages", async () => {
  const skill = await readFile("skills/voice-narration.md", "utf8");
  assert.match(skill, /Make the whole narration in \*\*one request\*\*/);
  assert.doesNotMatch(skill, /passages that match the video's segments/);
  assert.match(skill, /inputReview/);
  assert.match(skill, /withTimestamps: true/);
  // A claim about the provider that could not be confirmed in its documentation must not come back.
  assert.doesNotMatch(skill, /80-90/);
});
