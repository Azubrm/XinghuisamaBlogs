# GitHub Pages 部署

博客前台部署到 https://azubrm.github.io/XinghuisamaBlogs/ 。

首次发布需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
如果这是刚 fork 的仓库，并且 Actions 页面提示工作流已禁用，请点击 **I understand my workflows, go ahead and enable them**。
之后每次更新 `main` 分支中的 `XHBlogs` 内容，都会自动构建并发布。
也可以在 Actions 的 **Deploy blog to GitHub Pages** 页面点击 **Run workflow**。

## 本地构建

需要 Node.js 24。进入 `XHBlogs`，运行 `npm ci`，然后运行 `npm run build:pages`。
结果位于 `XHBlogs/out`。默认路径前缀是 `/XinghuisamaBlogs`，可以用环境变量 `NEXT_PUBLIC_BASE_PATH` 覆盖；部署到用户根站点或自己的域名时应使用空字符串。
调整 Pages 的网址时，需要同时调整工作流中的该变量并重新构建。

## 功能说明

- 首页、文章、杂谈、相册、关于、时间线等页面在构建时生成，新增内容后重新发布即可。
- 音乐列表在构建时生成 `music.json`，访客通过网易云的公开播放地址听歌。歌曲能否播放取决于网易云的版权和服务状态。
- 猫猫保留抚摸、喂食和固定语录；AI 对话需要独立的服务器，Pages 模式关闭该入口。
- Pages 模式不启用需要服务端 OAuth 代理的 Gitalk 评论。当前模板也未配置评论账号。
- 天气组件在静态模式下只显示明确标注的模拟数据。
- 导出产物排除模板作者的 `CNAME`，避免绑定 `www.xinghuisama.top`。
- 作者的示例文章、个人资料和外链图片仍保留在模板中，可通过本地控制台或修改源码替换。

`npm run build` 和 `npm run dev` 仍采用原来的服务器模式。
Pages 构建会暂时把 `app/api` 改为 Next.js 私有目录 `app/_api`，结束后恢复。
如果构建被强制终止导致目录未恢复，应先把 `app/_api` 改回 `app/api` 再重试。
保留原项目的许可与署名，使用须遵循仓库的 CC BY-NC 4.0 许可。
