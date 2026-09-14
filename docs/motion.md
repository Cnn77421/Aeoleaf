# Motion

## 已核对的参考源码（2026-09-13）

浏览器读取 Playful Ground 的 script 标签及 pageAssets 实际加载资源清单，再下载对应公开 bundle 阅读；没有依赖源码映射或私人接口。文件摘要见 `motion-source-manifest.json`。

- `app/layout-f1f7170233819229.js`：SmoothCursor 使用位置弹簧 stiffness 650 / damping 45 / mass 1，旋转 300 / 60，缩放 500 / 35；积分步长上限 8ms，总 delta 上限 64ms。速度阈值 0.1px/ms，移动缩放 0.95，停止 150ms 后回到 1，交互目标缩放 1.4。
- `1532-35d31c5d9d3805f9.js` + 上述 layout：DOM overlay 出场 0.8s power3.inOut，scaleY 0→1、scaleX 1→1.5；路由完成后从底部收起 1s；内容延迟 0.6s、持续 0.8s、stagger 0.05s。不是全站统一的图片 shared-element transition。
- `app/(main)/lab/page-796aad7847e62d2d.js`：Three.js 鼠标坐标归一化为 -1→1，图像平面每帧向鼠标偏移目标插值 0.03；作品纹理切换 uniform progress 持续 1100ms power1.inOut，通过 transition texture 的阈值和 smoothstep 混合两张纹理。模型旋转 1000ms power2.inOut。
- `9798.b46e214a50eae1f9.js`：首页是原生 WebGL 流体，包含 velocity、divergence、pressure、advection 及 distortion shader；半分辨率渲染，advection dissipation 基础值 0.96。不是 Three.js 图片位移。
- `5720-410153a47a2e857f.js`：当前版本显示 LOADING 字符，没有数字 0→100；600ms 模拟 ready，文字最少显示 1600ms，退出时间配置 2000ms。首次音效选择后还有 2s/3s 双层 WebGL 噪声揭幕。
- `app/(main)/page-09447cd576ecded5.js`：scrollY / (scrollHeight - innerHeight)，scroll 回调 debounce 10ms；超过 100px 且小于 100% 显示，描边 CSS 100ms ease-out。
- `app/(main)/layout-ca3c5d4d61621804.js`：Lenis duration 1.2s，指数 easing，wheelMultiplier 1.3，独立 RAF。

以上路径均位于 https://playfulground.work/_next/static/chunks/ 。

## Aeoleaf 实现与差异

沿用 Express/EJS/PJAX，不引入 React、GSAP、Three.js 或 Lenis。鼠标弹簧沿用已核对的参数；hover 插值按帧时间折算 0.03。Web Animations 使用采样的分段四次曲线匹配 power3.inOut，导航遮罩 800ms→替换内容→1000ms，内容交叠揭示。图片克隆从卡片实际矩形扩大，再收敛到详情图片矩形；无有效图片或手机使用遮罩。

Loader 按最新要求改为参考站的黑底白字 LOADING + 24px 圆环，去掉品牌、说明、大数字和横条。字母 24px、左右各 5px，入场 blur 10px→0 / y .4em→0，1400ms、逐字间隔 70ms；退场 blur 0→8px / y 0→-.4em，1500ms、逐字间隔 60ms；背景延迟 900ms 后淡出 1600ms。最后一个字母入场完成（1820ms）后才允许退场。进度仅用于圆环和无障碍属性：首屏图片 decode 和 fonts.ready 按项计数，加 1600ms 最小节奏及指数平滑，6000ms 超时放行；内部进度单调 0→100，sessionStorage 避免同一会话重复。不是参考站的真实下载字节计数。按最新要求移除首页 WebGL 路径染色拖尾，保留光标惯性和图片 hover；未复刻完整压力求解或 Lab 的 Three.js 场景；滚动保留浏览器原生行为，仅平滑进度反馈。

motion 只有一个按需 RAF，静止休眠，隐藏页暂停；动画统一取消并释放 clone/overlay，恢复 inert 和滚动锁。PJAX 等待退场和样式后替换内容，网络错误清理后回退整页导航。返回恢复列表滚动位置，切换期间的 popstate 排队处理。动态 reduced-motion 立即清理动画；手机关闭鼠标反馈。

## 验证

`QA_MOTION_ONLY=1 QA_BROWSER_CHANNEL=msedge node scripts/frontend-v2-qa.js`：在临时应用、数据库和上传目录运行 `motion-browser-checks.js`。Playwright 为可选测试依赖，未加入应用运行依赖。Windows 可用环境变量 NODE_PATH 指向本机已安装 Playwright 的包目录。

报告在 `motion-qa/report.json`：1440px / 390px、首次 Loader（仅 LOADING 文案、黑底与圆环）、慢速/快速移动及停止、hover、图片切换、详情、返回、连续三轮进出、快速滚动、深色主题、切换中启用 reduced-motion、重复访问以及单 RAF 检查。帧间隔仅代表当前自动化环境，不等同于真实手机 GPU 性能承诺。

`frontend-regression/report.json`：272 个页面/尺寸/主题组合，文章、作品、搜索、后台登录和编辑发布、上传、留言审核等回归。所有写操作仅操作临时测试数据。

## 本次修复记录

- 首帧 RAF 时间戳早于 Loader 初始化时间会产生负进度：钳制时间比例并保证进度单调。
- 仅裁剪全屏图片会在第一帧改变图片构图：改为实际图片矩形扩展。
- WAAPI 完成即 cancel 会让遮罩在内容揭示结束前跳回初态：保留场景终态，统一清理。
- motion 使用旧主题变量导致深色主题出现白色遮罩：改用当前 tokens。
- PJAX 样式顺序与首次加载不一致：使用 motion 样式作为插入锚点，并识别 minified 路径。
