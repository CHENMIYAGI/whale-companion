import {createTrafficGuard,RISK_DEFAULTS} from '../../tools/lib/traffic.mjs'
const guard=createTrafficGuard({directory:process.argv[2],settings:()=>({...RISK_DEFAULTS,minGapMs:100}),transport:async()=>{console.log(Date.now());return new Response('{"code":0}',{headers:{'content-type':'application/json'}})}})
await guard.fetch('https://api.bilibili.com/x/test?id='+process.argv[3])
