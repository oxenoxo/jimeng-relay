const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { execFile } = require('child_process');
const { getDb, createTask, getTask, listTasks, getPendingTask, setTaskStatus } = require('./db');

const app = express();
const PORT = process.env.PORT || 3456;
const JIMENG_TOKEN = process.env.JIMENG_TOKEN || '';
const ACCESS_PASSWORD = process.env.JIMENG_ACCESS_PASSWORD || '';
const AUTH_COOKIE = 'jimeng_session';
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const authSessions = new Map();
const failedLogins = new Map();
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const UPLOAD_DIR = path.join(OUTPUT_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { files: 12, fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio)\//i.test(file.mimetype);
    cb(allowed ? null : new Error('仅支持图片、视频和音频素材'), allowed);
  }
});
const POLL_INTERVAL = 3000;

// ---- Express Server ----
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}
function getSession(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  const expires = token && authSessions.get(token);
  if (!expires) return null;
  if (expires < Date.now()) { authSessions.delete(token); return null; }
  return token;
}
function requireAuth(req, res, next) {
  if (getSession(req)) return next();
  res.status(401).json({ error: '需要输入访问密码', code: 'AUTH_REQUIRED' });
}
function clientKey(req) { return req.ip || req.headers['x-forwarded-for'] || 'unknown'; }

app.post('/api/auth/login', (req, res) => {
  const key = clientKey(req);
  const state = failedLogins.get(key) || { count: 0, blockedUntil: 0 };
  if (state.blockedUntil > Date.now()) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
  if (String(req.body?.password || '') !== ACCESS_PASSWORD) {
    state.count += 1;
    if (state.count >= 8) { state.count = 0; state.blockedUntil = Date.now() + 60 * 1000; }
    failedLogins.set(key, state);
    return res.status(401).json({ error: '密码不正确' });
  }
  failedLogins.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  authSessions.set(token, Date.now() + AUTH_TTL_MS);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TTL_MS / 1000}`);
  res.json({ success: true });
});
app.get('/api/auth/status', (req, res) => res.json({ authenticated: Boolean(getSession(req)) }));
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[AUTH_COOKIE];
  if (token) authSessions.delete(token);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ success: true });
});

app.use('/api/tasks', requireAuth);
app.use('/outputs', requireAuth, express.static(OUTPUT_DIR));
app.use('/api/uploads', requireAuth);

app.post('/api/uploads', upload.array('files', 12), (req, res) => {
  const files = (req.files || []).map(file => ({
    name: file.originalname,
    mime: file.mimetype,
    size: file.size,
    kind: file.mimetype.startsWith('image/') ? 'image' : file.mimetype.startsWith('video/') ? 'video' : 'audio',
    url: `/outputs/uploads/${file.filename}`,
    path: file.path
  }));
  res.json({ success: true, files });
});

app.post('/api/tasks', (req, res) => {
  const { type, prompt, negative_prompt, model, ratio, resolution, duration, video_mode, session_id, input_files } = req.body;
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt 不能为空' });
  }
  try {
    const result = createTask({
      type: type || 'image',
      prompt: prompt.trim(),
      negative_prompt: (negative_prompt || '').trim(),
      model: model || (type === 'video' ? 'jimeng-video-3.0-fast' : 'jimeng-4.5'),
      ratio: ratio || '1:1',
      resolution: resolution || (type === 'video' ? '720p' : '2k'),
      duration: duration || 5,
      video_mode: video_mode || 'text_to_video',
      session_id: session_id || '',
      input_files: Array.isArray(input_files) ? input_files : [],
    });
    res.json({ success: true, task: { id: Number(result.id) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ task });
});

app.get('/api/tasks', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ tasks: listTasks(limit) });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError || err?.message === '仅支持图片、视频和音频素材') {
    return res.status(400).json({ error: err.message || '素材上传失败' });
  }
  next(err);
});

// ---- Worker (runs in same process) ----
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function runCli(args, timeout) {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, 'node_modules', '.bin', 'jimeng');
    const child = execFile(cliPath, args, {
      timeout, maxBuffer: 10 * 1024 * 1024,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `exit ${code}`));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { resolve({ raw: stdout.trim() }); }
    });
    child.on('error', reject);
  });
}

function findFiles(result) {
  const files = [];
  if (result.data && result.data.files && Array.isArray(result.data.files)) {
    for (const f of result.data.files) {
      if (fs.existsSync(f)) files.push(f);
    }
  }
  if (files.length === 0 && result.data && result.data.data) {
    for (const item of result.data.data) {
      if (item.url) files.push(item.url);
    }
  }
  return files;
}

async function processTask(task) {
  setTaskStatus(task.id, 'processing');
  const isVideo = task.type === 'video';
  let inputFiles = [];
  try { inputFiles = JSON.parse(task.input_files || '[]'); } catch (e) { inputFiles = []; }
  const materials = inputFiles.map(item => typeof item === 'string' ? { path: item, mime: '' } : item).filter(item => item && item.path);
  const imageInputs = materials.filter(item => String(item.mime || '').startsWith('image/'));
  const videoInputs = materials.filter(item => String(item.mime || '').startsWith('video/'));
  const audioInputs = materials.filter(item => String(item.mime || '').startsWith('audio/'));
  console.log(`[Worker] 开始 #${task.id} [${task.type}]: ${task.prompt.substring(0, 50)}，素材 ${materials.length}（图片${imageInputs.length}/视频${videoInputs.length}/音频${audioInputs.length}）`);

  let prefix = isVideo ? 'video' : 'image';
  let args;
  if (!isVideo && imageInputs.length) {
    args = ['image', 'edit', '--prompt', task.prompt, '--wait', '--json', '--output-dir', OUTPUT_DIR];
    imageInputs.slice(0, 10).forEach(item => args.push('--image', item.path));
  } else {
    args = [prefix, 'generate', '--prompt', task.prompt, '--wait', '--json', '--output-dir', OUTPUT_DIR];
  }
  if (isVideo) {
    let mode = task.video_mode || 'text_to_video';
    if (videoInputs.length || imageInputs.length > 1) mode = 'omni_reference';
    else if (imageInputs.length === 1) mode = 'image_to_video';
    args.push('--model', task.model || (mode === 'omni_reference' ? 'jimeng-video-seedance-2.0-fast' : 'jimeng-video-3.0-fast'));
    args.push('--ratio', task.ratio || '16:9');
    args.push('--resolution', task.resolution || '720p');
    args.push('--duration', String(task.duration || 5));
    args.push('--mode', mode);
    if (mode === 'omni_reference') {
      imageInputs.slice(0, 9).forEach(item => args.push('--image-file', item.path));
      videoInputs.slice(0, 3).forEach(item => args.push('--video-file', item.path));
    } else if (mode === 'image_to_video') {
      args.push('--image-file', imageInputs[0].path);
    }
  } else {
    args.push('--model', task.model || 'jimeng-4.5');
    args.push('--ratio', task.ratio || '1:1');
    args.push('--resolution', task.resolution || '2k');
    if (task.negative_prompt) args.push('--negative-prompt', task.negative_prompt);
  }
  if (JIMENG_TOKEN) args.push('--token', JIMENG_TOKEN);

  try {
    const result = await runCli(args, isVideo ? 600000 : 300000);
    const files = findFiles(result);
    let outputUrl = '';
    if (files.length > 0) {
      const remote = files[0].startsWith('http');
      outputUrl = remote ? files.join(',') : files.map(p => '/outputs/' + path.basename(p)).join(',');
      console.log(`[Worker] #${task.id} 完成, ${files.length} 文件`);
    } else {
      outputUrl = JSON.stringify(result).substring(0, 500);
    }
    setTaskStatus(task.id, 'completed', { output_url: outputUrl });
  } catch (err) {
    console.error(`[Worker] #${task.id} 失败: ${err.message}`);
    setTaskStatus(task.id, 'failed', { error_message: err.message.substring(0, 500) });
  }
}

async function workerLoop() {
  try {
    const task = getPendingTask();
    if (task) await processTask(task);
  } catch (err) {
    console.error('[Worker] 异常:', err.message);
  }
}

// ---- Start ----
app.listen(PORT, () => {
  console.log(`即梦中转站: http://localhost:${PORT}`);
  console.log(`Worker: token=${JIMENG_TOKEN ? '已配置('+JIMENG_TOKEN.length+')' : '未配置'}, 轮询=${POLL_INTERVAL}ms`);

  // Start worker loop
  setInterval(workerLoop, POLL_INTERVAL);
  workerLoop();
});
