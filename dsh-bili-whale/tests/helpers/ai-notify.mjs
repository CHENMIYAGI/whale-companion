import fs from 'node:fs'
fs.appendFileSync(process.env.TEST_ALERT_LOG,JSON.stringify({text:process.argv.at(-1)})+'\n')
