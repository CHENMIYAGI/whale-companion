import test from 'node:test'
import assert from 'node:assert/strict'
import { makePlan, completePlan, historyOf, inWindow, maxWakes } from '../tools/lib/night-plan.mjs'
import { validateShare } from '../tools/lib/share-policy.mjs'
const time = s => new Date('2026-10-' + s).getTime()
const cfg = (windows, skipChance = 0) => ({windows, skipChance})
const night = cfg([{start:'23:00',end:'01:00',wakes:1}])
const random = (...values) => () => values.shift() ?? 0.5
test('next-day 00:30 remains next-day 00:30', () => {
  const p=makePlan(night,{},time('21T22:00:00'),random(.75,.9))
  assert.equal(p.atMs,time('22T00:30:00'))
})
test('pending skip is stable without any further random draws', () => {
  const c=cfg([{start:'20:00',end:'24:00',wakes:1}],.3)
  const p=makePlan(c,{},time('21T20:00:00'),random(.5,.1))
  assert.equal(p.action,'skip')
  assert.deepEqual(makePlan(c,p,time('21T20:01:00'),()=>{throw Error('rerolled')}),p)
})
test('pending plan survives restart and midnight', () => {
  const p=makePlan(night,{},time('21T22:00:00'),random(.75,.9))
  assert.deepEqual(makePlan(night,JSON.parse(JSON.stringify(p)),time('22T00:01:00')),p)
})
test('sort by actual deadline at 00:30', () => {
  const c=cfg([...night.windows,{start:'02:00',end:'03:00',wakes:1}])
  const p=makePlan(c,{},time('21T00:30:00'),random(.5,.9))
  assert.equal(p.window,'23:00–01:00');assert.equal(p.endsAt,time('21T01:00:00'))
})
test('all skipped occurrences stay excluded after state saves', () => {
  const c=cfg([{start:'20:00',end:'24:00',wakes:1},{start:'20:00',end:'23:00',wakes:1}],1)
  const now=time('21T20:00:00')
  const first=completePlan(makePlan(c,{},now,()=>0),now)
  const second=completePlan(makePlan(c,first,now,()=>0),now)
  assert.notEqual(first.windowKey,second.windowKey)
  assert.equal(makePlan(c,historyOf(second,now),now).action,'done')
  // 2026-10-22：skip 改成消耗机会（不再拉黑窗口）→ 断言"两个窗口都消耗了"而不是黑名单长度
  assert.equal(Object.keys(second.usedCount).length,2)
  assert.equal(Object.values(second.usedCount).reduce((a,b)=>a+b,0),2)
})
test('one dated window cannot wake again after midnight', () => {
  const p=makePlan(night,{},time('21T23:10:00'),()=>0)
  const done=completePlan(p,time('21T23:10:00'))
  const next=makePlan(night,done,time('22T00:10:00'),()=>0)
  assert.equal(next.startsAt,time('22T23:00:00'))
})
test('completion consumes quota, planning and reconfiguration do not', () => {
  const c=cfg([{start:'20:00',end:'24:00',wakes:2}]),now=time('21T20:00:00')
  const p=makePlan(c,{},now,()=>0)
  assert.deepEqual(p.usedCount,{})
  const done=completePlan(p,now)
  assert.equal(done.usedCount[p.windowKey],1)
  const next=makePlan(c,historyOf(done,now),now,()=>0)
  assert.equal(next.withinWindow,'20:00–24:00 第 2/2 次')
  assert.equal(makePlan(c,completePlan(next,now),now).action,'done')
  assert.deepEqual(completePlan(done,now),done)
})
test('zero wakes stays disabled', () => {
  const c=cfg([{start:'20:00',end:'24:00',wakes:0}]);assert.equal(maxWakes(c),0)
  assert.equal(makePlan(c,{},time('21T20:00:00')).action,'done')
})
test('expired plans are never delivered outside their window', () => {
  const c=cfg([{start:'20:00',end:'21:00',wakes:1}])
  const p=makePlan(c,{},time('21T20:00:00'),()=>0)
  assert.equal(makePlan(c,p,time('21T21:00:00')).action,'done')
})
test('new day schedules normally after yesterday done', () => {
  const c=cfg([{start:'20:00',end:'21:00',wakes:1}])
  const old=makePlan(c,{},time('21T22:00:00'))
  assert.equal(makePlan(c,old,time('22T19:00:00')).action,'wake')
})
test('migrate old skip and reserved wake history', () => {
  const now=time('21T20:00:00')
  const h=historyOf({date:'2026-10-21',action:'skip',fired:true,window:'20:00–24:00',usedCount:{}},now)
  assert.deepEqual(h.skippedWindows,['2026-10-21|20:00–24:00'])
  const w=historyOf({date:'2026-10-21',action:'wake',window:'20:00–24:00',usedCount:{'20:00–24:00':1}},now)
  assert.equal(w.usedCount['2026-10-21|20:00–24:00'],0)
})
test('overnight comment window includes both sides and excludes end', () => {
  for(const t of ['21T23:00:00','22T00:30:00'])assert.equal(inWindow(night,time(t)),true)
  for(const t of ['21T22:59:00','22T01:00:00'])assert.equal(inWindow(night,time(t)),false)
})
test('share policy enforces switch, score, reason and rank for both transports', () => {
  const good={reason:'这是值得分享的内容',score:15,rank:1}
  assert.doesNotThrow(()=>validateShare({},good))
  assert.throws(()=>validateShare({share:{enabled:false}},good))
  for(const patch of [{score:undefined},{score:true},{score:21},{score:12},{reason:'短'},{rank:2}])
    assert.throws(()=>validateShare({}, {...good,...patch}))
})

test('skip 只消耗一次机会，wakes>1 的窗口不会被整段作废', () => {
  // 2026-10-22 实测（她连报三次的那个）：窗口 03:47–04:10 wakes:5，
  // 掷到不看之后整个窗口被拉黑 → 只醒 1 次就 done ✗
  const c = cfg([{ start: '20:00', end: '24:00', wakes: 5 }], 0)   // skipChance=0 先都不看
  const now = time('21T20:00:00')
  // 第一条：把 skipChance 调成必跳过，拿一个 skip 计划
  const skipCfg = { ...c, skipChance: 1 }
  const p1 = makePlan(skipCfg, {}, now, () => 0)
  assert.equal(p1.action, 'skip')
  const after = completePlan(p1, now + 60_000)
  assert.equal(after.usedCount[p1.windowKey], 1, 'skip 应占掉一次机会')
  assert.equal(after.skippedWindows.length, 0, '不该把窗口拉黑')
  // 第二条：同一个窗口还能继续排（还剩 4 次机会）
  const p2 = makePlan(c, after, now + 11 * 60_000, () => 0)
  assert.equal(p2.action, 'wake')
  assert.equal(p2.windowKey, p1.windowKey)
  assert.match(p2.withinWindow, /第 2\/5 次/)
})
