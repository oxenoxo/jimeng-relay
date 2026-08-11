# 即梦中转站

个人 AI 图像/视频生成中转服务。他人提交提示词，你的即梦账号自动生成并返回结果，账号资产不外泄。

## 部署 (Render.com)

1. Fork 本仓库
2. 在 [Render](https://render.com) 创建 **Web Service**，连接仓库
3. Build Command: `npm install`
4. Start Command: `npm start`
5. 添加环境变量 `JIMENG_TOKEN` = 你的即梦 sessionid
6. 部署完成，获得公开链接

## 本地运行

```bash
cp .env.example .env   # 编辑填入 JIMENG_TOKEN
npm install
npm start
# 打开 http://localhost:3456
```
