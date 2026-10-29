// 示例插件：周末提醒（最简单的上下文：周末时往系统提示里加一句）
export default {
id :'weekend',
name : 'zm',
setup(api){
api.registerContext({
id :'weekdate',
order :1000,
build :({ now }) =>{
const d = now ?? new Date()
if(d.getDay() ===0||d.getDay() === 6) return `［今天］今天是周末，主人可能比较有空。`
return ``
}
})

}

}
