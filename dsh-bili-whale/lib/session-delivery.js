import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { hasCompanion } from './companion.js'
import { ownerViewRewriteText } from '../tools/lib/owner-view.mjs'

// 交接信（2026-10-27 主人要的）：换会话前旧会话里的她写给新会话里的自己
export function letterRequest(file) {
  return [
    '',
    '【交接】这个会话快要换新的了 —— 新会话里的你不记得这里聊过的细节。做完上面的事以后，写一封「给下一个自己的信」，',
    `用你的文件工具存到：${file}`,
    '信里写：最近和主人之间的事、你现在的心情、在追的事（想看的、想说还没说的）、你们之间的梗、最近说话的感觉（语气、口头禅）。',
    '用你自己的口吻写给自己看，几百字就好；不要写账号、cookie、密码这类东西。',
    ownerViewRewriteText() + '。',
    '写完这一轮就收工。',
  ].join('\n')
}

/** 换完后第一次投递时加在最前面的几行：读信（有的话）→ 最近 30 条桌宠聊天（装了桌宠的话） */
export function handoffLines(dshHome, handoff = {}) {
  const lines = []
  let wrote = false
  try { wrote = !!handoff?.letterFile && fs.statSync(handoff.letterFile).size > 0 && fs.statSync(handoff.letterFile).mtimeMs >= (handoff.askedAt ?? 0) } catch {}
  lines.push(wrote
    ? `【新会话】先读上一个你留下的信：${handoff.letterFile}`
    : '【新会话】上一个你没来得及留下交接信（正常，不用追查），从回忆和日记里接上就好。')
  if (hasCompanion(dshHome)) lines.push('再看最近 30 条桌宠里的聊天：`node bili.mjs companion chat-recent --n 30`')
  return lines
}

// One queue owns session selection and persona acknowledgement for all channels.
export function createSessionDelivery({controller,dshHome,cwd,sessionId,config,persona,isBusy=()=>false,now=Date.now,log=()=>{},onSession=()=>{}}) {
  const file=path.join(dshHome,'whale-session.json')
  let state={id:sessionId,startedAt:now()},ready=false,tail=Promise.resolve(),lastDelivered=0
  // 2026-10-24：进程启动后有没有投递过 —— 用来做「重启后首次必注入人设」
  //   因为 DSH 的 create() 返回 { sessionId, agentPreset? }，分不出"新建"还是"复用" ✗
  let booted=false
  try {
    const saved=JSON.parse(fs.readFileSync(file,'utf8'))
    if(typeof saved.id!=='string'||!saved.id||!Number.isFinite(saved.startedAt)||saved.startedAt<0)throw Error('invalid state')
    state=saved
  } catch(e) { if(e.code!=='ENOENT')throw Error('会话状态损坏，请检查 whale-session.json，避免误建会话') }
  onSession(state.id)
  lastDelivered=Number.isFinite(state.deliveredAt)?state.deliveredAt:0
  function save(next) {
    fs.mkdirSync(dshHome,{recursive:true})
    const tmp=file+'.'+crypto.randomUUID()+'.tmp'
    try {fs.writeFileSync(tmp,JSON.stringify(next));fs.renameSync(tmp,file)} finally {fs.rmSync(tmp,{force:true})}
  }
  return {
    send(request,signal) {
      const job=tail.then(async()=>{
        signal?.throwIfAborted()
        const cfg=config(),days=Number(cfg.sessionRotateDays??0),once=cfg.personaOncePerSession===true
        const persist=once||(Number.isFinite(days)&&days>0)
        const due=Number.isFinite(days)&&days>0&&now()-state.startedAt>=days*86400000&&now()-lastDelivered>=8*60000&&!isBusy()
        // 2026-10-27：换会话前先让旧会话里的她写交接信 —— 分两步：
        //   ① 到期后的第一次投递还进旧会话，末尾加「写信」这一步（askLetter）
        //   ② 下一次投递（她写完了：照样要隔 8 分钟、不忙）才真的换；新会话第一次先读信
        // 写信请求送不到（旧会话坏了）也记成"问过了"，下一次照常换 —— 写信失败不能卡住轮换
        const askLetter=due&&!state.letterAskedAt
        const rotating=due&&!askLetter
        const next=rotating?{id:crypto.randomUUID(),startedAt:now(),rotatedFrom:state.id,handoff:{letterFile:state.letterFile,askedAt:state.letterAskedAt}}:state
        let created = null
        if(!ready||rotating) {
          try {created = await controller.create({sessionId:next.id,cwd})}
          catch(e) {if(rotating)throw e;log('沿用现有会话；若投递失败将保留重试状态')}
        }
        // 2026-10-24 修第二版（审查报告第 3 条 + 复审）：
        //   上一版想靠 create() 的返回字段判断"是不是新建会话" ✗
        //   但 DSH 的 sessionController.create 返回的是 { sessionId, agentPreset? }
        //   —— 根本没有 created / fresh 这种布尔 ✗ 那段判断永远为假 ✗
        //   （而且注释写着"拿不到信号就往多注入那边靠"，代码却继续跳过 ✗ 自相矛盾）
        //
        // 现在的做法：接口分不出来就不分 ✗
        //   每次【进程启动后的第一次投递】都重新注入完整人设 + 日记恢复指引 ✓
        //   之后同一会话内按 personaIHash 去重 ✓
        //   代价：每次重启多重注入一次人设（~1000 字）✓ 换来"她不会重启后失忆"✓
        //   只开 personaIze 开关时才这样；关着的时候每条都注入，和以前一样 ✓
        const bootFirst = !booted
        if(persist)save(next)
        if(rotating)log(`会话轮换：${state.id} → ${next.id}；旧会话保留`)
        state=next;ready=true;onSession(state.id)
        signal?.throwIfAborted()
        const block=persona(),fingerprint=crypto.createHash('sha256').update(block).digest('hex')
        const include=!once||bootFirst||state.personaHash!==fingerprint
        const reminder=`人设依据：${path.join(process.env.USERPROFILE||process.env.HOME||'.','.bili-ai/persona.md')}；上下文缺失时重读。`
        // 2026-10-27：只读「回忆」+ 最近 7 天的日记（memories recall），更早的在归档里，要查再查
        const diary=`先恢复记忆：跑 \`node bili.mjs memories recall\`，读「回忆」（${path.join(dshHome,'whale-memories.md')}）和最近 7 天的日记（${path.join(dshHome,'whale-diary.md')}、${path.join(dshHome,'whale-diary-private.md')}）；不要将旧会话未确认事项当成已完成。`
        // 换完后的第一次：先读上一个自己的信，再看最近 30 条桌宠聊天，再恢复记忆（上面的 diary）
        const handoff=(state.rotatedFrom&&!state.deliveredAt)?handoffLines(dshHome,state.handoff):[]
        const prefix=[include?block:reminder,...handoff,...((!state.deliveredAt||bootFirst)?[diary]:[])].filter(Boolean).join('\n')
        const content=[...(request.content??[])]
        if(content[0]?.type==='text')content[0]={...content[0],text:prefix+'\n'+content[0].text}
        else content.unshift({type:'text',text:prefix})
        let letterFile=null
        if(askLetter) {
          letterFile=path.join(dshHome,'whale-letters',`${new Date(now()).toLocaleDateString('sv-SE')}-${String(state.id).slice(0,8)}.md`)
          content.push({type:'text',text:letterRequest(letterFile)})
        }
        try {await controller.prompt({...request,sessionId:state.id,content},signal)}
        catch(e) {
          ready=false
          if(askLetter) {
            // 旧会话连写信请求都收不到：记成问过了（没信），下一次直接换会话
            state={...state,letterAskedAt:now(),letterFile:null}
            if(persist)try {save(state)} catch {}
            log('交接信请求没送到旧会话：下次投递直接换会话（没有信）')
          }
          throw e
        }
        if(askLetter) {state={...state,letterAskedAt:now(),letterFile};log(`会话快到期：已请旧会话里的她写交接信 → ${letterFile}`)}
        booted=true   // 投递成功了才算
        lastDelivered=now()
        state={...state,personaHash:fingerprint,deliveredAt:lastDelivered}
        // Delivery succeeded: persistence failure must not make callers retry it.
        if(persist)try {save(state)} catch(e){log('会话已投递，但保存人设标记失败：'+e.message)}
      })
      tail=job.catch(()=>{})
      return job
    },
  }
}
