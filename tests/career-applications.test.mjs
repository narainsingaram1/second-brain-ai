import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
const server = await createServer({cacheDir:'/tmp/iris-career-history-tests-cache',configFile:false,define:{
 'import.meta.env.VITE_AUTH_PROVIDER':JSON.stringify('supabase'),
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://fixture.supabase.test'),
 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('fixture-publishable-key'),
},server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
after(()=>server.close());
const {normalizeWorkspaces}=await server.ssrLoadModule('/src/utils/workspaces.ts');
const {withApplicationResume,currentResume}=await server.ssrLoadModule('/src/utils/resumes.ts');
const {filterApplications}=await server.ssrLoadModule('/src/utils/careerApplications.ts');
const r1={id:'10000000-0000-4000-8000-000000000001',name:'Resume.pdf',mime:'application/pdf',size:100,uploadedAt:'2026-11-10T12:00:00Z'};
const r2={...r1,id:'10000000-0000-4000-8000-000000000002',uploadedAt:'2026-11-11T12:00:00Z'};
const workspace={id:'career',name:'Career',description:'',template:'career',color:'blue',notes:'Keep these notes',createdAt:r1.uploadedAt,resumes:[r1,r2],currentResumeId:r1.id};
const application=(id,fields={})=>({id,workspaceId:'career',kind:'job_application',title:'Engineer',subject:id,status:'applied',fields,history:{},streak:0,bestStreak:0,createdAt:r1.uploadedAt,updatedAt:r1.uploadedAt});

test('résumé versions survive normalization and changing the default cannot rewrite past applications',()=>{
 const old=withApplicationResume(application('old'),r1);
 const next=normalizeWorkspaces([{...workspace,currentResumeId:r2.id}])[0];
 assert.equal(currentResume(next).id,r2.id);
 assert.equal(old.fields.resumeId,r1.id);
 assert.equal(old.fields.resumeUploadedAt,r1.uploadedAt);
 assert.deepEqual(withApplicationResume(application('new'),currentResume(next)).fields,{resumeId:r2.id,resumeName:r2.name,resumeUploadedAt:r2.uploadedAt});
 assert.equal(withApplicationResume(old).fields.resumeId,'');
 assert.equal(old.fields.resumeId,r1.id,'explicit reassignment is immutable');
 const cleaned=normalizeWorkspaces([{...workspace,resumes:[r1,r1,{...r2,size:Infinity}],currentResumeId:r2.id}])[0];
 assert.deepEqual(cleaned.resumes,[r1]);assert.equal(cleaned.currentResumeId,undefined);
});

test('a newer upload with the same filename leaves the old application PDF downloadable from cloud storage',async()=>{
 const originals={indexedDB:globalThis.indexedDB,document:globalThis.document,window:globalThis.window,
  createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
 const cache=new Map(),cloud=new Map(),downloads=[];
 let client;
 const database={createObjectStore(){},transaction(){
  const tx={objectStore:()=>({
   put(blob,key){cache.set(key,blob);const request={result:key};queueMicrotask(()=>tx.oncomplete?.());return request;},
   get(key){const request={result:cache.get(key)};queueMicrotask(()=>tx.oncomplete?.());return request;},
  })};return tx;
 }};
 globalThis.indexedDB={open(){const request={result:database};queueMicrotask(()=>request.onsuccess?.());return request;}};
 URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:resume-test';};
 URL.revokeObjectURL=()=>{};
 try{
  const {getSupabase}=await server.ssrLoadModule('/src/services/managedAuth.ts');
  client=getSupabase();
  client.auth.getUser=async()=>({data:{user:{id:owner}},error:null});
  client.storage.from=bucket=>{
   assert.equal(bucket,'career-resumes');
   return {
    async upload(path,file,options){
     assert.equal(options.upsert,false,'uploads must never overwrite an original');
     assert.equal(cloud.has(path),false,'each version needs its own object path');
     cloud.set(path,file);return {error:null};
    },
    async download(path){return {data:cloud.get(path),error:null};},
   };
  };
  const {uploadResume,downloadResume}=await server.ssrLoadModule('/src/services/resumeFiles.ts');
  const v1=await uploadResume(owner,new File(['%PDF-1.4\nOriginal résumé'], 'Resume.pdf',{type:'application/pdf'}));
  const old=withApplicationResume(application('already-applied'),v1);
  const v2=await uploadResume(owner,new File(['%PDF-1.4\nUpdated résumé'], 'Resume.pdf',{type:'application/pdf'}));
  assert.notEqual(v1.id,v2.id);
  assert.equal(cloud.size,2,'both originals remain in cloud storage');
  const reloaded=normalizeWorkspaces(JSON.parse(JSON.stringify([{...workspace,resumes:[v1,v2],currentResumeId:v2.id}])))[0];
  assert.equal(currentResume(reloaded).id,v2.id);
  assert.equal(old.fields.resumeId,v1.id,'the existing application still selects the original');
  const next=withApplicationResume(application('new-application'),currentResume(reloaded));
  assert.equal(next.fields.resumeId,v2.id);
  globalThis.document={createElement:()=>({click(){}})};
  globalThis.window={setTimeout:callback=>callback()};
  cache.clear(); // Simulate another device with no cached files.
  await downloadResume(owner,reloaded.resumes.find(version=>version.id===old.fields.resumeId));
  assert.equal(await downloads[0].text(),'%PDF-1.4\nOriginal résumé');
  await downloadResume(owner,reloaded.resumes.find(version=>version.id===next.fields.resumeId));
  assert.equal(await downloads[1].text(),'%PDF-1.4\nUpdated résumé');
 }finally{
  await client?.auth.stopAutoRefresh();
  for(const key of ['indexedDB','document','window']){
   if(originals[key]===undefined)delete globalThis[key];else globalThis[key]=originals[key];
  }
  URL.createObjectURL=originals.createObjectURL;URL.revokeObjectURL=originals.revokeObjectURL;
 }
});

test('applications filter and sort without mutating records; missing dates stay last',()=>{
 const items=[application('Z',{location:'Remote',appliedDate:'2026-11-09',followUpDate:'2026-11-14'}),application('A',{location:'New York',appliedDate:'2026-11-11',followUpDate:'2026-11-12'}),application('M')];
 assert.deepEqual(filterApplications(items,'','all','all','applied-newest').map(x=>x.id),['A','Z','M']);
 assert.deepEqual(filterApplications(items,'','all','all','applied-oldest').map(x=>x.id),['Z','A','M']);
 assert.deepEqual(filterApplications(items,'','all','all','follow-up').map(x=>x.id),['A','Z','M']);
 assert.deepEqual(filterApplications(items,'engineer','applied','remote','company').map(x=>x.id),['Z']);
 assert.deepEqual(items.map(x=>x.id),['Z','A','M']);
});

test('résumé metadata and application history round-trip in snapshot and per-record cloud storage',async()=>{
 const {db,asUser}=await supabaseLikeDatabase();
 try{
  await asUser(owner);
  const item=withApplicationResume(application('applied'),r1);
  const state={tasks:[],goals:[],habits:[],journalEntries:[],knowledgeItems:[],chatHistory:[],sections:[],subsections:{},workspaces:[workspace],trackerItems:[item]};
  await db.query('select public.save_brain($1::jsonb,0,$2::uuid)',[JSON.stringify(state),owner]);
  assert.deepEqual((await db.query('select state from public.brains')).rows[0].state.workspaces,[workspace]);
  await db.query('select public.migrate_brain_to_records()');
  const updated={...workspace,currentResumeId:r2.id};
  const result=await db.query('select public.save_records($1::jsonb) as r',[JSON.stringify([{collection:'workspaces',id:workspace.id,baseRevision:1,data:updated}])]);
  assert.equal(result.rows[0].r.saved.length,1);
  const rows=(await db.query("select collection,data from public.brain_records where not deleted")).rows;
  assert.deepEqual(rows.find(r=>r.collection==='workspaces').data.resumes,[r1,r2]);
  assert.equal(rows.find(r=>r.collection==='trackerItems').data.fields.resumeId,r1.id);
 }finally{await db.close()}
});

test('résumé bucket is private and only owners can insert/read immutable originals',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
   alter table storage.objects enable row level security;
   grant usage on schema auth,storage to authenticated,anon;
   grant select,insert on storage.objects to authenticated;`);
  const migration=await readFile(new URL('../supabase/migrations/202611150001_private_resume_files.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  const bucket=(await db.query('select * from storage.buckets')).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  await db.query("insert into storage.objects values('career-resumes',$1)",[`${owner}/version.pdf`]);
  await assert.rejects(db.query("insert into storage.objects values('career-resumes',$1)",[`${other}/version.pdf`]),e=>e.code==='42501');
  await assert.rejects(db.query("update storage.objects set name='changed'"),e=>e.code==='42501');
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from storage.objects'),e=>e.code==='42501');
 }finally{await db.close()}
});


test('assistant résumé selection validates real versions, clears stale names and offers bounded metadata reads',async()=>{
 const {prepareMutation,executeRead}=await server.ssrLoadModule('/src/services/brainTools.ts');
 const state={workspaces:[workspace],trackerItems:[],tasks:[],goals:[],habits:[],journalEntries:[],knowledgeItems:[],chatHistory:[],sections:[],subsections:{}};
 const created=prepareMutation('create_tracker_item',{kind:'job_application',title:'Engineer',company:'Example',workspaceId:'career',resumeId:r1.id},state).record;
 assert.equal(created.fields.resumeName,r1.name);
 assert.throws(()=>prepareMutation('create_tracker_item',{kind:'job_application',title:'Engineer',company:'Example',workspaceId:'career',resumeId:'invented'},state),/Unknown résumé/);
 state.trackerItems=[created];
 const cleared=prepareMutation('update_tracker_item',{trackerId:created.id,clearFields:['resumeId']},state).record;
 assert.equal(cleared.fields.resumeId,undefined);assert.equal(cleared.fields.resumeName,undefined);
 const result=await executeRead('list_resume_versions',{workspaceId:'career'},state,'');
 assert.equal(result.output.currentResumeId,r1.id);assert.deepEqual(result.output.versions,[r1,r2]);
 assert.equal(result.output.nextOffset,null);
 const noInference=prepareMutation('create_tracker_item',{kind:'job_application',title:'Engineer',company:'Example',workspaceId:'career',appliedDate:'2026-10-01'},state).record;
 assert.equal(noInference.fields.resumeId,undefined,'the model cannot silently assume a historical application used the current résumé');
});
