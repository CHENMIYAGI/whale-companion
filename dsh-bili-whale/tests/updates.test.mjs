import test from 'node:test'
import { wakePrompt } from '../lib/scheduler.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveWorkDir } from '../lib/work-dir.js'
import { resolveRuntime, probeRuntime } from '../tools/lib/runtime.mjs'
import { execFileSync } from '../tools/lib/capture.mjs'
import { makePlan, completePlan, historyOf } from '../tools/lib/night-plan.mjs'
import { newReplies } from '../tools/lib/feedback.mjs'
import { mentionSummaryLines } from '../lib/mention-summary.js'
import { translateNamed } from '../tools/lib/cli-args.mjs'
const temp = t => { const p=fs.mkdtempSync(path.join(os.tmpdir(),'whale-updates-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p }
test('issue 5: named positional arguments keep unrelated valued/boolean flags',()=>{
  assert.deepEqual(translateNamed('recon',['--bvid','BV1234567890','--ps','5','--json']),['BV1234567890','--ps','5','--json'])
  assert.deepEqual(translateNamed('search',['--page','2','--kw','猫','--json']),['猫','2','--json'])
  assert.deepEqual(translateNamed('recon',['BV1234567890','--ps','5']),['BV1234567890','--ps','5'])
})
test('issue 10: summary requires opt-in, owner mention and explicit request',()=>{
  const cfg={owner:{mid:'222'},listen:{mentionSummary:true}}
  const item={kind:'at',mid:'222',source:'请总结这个视频',uri:'https://www.bilibili.com/video/BV1234567890'}
  assert.equal(mentionSummaryLines({},[item]).length,0)
  assert.equal(mentionSummaryLines(cfg,[{...item,mid:'999'}]).length,0)
  assert.equal(mentionSummaryLines(cfg,[{...item,kind:'reply'}]).length,0)
  assert.equal(mentionSummaryLines(cfg,[{...item,source:'你好'}]).length,0)
  assert.match(mentionSummaryLines(cfg,[item]).join('\n'),/notify/)
})
test('issue 11/PR 13: configurable existing directory, invalid values fall back', t=>{
  const dir=temp(t), fallback=path.join(dir,'default'), file=path.join(dir,'file');fs.writeFileSync(file,'x')
  assert.equal(resolveWorkDir(dir,fallback),fs.realpathSync(dir))
  let warnings=0
  for(const v of ['relative',file,path.join(dir,'absent'),42,{}])assert.equal(resolveWorkDir(v,fallback,()=>warnings++),fallback)
  for(const v of ['',null,undefined])resolveWorkDir(v,fallback,()=>warnings++)
  assert.equal(warnings,5)
})
test('PR 12: resolve real node from PATH and verify execution', t=>{
  const dir=temp(t)
  const r=resolveRuntime(dir,{env:{PATH:path.dirname(process.execPath)},home:dir})
  assert.equal(r.file,process.execPath);assert.equal(probeRuntime(r.file,r.env),true)
})
test('PR 12: Electron fallback requires proof and node environment', t=>{
  const dir=temp(t), calls=[]
  const opts={home:dir,env:{PATH:''},platform:'linux',electron:true,execPath:'/mock/electron',probe:(p,e)=>{calls.push([p,e]);return e.ELECTRON_RUN_AS_NODE==='1'}}
  const r=resolveRuntime(dir,opts);assert.equal(r.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(calls.length,1)
  assert.throws(()=>resolveRuntime(dir,{...opts,probe:()=>false}),/node/)
})

test('PR 12: desktop-provided runtime is verified even without PATH', t=>{
 const dir=temp(t), calls=[]
 const r=resolveRuntime(dir,{home:dir,env:{PATH:'',DSH_DESKTOP_NODE_EXECUTABLE:process.execPath},probe:(p)=>{calls.push(p);return true}})
 assert.equal(r.file,process.execPath);assert.deepEqual(calls,[process.execPath])
})
test('PR 3: file capture preserves stdout, error status and stderr',()=>{
  assert.equal(execFileSync(process.execPath,['-e','process.stdout.write("hello")'],{encoding:'utf8'}),'hello')
  assert.throws(()=>execFileSync(process.execPath,['-e','process.stdout.write("out");process.stderr.write("err");process.exit(7)']),e=>e.status===7&&String(e.stdout)==='out'&&String(e.stderr)==='err')
})
test('minimum gap survives reconfiguration, done state and subsequent ticks',()=>{
  const now=new Date('2026-10-22T10:00:00').getTime()
  const cfg={windows:[{start:'10:00',end:'10:05',wakes:3}],skipChance:0,minGapMin:10}
  let state=completePlan(makePlan(cfg,{},now,()=>0),now)
  state=historyOf(state,now+60000)
  state=makePlan(cfg,state,now+60000,()=>0)
  assert.equal(state.action,'done')
  assert.equal(makePlan(cfg,state,now+120000,()=>0).action,'done')
  const longer={...cfg,windows:[{start:'10:00',end:'11:00',wakes:3}]}
  assert.ok(makePlan(longer,state,now+120000,()=>0).atMs>=now+600000)
})
test('invalid minimum gap cannot persist a NaN plan',()=>{
  const now=new Date('2026-10-22T10:00:00').getTime()
  const st=makePlan({windows:[{start:'10:00',end:'11:00',wakes:2}],minGapMin:'invalid'}, {},now,()=>0)
  assert.ok(Number.isFinite(st.atMs))
})
test('issue 17: early morning selects morning window, future windows never execute early',()=>{
  const cfg={windows:[{start:'18:00',end:'24:00',wakes:3},{start:'0:00',end:'8:00',wakes:3}]}
  const st=makePlan(cfg,{},new Date('2026-10-22T02:38:00').getTime(),()=>0)
  assert.equal(st.window,'0:00–8:00')
  const future=makePlan(cfg,{},new Date('2026-10-22T09:00:00').getTime(),()=>0)
  assert.ok(future.atMs>=future.startsAt)
})
test('issue 14: shrinking/reordered results and same-second replies are deduplicated',()=>{
  const now=Date.now(), time=new Date(now-3600000).toISOString()
  const a={id:'a',kind:'reply',time}, b={id:'b',kind:'reply',time}
  const first=newReplies([a,b],{},now), fb={replyIds:first.ids,lastReplyTime:first.time}
  assert.equal(newReplies([b],fb,now).fresh.length,0)
  assert.equal(newReplies([b,a],fb,now).fresh.length,0)
  assert.equal(newReplies([{...a,id:'c'}],fb,now).fresh.length,1)
  assert.equal(newReplies([{...a,id:'old',time:new Date(now-7200000).toISOString()}],fb,now).fresh.length,0)
})

test('wake prompt follows night.maxVideos instead of a hard-coded 5',()=>{
  const st={date:'2026-10-22',n:12}
  for(const mv of [1,3,5]){
    const lines=wakePrompt(st,'',mv).split(/\r?\n/)
    const line=lines.find((l)=>l.includes('feed 选题'))
    assert.ok(line, '提示里应该有 feed 选题 这一行')
    assert.match(line,new RegExp('≤'+mv+' 条'),'maxVideos='+mv+' 时应显示 ≤'+mv+' 条，实际：'+line)
  }
  // 不传就按 5（向后兼容 ✓）
  assert.match(wakePrompt(st,''),/≤5 条/)
})

test('wake prompt states the current share.via and only that route',()=>{
  const st={date:'2026-10-22',n:12}
  const viaComment=wakePrompt(st,'',5,'comment')
  assert.match(viaComment,/share.via = comment/)
  assert.match(viaComment,/走【评论区 @】/)
  assert.match(viaComment,/不要走私信/)
  const viaDm=wakePrompt(st,'',5,'dm')
  assert.match(viaDm,/share.via = dm/)
  assert.match(viaDm,/走【私信】/)
  assert.match(viaDm,/不要在评论区 @ 他/)
  assert.match(viaDm,/必须带 --share/)
  assert.doesNotMatch(viaComment,/必须带 --share/)
})

test('share.enabled=false with the companion installed: tell the owner on the pet, skip 7.5',async t=>{
  const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path')
  const { companionPrompt } = await import('../lib/companion.js')
  const dsh=fs.mkdtempSync(path.join(os.tmpdir(),'bili-whale-share-off-'))
  t.after(()=>fs.rmSync(dsh,{recursive:true,force:true}))
  const st={date:'2026-10-26',n:1}

  // 没装桌宠：分享关了也照原样（原项目行为不变）
  const noPet=wakePrompt(st,'',5,'comment',false,dsh)
  assert.equal(noPet,wakePrompt(st,'',5,'comment',true,dsh))

  fs.mkdirSync(path.join(dsh,'companion'))
  for(const via of ['comment','dm']){
    const off=wakePrompt(st,'',5,via,false,dsh)
    assert.match(off,/share\.enabled = false/)
    assert.match(off,/不要在 B 站发言/)
    assert.match(off,/companion say "<为什么想给他看>" --kind share --bv <BV>/)
    assert.doesNotMatch(off,/走【评论区 @】|走【私信】|comment --share|dm --msg/)
    assert.doesNotMatch(off,/7\.5\)|quota react --auto/)
    assert.match(off,/6\) 写两本日记/)
    assert.match(off,/7\) `comment-digest/)
  }
  // 开着：和以前一样
  const on=wakePrompt(st,'',5,'comment',true,dsh)
  assert.match(on,/走【评论区 @】/)
  assert.match(on,/7\.5\) `quota react --auto --hours 48`/)
  assert.doesNotMatch(on,/--kind share/)
  // 默认（不传）= 开着
  assert.equal(wakePrompt(st,'',5,'comment',undefined,dsh),on)

  // 桌宠叫醒（wake-random）也跟着开关走
  const woke=companionPrompt({kind:'wake-random'},{wakePrompt:(s,p,mv,via,en)=>wakePrompt(s,p,mv,via,en,dsh),shareVia:'comment',shareEnabled:false})
  assert.match(woke,/--kind share/)
  assert.doesNotMatch(woke,/quota react --auto/)
})
