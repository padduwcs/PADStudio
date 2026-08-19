// Runtime bridge intentionally crosses Vite's untyped middleware boundary.
// @ts-nocheck
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {copyPreviewWorkspace} from './previewWorkspaceCopy.ts';
import {decodePngRgba} from './visualViability.ts';
import {findBrowserExecutable} from './finalRenderService.ts';
import {withTemporaryVisualQualityWorkspace, type MotionCanvasFrameRenderer, type QualityRenderedFrame} from './motionCanvasVisualQuality.ts';

const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_GEOMETRY_BYTES = 512 * 1024;
function debugQuality(message: string) {
  if (process.env.PAD_QUALITY_DEBUG === '1') process.stderr.write(`[motion-quality] ${message}\n`);
}
async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message())), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
type ViteServer = {listen(): Promise<void>; close(): Promise<void>; resolvedUrls:{local:string[]}|null; transformRequest(url:string):Promise<unknown>; middlewares:{use(handler:(req:any,res:any,next:()=>void)=>void):void}};
function body(req:any, maximum:number) { return new Promise<Buffer>((resolve,reject)=>{const parts:Buffer[]=[];let size=0;req.on('data',(part:Buffer)=>{size+=part.length;if(size>maximum){reject(new Error('Quality bridge payload too large.'));req.destroy();}else parts.push(part);});req.once('end',()=>resolve(Buffer.concat(parts)));req.once('error',reject);}); }
function send(res:any,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
async function stopBrowser(child: ReturnType<typeof spawn> | null) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit').then(() => undefined).catch(() => undefined);
  await Promise.race([
    exited,
    new Promise<void>(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(
      'taskkill',
      ['/pid', String(child.pid), '/t', '/f'],
      {stdio: 'ignore', windowsHide: true},
    );
    await Promise.race([
      once(killer, 'exit').then(() => undefined).catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, 5_000)),
    ]);
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([
    exited,
    new Promise<void>(resolve => setTimeout(resolve, 5_000)),
  ]);
}

export function createMotionCanvasRuntimeFrameRenderer(runtimeOptions: {browserNoSandbox?: boolean} = {}): MotionCanvasFrameRenderer {
  return {async render(options) {
    const workspaceDirectory = (options as typeof options & {workspaceDirectory?:string}).workspaceDirectory;
    const projectFile = (options as typeof options & {projectFile?:string}).projectFile;
    if (!workspaceDirectory || !projectFile) throw new Error('Quality renderer requires a compiled workspace and project file.');
    const chrome = findBrowserExecutable(process.env.PAD_BROWSER_PATH); if (!chrome) throw new Error('Motion Canvas quality renderer requires Chrome or Edge headless.');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    const runtimeRequire=createRequire(path.join(root,'motion-canvas-runtime','package.json')); const viteEntry=path.join(path.dirname(runtimeRequire.resolve('vite/package.json')),'dist','node','index.js'); const pluginEntry=runtimeRequire.resolve('@motion-canvas/vite-plugin'); const qualityEditor=path.join(root,'motion-canvas-runtime','render','quality-editor.js');
    return withTemporaryVisualQualityWorkspace(async temporary => {
      const copied=path.join(temporary,'motion-canvas','generations','quality'); await mkdir(path.dirname(copied),{recursive:true}); await copyPreviewWorkspace(workspaceDirectory,copied,{motionCanvasScenePaths:options.scenes.map(scene=>scene.filePath)});
      const projectRelativePath = path.isAbsolute(projectFile)
        ? path.relative(workspaceDirectory, projectFile)
        : projectFile;
      const copiedProject = path.resolve(copied, projectRelativePath);
      if (
        projectRelativePath.startsWith('..') ||
        path.isAbsolute(projectRelativePath) ||
        !copiedProject.startsWith(`${path.resolve(copied)}${path.sep}`)
      ) {
        throw new Error('Quality renderer project file is outside the compiled workspace.');
      }
      const token = randomBytes(24).toString('base64url');
      const expectedSamples = new Map(
        options.samples.map(sample => {
          const scene = options.scenes.find(candidate => candidate.id === sample.sceneId);
          if (!scene) throw new Error(`Quality sample ${sample.sampleId} references an unknown scene.`);
          return [sample.sampleId, {
            ...sample,
            expectedSceneName: path.posix.basename(scene.filePath.replaceAll('\\', '/'), '.tsx'),
          }] as const;
        }),
      );
      if (expectedSamples.size !== options.samples.length) {
        throw new Error('Quality samples contain duplicate sampleId values.');
      }
      const outputs = new Map<string, {
        frame: number;
        sceneName: string;
        png?: Buffer;
        nodes?: any[];
      }>();
      let finish:(error?:Error)=>void=()=>{};
      const complete=new Promise<void>((resolve,reject)=>{finish=error=>error?reject(error):resolve();});
      const [viteModule,pluginModule]=await Promise.all([import(pathToFileURL(viteEntry).href),import(pathToFileURL(pluginEntry).href)]);
      const motionCanvas=(pluginModule.default as any)?.default ?? pluginModule.default;
      const managedKeysByScene=Object.fromEntries(options.scenes.map(scene=>[scene.id, [...new Set(options.samples.filter(sample=>sample.sceneId===scene.id).flatMap(sample=>(options as any).managedKeysByBeat?.get(sample.beatId)??[]))]]));
      const validateSample = (sampleId: string, frame: number, sceneName: string) => {
        const expected = expectedSamples.get(sampleId);
        if (!expected) throw new Error(`Unknown quality sampleId ${sampleId}.`);
        if (frame !== expected.frame) throw new Error(`Quality sample ${sampleId} returned frame ${frame}, expected ${expected.frame}.`);
        if (sceneName !== expected.expectedSceneName) throw new Error(`Quality sample ${sampleId} rendered scene ${sceneName || '(empty)'}, expected ${expected.expectedSceneName}.`);
        return expected;
      };
      const plugin={name:'pad-quality-bridge',configureServer(server:any){server.middlewares.use((req:any,res:any,next:any)=>{void (async()=>{const url=new URL(req.url??'/','http://127.0.0.1');if(!url.pathname.startsWith('/__pad-quality/'))return next();if(url.searchParams.get('token')!==token)return send(res,403,{error:'token'});if(url.pathname==='/__pad-quality/config'&&req.method==='GET')return send(res,200,{fps:options.frame.fps,width:options.frame.width,height:options.frame.height,samples:[...expectedSamples.values()],managedKeysByScene});if(url.pathname==='/__pad-quality/geometry'&&req.method==='POST'){const data=JSON.parse((await body(req,MAX_GEOMETRY_BYTES)).toString('utf8'));const sampleId=String(data.sampleId??'');const frame=Number(data.frame);const sceneName=String(data.sceneName??'');validateSample(sampleId,frame,sceneName);const previous=outputs.get(sampleId);if(previous?.nodes)throw new Error(`Duplicate geometry for quality sample ${sampleId}.`);outputs.set(sampleId,{frame,sceneName,...previous,nodes:Array.isArray(data.nodes)?data.nodes:[]});return send(res,200,{ok:true});}if(url.pathname==='/__pad-quality/frame'&&req.method==='POST'){const sampleId=url.searchParams.get('sampleId')??'';const frame=Number(url.searchParams.get('frame'));const sceneName=url.searchParams.get('sceneName')??'';validateSample(sampleId,frame,sceneName);const previous=outputs.get(sampleId);if(previous?.png)throw new Error(`Duplicate PNG for quality sample ${sampleId}.`);const png=await body(req,MAX_FRAME_BYTES);outputs.set(sampleId,{frame,sceneName,...previous,png});return send(res,200,{ok:true});}if(url.pathname==='/__pad-quality/status'&&req.method==='POST'){const data=JSON.parse((await body(req,64*1024)).toString('utf8'));finish(data.state==='completed'?undefined:new Error(String(data.message??'Quality renderer failed.')));return send(res,200,{ok:true});}send(res,404,{error:'route'});})().catch(error=>{finish(error instanceof Error?error:new Error(String(error)));if(!res.headersSent)send(res,500,{error:'bridge'});else if(!res.writableEnded)res.end();});});}};
      let server:ViteServer|null=null;
      let child:ReturnType<typeof spawn>|null=null;
      const browserErrors: string[] = [];
      try {
        debugQuality('creating Vite server');
        server=await (viteModule as any).createServer({configFile:false,root:copied,cacheDir:path.join(temporary,'vite-cache'),logLevel:'error',appType:'custom',optimizeDeps:{noDiscovery:true,include:['@motion-canvas/core','@motion-canvas/2d','@preact/signals-core','chroma-js','parse-svg-path','mathjax-full/js/adaptors/liteAdaptor','mathjax-full/js/handlers/html','mathjax-full/js/input/tex','mathjax-full/js/input/tex/AllPackages','mathjax-full/js/mathjax','mathjax-full/js/output/svg']},resolve:{dedupe:['@motion-canvas/core','@motion-canvas/2d','@preact/signals-core'],alias:{'@motion-canvas/core':path.join(root,'node_modules','@motion-canvas','core'),'@motion-canvas/2d':path.join(root,'node_modules','@motion-canvas','2d'),'@preact/signals-core':path.join(root,'node_modules','@preact','signals-core')}},plugins:[plugin,...motionCanvas({project:copiedProject.replaceAll('\\','/'),output:path.join(temporary,'out'),editor:qualityEditor.replaceAll('\\','/'),bufferedAssets:false})],server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,fs:{allow:[root,copied]}}});
        debugQuality('starting Vite server');
        await server.listen();
        debugQuality('transforming quality editor');
        await server.transformRequest(`/@fs/${qualityEditor.replaceAll('\\','/')}`);
        debugQuality('transforming Motion Canvas project');
        await server.transformRequest(`/@fs/${copiedProject.replaceAll('\\','/')}?project`);
        debugQuality('launching browser');
        const local=server.resolvedUrls?.local[0];
        if(!local)throw new Error('Quality Vite server did not expose localhost URL.');
        const url=new URL(local);url.searchParams.set('token',token);
        const sandboxFlags = runtimeOptions.browserNoSandbox || process.env.PAD_BROWSER_NO_SANDBOX === '1'
          ? ['--no-sandbox', '--disable-gpu-sandbox']
          : [];
        child=spawn(chrome,['--headless=new','--disable-background-networking','--disable-breakpad','--disable-component-update','--disable-crash-reporter','--disable-crashpad-for-testing','--disable-default-apps','--disable-dev-shm-usage','--disable-extensions','--disable-features=Translate','--disable-gpu','--disable-sync','--enable-logging=stderr','--v=0','--no-first-run','--no-default-browser-check','--password-store=basic','--autoplay-policy=no-user-gesture-required',...sandboxFlags,`--user-data-dir=${path.join(temporary,'browser')}`,url.toString()],{stdio:['ignore','ignore','pipe'],windowsHide:true});
        child.stderr?.on('data', chunk => {
          if (browserErrors.join('').length < 8_000) browserErrors.push(String(chunk));
        });
        child.once('error',error=>finish(error));
        child.once('exit',code=>{if(code!==0)finish(new Error(`Quality browser exited with ${String(code)}. ${browserErrors.join('').slice(-4_000)}`));});
        debugQuality('waiting for browser samples');
        await withTimeout(
          complete,
          Math.max(30_000, options.samples.length * 10_000),
          () => `Motion Canvas quality render timed out. ${browserErrors.join('').slice(-4_000)}`,
        );
        debugQuality('browser samples complete');
        const result=new Map<string,QualityRenderedFrame>();
        for(const sample of options.samples){
          const rendered=outputs.get(sample.sampleId);
          if(!rendered?.png||!rendered.nodes)throw new Error(`Quality renderer did not return complete output for sample ${sample.sampleId}.`);
          const decoded=decodePngRgba(rendered.png);
          result.set(sample.sampleId,{...decoded,nodes:rendered.nodes});
        }
        return result;
      } catch (error) {
        debugQuality(error instanceof Error ? `render failed: ${error.message}` : `render failed: ${String(error)}`);
        throw error;
      } finally {
        debugQuality('stopping browser');
        await stopBrowser(child);
        debugQuality('closing Vite server');
        if (server) {
          await Promise.race([
            server.close().catch(() => undefined),
            new Promise<void>(resolve => setTimeout(resolve, 5_000)),
          ]);
        }
        debugQuality('runtime cleanup complete');
      }
    });
  }};
}
