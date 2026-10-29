import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createSessionDelivery} from '../lib/session-delivery.js'
import {watchOptions} from '../tools/lib/watch-options.mjs'

function fixture(t,cfg={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whale-27-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  let time=10*86400000,block='PERSONA-A',busy=false,fail=false,createFail=false
  const sent=[],created=[]
  const args={dshHome:dir,cwd:dir,sessionId:'bili-whale',config:()=>cfg,persona:()=>block,now:()=>time,isBusy:()=>busy,
    controller:{async create(r){if(createFail)throw Error('create failed');created.push(r)},async prompt(r){if(fail)throw Error('send failed');sent.push(r)}}}
  const request={content:[{type:'text',text:'TASK'}]}
  return {dir,args,sent,created,request,make:()=>createSessionDelivery(args),advance:n=>time+=n,persona:s=>block=s,busy:b=>busy=b,fail:b=>fail=b,createFail:b=>createFail=b}
}
test('defaults repeat persona and do not create session state',async t=>{
  const f=fixture(t),d=f.make();await d.send(f.request);await d.send(f.request)
  assert.equal(f.sent.length,2);assert.ok(f.sent.every(r=>r.content[0].text.includes('PERSONA-A')))
  assert.equal(fs.existsSync(path.join(f.dir,'whale-session.json')),false)
})
test('failed delivery retries persona; concurrent channels inject only once; edits reinject',async t=>{
  const f=fixture(t,{personaOncePerSession:true}),d=f.make();f.fail(true)
  await assert.rejects(d.send(f.request),/send failed/);f.fail(false)
  await Promise.all([d.send(f.request),d.send(f.request),d.send(f.request)])
  assert.equal(f.sent.filter(r=>r.content[0].text.includes('PERSONA-A')).length,1)
  f.persona('PERSONA-B');await d.send(f.request);assert.match(f.sent.at(-1).content[0].text,/PERSONA-B/)
  // 2026-10-24 改（审查报告第 3 条）：重启后【第一次投递】现在会重新注入人设 ✓
  //   原因：DSH 的 create() 分不出"新建会话"还是"复用"，接口里没有那个信息 ✗
  //   与其赌"宿主会话还在"→ 她重启后失忆 ✗，不如每次重启多重注入一次（~1000 字）✓
  await f.make().send(f.request);assert.match(f.sent.at(-1).content[0].text,/PERSONA-B/)
})
// 2026-10-27：到期后先在旧会话里请她写交接信，下一次（隔 8 分钟、不忙）才换会话
const text=r=>r.content.map(c=>c.text).join('\n')
test('rotation waits for idle, asks the old session for a handoff letter, then rotates and reads it',async t=>{
  const f=fixture(t,{sessionRotateDays:1,personaOncePerSession:true}),d=f.make()
  fs.mkdirSync(path.join(f.dir,'companion'))   // 装了桌宠：新会话还要读最近 30 条聊天
  await d.send(f.request);f.advance(86400001);f.busy(true);await d.send(f.request)
  assert.equal(f.sent.at(-1).sessionId,'bili-whale');assert.doesNotMatch(text(f.sent.at(-1)),/交接/,'忙的时候不打扰')
  f.busy(false);f.advance(8*60000);await d.send(f.request)
  const ask=f.sent.at(-1)
  assert.equal(ask.sessionId,'bili-whale','写信这一轮还在旧会话')
  assert.match(text(ask),/TASK[\s\S]*【交接】[\s\S]*给下一个自己的信/,'先做原来的事，最后写信')
  const letter=text(ask).match(/存到：(.+\.md)/)[1]
  assert.ok(letter.startsWith(path.join(f.dir,'whale-letters')))
  assert.match(text(ask),/和主人之间的事[\s\S]*心情[\s\S]*在追的事[\s\S]*梗[\s\S]*说话的感觉/)
  fs.mkdirSync(path.dirname(letter),{recursive:true});fs.writeFileSync(letter,'亲爱的下一个我：主人最近在赶论文…')
  f.advance(8*60000);await d.send(f.request)
  const r=f.sent.at(-1);assert.match(r.sessionId,/^[0-9a-f-]{36}$/)
  const first=text(r)
  assert.match(first,/PERSONA-A/)
  assert.ok(first.indexOf('先读上一个你留下的信：'+letter)>=0)
  assert.ok(first.indexOf('留下的信')<first.indexOf('chat-recent --n 30')&&first.indexOf('chat-recent')<first.indexOf('memories recall'),'顺序：信 → 最近 30 条聊天 → 回忆')
  assert.match(first,/whale-diary-private.md/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'whale-session.json'))).rotatedFrom,'bili-whale')
  await d.send(f.request);assert.doesNotMatch(text(f.sent.at(-1)),/留下的信|交接/,'只在换完后的第一次')
  await f.make().send(f.request);assert.equal(f.sent.at(-1).sessionId,r.sessionId)
})
test('no letter written: still rotates, tells her it is fine; no chat line without the companion',async t=>{
  const f=fixture(t,{sessionRotateDays:1}),d=f.make()
  await d.send(f.request);f.advance(86400001);await d.send(f.request)
  assert.match(text(f.sent.at(-1)),/【交接】/)
  f.advance(8*60000);await d.send(f.request)
  const first=text(f.sent.at(-1))
  assert.match(f.sent.at(-1).sessionId,/^[0-9a-f-]{36}$/)
  assert.match(first,/没来得及留下交接信（正常，不用追查）/)
  assert.doesNotMatch(first,/chat-recent/)
})
test('the letter request cannot be delivered: next delivery rotates anyway',async t=>{
  const f=fixture(t,{sessionRotateDays:1}),d=f.make()
  await d.send(f.request);f.advance(86400001);f.fail(true)
  await assert.rejects(d.send(f.request),/send failed/)
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.dir,'whale-session.json'))).letterAskedAt,'记成问过了')
  f.fail(false);await d.send(f.request)
  assert.match(f.sent.at(-1).sessionId,/^[0-9a-f-]{36}$/,'没信也照样换')
  assert.match(text(f.sent.at(-1)),/没来得及留下交接信/)
})
test('restart respects delivery cooldown even when rotation becomes due',async t=>{
  const cfg={sessionRotateDays:0,personaOncePerSession:true},f=fixture(t,cfg)
  await f.make().send(f.request);f.advance(86400001);await f.make().send(f.request)
  cfg.sessionRotateDays=1;await f.make().send(f.request)
  assert.equal(f.sent.at(-1).sessionId,'bili-whale')
})
test('rotation creation failure does not commit a new session; aborted queue does not send',async t=>{
  const f=fixture(t,{sessionRotateDays:1}),d=f.make();await d.send(f.request);f.advance(86400001)
  await d.send(f.request);f.advance(8*60000)   // 先在旧会话里请她写交接信（2026-10-27），下一次才建新会话
  f.createFail(true)
  await assert.rejects(d.send(f.request),/create failed/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'whale-session.json'))).id,'bili-whale')
  const abort=new AbortController();abort.abort();await assert.rejects(d.send(f.request,abort.signal));assert.equal(f.sent.length,2)   // 第一次 + 写信那一轮；建会话失败、取消的都没发
})
test('invalid state is reported without overwriting it',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.dir,'whale-session.json'),'broken')
  assert.throws(f.make,/会话状态损坏/);assert.equal(fs.readFileSync(path.join(f.dir,'whale-session.json'),'utf8'),'broken')
})
test('tile options do not consume positional output directory; invalid widths rejected',()=>{
  assert.deepEqual(watchOptions(['BVtest','--tile','800','4x4','out'],'default'),{bvid:'BVtest',grid:'4x4',outDir:'out',tile:800})
  assert.equal(watchOptions(['BVtest','--tile=1280'],'default').tile,1280)
  assert.equal(watchOptions(['BVtest'],'default').tile,720)
  for(const v of ['','NaN','239','1281','720.5'])assert.throws(()=>watchOptions(['BVtest','--tile='+v],'default'))
})
test('custom DSH_HOME is used by deps, notify and selftest without touching default .dsh',t=>{
  const f=fixture(t),dsh=path.join(f.dir,'custom-dsh');fs.mkdirSync(dsh)
  const env={...process.env,USERPROFILE:f.dir,HOME:f.dir,DSH_HOME:dsh,DSH_NODE:process.execPath,BILI_WHALE_CONFIG:'',NODE_OPTIONS:''}
  fs.writeFileSync(path.join(dsh,'bili-whale.config.json'),JSON.stringify({night:{windows:[{start:'20:00',end:'24:00'}]},notify:{type:'file'}}))
  fs.writeFileSync(path.join(dsh,'whale-night.json'),JSON.stringify({action:'wake',atMs:Date.now()+3600000}))
  const cli=fileURLToPath(new URL('../tools/bili.mjs',import.meta.url))
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',timeout:30000})
  const deps=run('deps','--json');assert.equal(deps.error,undefined)
  assert.equal(JSON.parse(deps.stdout).items.find(i=>i.name==='生物钟').ok,true)
  const notice=run('notify','local path test');assert.equal(notice.status,0,notice.stderr)
  assert.match(fs.readFileSync(path.join(dsh,'whale-notify.log'),'utf8'),/local path test/)
  const self=run('selftest');assert.equal(self.error,undefined)
  assert.ok(self.stdout.split('\n').some(line=>line.includes('目录 DSH_HOME')&&line.includes(dsh)&&line.includes('✓')),self.stdout)
  assert.equal(fs.existsSync(path.join(f.dir,'.dsh')),false)
})
