import {execFile} from 'node:child_process'; import {promisify} from 'node:util';import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ProjectStore} from '../src/project/project-store.js';
import {ToolExecutor} from '../src/execution/tool-executor.js';
import {createDefaultToolRegistry} from '../src/execution/default-tool-registry.js';
import {importProjectInput} from '../src/resources/project-importer.js';
import {command} from '../src/tools/asset-tool-common.js';
import {createPadStudioServer} from '../src/web/server.js';
import {ProjectReader} from '../src/web/project-reader.js';
const root=resolve('.cache/asset-browser-projects'); await mkdir(root,{recursive:true});
const store=new ProjectStore(root), id='asset-check-'+Date.now();
await store.createProject({projectId:id,title:'Kiểm tra nguyên liệu dùng chung'});
let png;
const executor=new ToolExecutor({store,registry:createDefaultToolRegistry({mediaAcquire:{download:async(url,path)=>{await copyFile(png,path);return {finalUrl:url,redirects:[],contentType:'image/png'};}}})});
const g=await executor.execute(id,{capability:'graphic.render',tool:'browser-graphic',purpose:'Kiểm tra đồ họa',inputs:{kind:'card',title:'Nội dung rõ ràng',body:'Một kết quả dùng được ở nhiều project.',width:1280,height:720}});
png=(await store.resolveResultFile(id,g.resultId,'primary')).filePath;
await executor.execute(id,{capability:'media.register-generated',tool:'external-generated-media',purpose:'Kiểm tra provenance asset sinh ngoài',inputs:{source:{kind:'result',id:g.resultId,file:'primary'},mediaType:'image',name:'Key visual từ Agent ngoài',generation:{provider:'Acceptance fixture',model:'fixture-v1',prompt:'A traceable generated key visual',seed:42,rightsBasis:'Repository-owned acceptance fixture',externalCostUsd:0}}});
await executor.execute(id,{capability:'media.acquire',tool:'https-media',purpose:'Fixture acquisition',inputs:{url:'https://example.test/fixture.png',mediaType:'image',name:'Nguồn fixture',attribution:{creator:'Local test',license:'Test fixture'}}});
const wav=resolve('.cache/asset-browser.wav');
await command('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-y',wav]);
const resource=await importProjectInput({rootDir:root,projectId:id,sourcePath:wav});
await executor.execute(id,{capability:'audio.prepare',tool:'ffmpeg-audio-prepare',purpose:'Preview audio',inputs:{source:{kind:'resource',id:resource.resourceId},endSeconds:2}});
const server=createPadStudioServer({reader:new ProjectReader(root)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 const result=await promisify(execFile)('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/asset-observer-browser-smoke.ps1','-Url','http://127.0.0.1:'+server.address().port,'-ProjectId',id],{timeout:45000,windowsHide:true});
 await writeFile('.cache/asset-browser-result.json',result.stdout);
 console.log(result.stdout);
}finally{await new Promise(r=>server.close(r));}
