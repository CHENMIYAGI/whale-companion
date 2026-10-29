import fs from 'node:fs'
globalThis.fetch=async (input,options={})=>{
 const url=String(input)
 fs.appendFileSync(process.env.TEST_REQUESTS,JSON.stringify({url,method:options.method??'GET'})+'\n')
 if(!url.includes('/x/v2/reply/del'))throw Error('Unexpected fixture request')
 return new Response('{"code":0,"data":{}}',{headers:{'content-type':'application/json'}})
}
