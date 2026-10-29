// 待机小动作的排班：每隔 every[0]～every[1] 分钟（随机）播一段小动作，不连着两次一样。
// 小动作只播一次（pet.js 的 play 里 show(名字, false)），播完回到普通待机的循环。
//
// pet.html 先加载这个文件、pet.js 再用 createIdleExtras；
// test/idle-extras.test.mjs 用假时钟直接跑这个文件（模拟待机 10 分钟），所以这里不碰页面上的东西。
// eslint-disable-next-line no-unused-vars
function createIdleExtras({ list, every = [3, 8], canPlay, play, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let last = null   // 上一次播的小动作
  let gap = every   // [最少, 最多] 分钟

  function schedule() {
    clearTimer(timer)
    const [min, max] = gap
    timer = setTimer(() => {
      // 能播才播（在待机、没在拖、主人不忙）；不能播就等下一次，不补
      if (canPlay()) {
        const choices = list.filter((x) => x !== last)   // 刚播过的这次不选
        const extra = choices[Math.floor(random() * choices.length)]
        last = extra
        play(extra)
      }
      schedule()
    }, (min + random() * (max - min)) * 60000)   // 分钟 → 毫秒
  }

  schedule()
  return {
    /** 设置里改了间隔：变了才重新计时 */
    setEvery(e) {
      if (!Array.isArray(e) || e.join() === gap.join()) return
      gap = e
      schedule()
    },
    stop() { clearTimer(timer); timer = null },
    last: () => last,
  }
}
