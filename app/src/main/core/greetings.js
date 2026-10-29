// 入场 / 退出：固定台词（不调模型）和时间
//
// 入场：桌宠窗口从透明淡入（pet.css 0.8 秒）→ 挥手（anim/talking.webm，原名「点击回应-元气挥手」）+ 气泡
// 退出：挥手 + 气泡 → 淡出（0.6 秒）→ 真正关掉。整个过程最多 3 秒（EXIT_TOTAL_MS）
// 挥手那段视频前 2 秒是站着不动，2 秒左右才抬手，所以从 WAVE_FROM 秒开始播

export const HELLO_LINES = ['我来啦～', '主人好！', '嘿嘿，又见面了']
export const BYE_LINES = ['拜拜～', '下次见！', '我先走啦，记得想我～']

export const WAVE_FROM = 2          // 挥手动画从第几秒开始播（秒）
export const EXIT_WAVE_MS = 1600    // 退出时先挥多久手，再开始淡出
export const EXIT_FADE_MS = 600     // 淡出多久（和 pet.css 的 body.leaving 一样）
export const EXIT_TOTAL_MS = EXIT_WAVE_MS + EXIT_FADE_MS + 100   // 到这时候就真的关（多留 0.1 秒让淡出画完；关窗口本身还要几百毫秒，所以留足余量）

export const pickLine = (list, random = Math.random) => list[Math.floor(random() * list.length)]
