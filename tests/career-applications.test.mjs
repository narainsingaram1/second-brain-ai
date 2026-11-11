import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';
import { owner, other, supabaseLikeDatabase } from './helpers/supabaseDb.mjs';
const server = await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
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
