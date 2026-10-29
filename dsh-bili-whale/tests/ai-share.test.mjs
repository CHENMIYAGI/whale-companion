import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {makeSample,recordAssessment,decision,readAI,writeAI,notifyOnce,cacheComments} from '../tools/lib/ai-share.mjs'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'whale-ai-share-'))
process.env.HOME=process.env.USERPROFILE=home
process.env.DSH_HOME=path.join(home,'.dsh')
process.env.BILI_WHALE_CONFIG=path.join(home,'.dsh/bili-whale.config.json')
fs.mkdirSync(process.env.DSH_HOME);fs.mkdirSync(path.join(home,'.bili-ai'))
fs.writeFileSync(path.join(home,'.bili-ai/credentials.json'),JSON.stringify({sessdata:'fake',bili_jct:'fake'}))
after(()=>fs.rmSync(home,{recursive:true,force:true}))
const bv='BV1234567890', rows=Array.from({length:40},(_,i)=>({rpid:String(i+1),text:'sample comment '+i}))
function assess(count,ai,uncertain=0) {
 const s=makeSample(bv,'42',rows,count)
 recordAssessment(bv,{sampleId:s.sampleId,labels:s.rows.map((r,i)=>({id:r.id,label:i<ai?'suspected':i<ai+uncertain?'uncertain':'other',reason:'多条评论使用相同自述模型模板'}))})
 return decision(bv,'42')
}
test('deduplicate IDs; insufficient sample is explicit, not a fabricated score',()=>{
 makeSample(bv,'42',[rows[0],rows[0]],20)
 assert.equal(decision(bv,'42').status,'insufficient')
 assert.equal(decision(bv,'42').n,1)
 assert.equal(decision(bv,'99').allow,false)
})
test('borderline samples expand, high ratios block, low ratios allow',()=>{
 // 阈值 2026-10-24 起写死 30%（AI_SUSPECT_THRESHOLD）
 assert.equal(assess(20,7).status,'expand')      // 35%，离 30 只有 5 个百分点
 assert.equal(assess(40,24).status,'blocked')    // 60%
 assert.equal(assess(20,2).status,'allowed')     // 10%
 assert.equal(assess(40,10,20).status,'uncertain') // 25% 但含不确定 75%
})
test('all IDs and labels must match a fresh sample',()=>{
 const s=makeSample(bv,'42',rows,20)
 assert.throws(()=>recordAssessment(bv,{sampleId:'wrong',labels:[]}),/sampleId/)
 assert.throws(()=>recordAssessment(bv,{sampleId:s.sampleId,labels:[]}),/全部/)
 writeAI(bv,'sample',{...s,at:Date.now()-7*3600000})
 assert.equal(decision(bv,'42').allow,false)
})
test('notification dedup and failure retry',async()=>{
 let calls=0
 await assert.rejects(notifyOnce(bv,{reason:'test'},async()=>{throw Error('offline')}))
 assert.equal(readAI(bv,'notice'),null)
 await Promise.all([1,2,3].map(()=>notifyOnce(bv,{reason:'test'},async()=>{calls++})))
 assert.equal(calls,1)
})
const root=fileURLToPath(new URL('../',import.meta.url))
function run(file,args=[]) {
 return spawnSync(process.execPath,[path.join(root,'tools/commands',file+'.mjs'),...args],{encoding:'utf8',timeout:10000,env:{...process.env,TEST_REQUESTS:path.join(home,'requests'),NODE_OPTIONS:'--import='+pathToFileURL(path.join(root,'tests/helpers/mock-fetch.mjs')).href}})
}
test('sample CLI reuses cached comments without network and keeps untrusted content as data',()=>{
 fs.writeFileSync(process.env.BILI_WHALE_CONFIG,JSON.stringify({share:{aiCommentGuard:true,via:'comment'},notify:{type:'none'}}))
 cacheComments(bv,'42','hot',rows.slice(0,20));cacheComments(bv,'42','time',rows.slice(20))
 const r=run('ai-share',['sample',bv]);assert.equal(r.status,0,r.stderr)
 assert.equal(JSON.parse(r.stdout).rows.length,20)
 assert.equal(fs.existsSync(path.join(home,'requests')),false)
})
test('actual comment CLI blocks high AI share before quota or network; dry never notifies',()=>{
 assess(40,35)
 writeAI(bv,'notice',{at:0})
 process.env.TEST_ALERT_LOG=path.join(home,'alerts')
 fs.writeFileSync(process.env.BILI_WHALE_CONFIG,JSON.stringify({owner:{name:'Owner',mid:'222'},share:{enabled:true,via:'comment',aiCommentGuard:true},notify:{type:'command',cmd:process.execPath,args:[path.join(root,'tests/helpers/ai-notify.mjs')]}}))
 const args=['--oid','42','--bvid',bv,'--message','hello','--share','--auto','--reason','这个视频值得认真分享给你','--score','15','--rank','1']
 for(const mode of ['--dry','--go','--go']) {
  const r=run('comment',[...args,mode]);assert.equal(r.status,3,r.stdout+r.stderr);assert.match(r.stderr,/暂缓分享/)
  if(mode==='--dry')assert.equal(fs.existsSync(process.env.TEST_ALERT_LOG),false)
 }
 const alerts=fs.readFileSync(process.env.TEST_ALERT_LOG,'utf8').trim().split('\n')
 assert.equal(alerts.length,1);assert.match(alerts[0],/87.5%/);assert.match(alerts[0],/BV1234567890/)
 assert.equal(fs.existsSync(path.join(home,'requests')),false)
 assert.equal(fs.existsSync(path.join(home,'.bili-ai/quota.json')),false)
})
