import fs from 'node:fs'
globalThis.fetch=async(url,options={})=>{
  const u=String(url); fs.appendFileSync(process.env.TEST_REQUESTS,JSON.stringify({url:u,method:options.method??'GET'})+'\n')
  let data
  if(u.includes('/nav'))data={code:0,data:{isLogin:true,mid:111,uname:'Test'}}
  else if(u.includes('/relation'))data={code:0,data:{attribute:Number(process.env.TEST_RELATION??6),...(process.env.TEST_BE_RELATION == null ? {} : {be_relation:{attribute:Number(process.env.TEST_BE_RELATION)}})}}
  else if(u.includes('/send_msg'))data={code:Number(process.env.TEST_DM_CODE??0),data:{}}
  else if(u.includes('/reply/del'))data={code:-403,message:'forbidden'}
  else if(u.includes('/reply/add'))data={code:0,data:{rpid_str:'123'}}
  else if(u.includes('/wbi/search/type'))data={code:0,data:{result:[]}}
  else throw Error('Unexpected test network: '+u)
  return {status:200,ok:true,json:async()=>data}
}
