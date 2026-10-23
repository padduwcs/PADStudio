import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexClient, codexLaunch } from "../src/chat/codex-client.js";

async function peer(t, timeoutMs = 2_000) {
  const root = await mkdtemp(join(tmpdir(), "padstudio-rpc-"));
  const script = join(root, "peer.mjs");
  await writeFile(script, `
    import {createInterface} from 'node:readline';
    const lines=createInterface({input:process.stdin});
    const reply=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
    lines.on('line',(line)=>{const m=JSON.parse(line);
      if(m.method==='initialize') reply({id:m.id,result:{userAgent:'fixture'}});
      else if(m.method==='unicode') {const b=Buffer.from(JSON.stringify({id:m.id,result:{text:'Tiếng Việt ✓'}})+'\\n');const p=b.indexOf(Buffer.from('ế'))+1;process.stdout.write(b.subarray(0,p));setTimeout(()=>process.stdout.write(b.subarray(p)),5);}
      else if(m.method==='request') {reply({method:'item/started',params:{threadId:'t'}});reply({id:101,method:'item/tool/requestUserInput',params:{threadId:'t'}});reply({id:m.id,result:{ok:true}});}
      else if(m.method==='failure') reply({id:m.id,error:{code:42,message:'refused'}});
      else if(m.method==='invalid') process.stdout.write('not json\\n');
      else if(m.method==='crash') process.exit(7);
      else if(m.method==='late') setTimeout(()=>reply({id:m.id,result:{late:true}}),100);
    });
    lines.on('close',()=>process.exit(0));
  `);
  const client = new CodexClient({ command: process.execPath, args: [script], cwd: root, timeoutMs: 5_000 });
  t.after(async () => { await client.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  await client.start(); client.timeoutMs = timeoutMs; return client;
}

test("Codex stdio handles split Unicode, interleaved notifications and server requests", async (t) => {
  const client = await peer(t);
  assert.deepEqual(await client.request("unicode"), { text: "Tiếng Việt ✓" });
  const notification = once(client, "notification"); const request = once(client, "serverRequest");
  assert.deepEqual(await client.request("request"), { ok: true });
  assert.equal((await notification)[0].method, "item/started");
  const prompt = (await request)[0]; assert.equal(prompt.id, 101);
  client.respond(prompt.id, { answers: {} });
  await assert.rejects(client.request("failure"), { code: "rpc_error", message: "refused" });
});

test("Codex RPC timeouts are explicit, late replies are ignored and disconnect rejects pending calls", async (t) => {
  const client = await peer(t, 40);
  await assert.rejects(client.request("late"), { code: "rpc_timeout" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(client.pending.size, 0);
  client.timeoutMs = 2_000;
  await assert.rejects(client.request("crash"), { code: "codex_unavailable" });
  assert.equal(client.child, null);
});

test("malformed stdio and a missing executable fail clearly without exposing stderr", async (t) => {
  const client = await peer(t);
  await assert.rejects(client.request("invalid"), { code: "protocol_error" });
  await client.close(); assert.equal(client.children.size, 0);
  const missing = new CodexClient({ command: join(tmpdir(), "missing-padstudio-codex.exe"), timeoutMs: 1_000 });
  t.after(() => missing.close());
  await assert.rejects(missing.start(), /Chưa tìm thấy Codex CLI/);
});

test("Windows Codex discovery supports native installs and npm shims without launching a shell", () => {
  const native = join("C:/codex", "codex.exe");
  assert.deepEqual(codexLaunch({ env: { PATH: "C:/codex;C:/npm" }, platform: "win32", exists: (path) => path === native }), { command: native, prefix: [] });
  const script = join("C:/npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  assert.deepEqual(codexLaunch({ env: { PATH: "C:/codex;C:/npm" }, platform: "win32", exists: (path) => path === script }), { command: process.execPath, prefix: [script] });
  assert.deepEqual(codexLaunch({ env: { PADSTUDIO_CODEX_PATH: script }, platform: "win32" }), { command: process.execPath, prefix: [script] });
});
