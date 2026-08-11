# 即梦中转站

个人 AI 图像/视频生成中转服务。他人提交提示词，你的即梦账号自动生成并返回结果，账号资产不外泄。

## 一键部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/oxenoxo/jimeng-relay)

1. 点击上方按钮，用 GitHub 登录 Render
2. 在环境变量中填入 `JIMENG_TOKEN` = 你的即梦 sessionid
3. 点击 **Deploy**，3 分钟后获得公开链接

> 即梦 sessionid 获取：打开 jimeng.jianying.com → F12 → Application → Cookies → sessionid

## 本地运行

```bash
cp .env.example .env   # 编辑填入 JIMENG_TOKEN
npm install
npm start
# 打开 http://localhost:3456
```
