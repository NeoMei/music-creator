#!/usr/bin/env node
/**
 * publish-douyin.cjs — 用户态 抖音音乐(汽水)发布脚本。
 *
 * 绕开 ocli douyin-music publish adapter 的两个缺口:
 *   1. 封面上传后不点裁剪/确认弹窗 → 超时
 *   2. Suno 多选下拉选了不关闭 → 弹窗挂住
 *
 * 经 CDP 9222 连 CloakBrowser,用 playwright-core 驱动 Semi Design 表单,
 * 逐步填字段 → 上传音频 → 上传封面 + 点确认 → (可选)提交。
 *
 * 用法:
 *   node publish-douyin.cjs \
 *     --audio <wav> --cover <jpeg> --title '<标题>' \
 *     --lyrics '<歌词文本>' [--artist '<表演者>'] [--ai-tools Suno] \
 *     [--music-type 原创] [--submit]
 *
 * 不加 --submit 时只填表单 + 上传 + 点确认,不点最终提交(便于先验证)。
 */
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (_) {
  ({ chromium } = require(process.env.HOME + '/.openclaw/workspace/skills/aily-browser/scripts/node_modules/playwright-core'));
}

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const PUBLISH_URL = 'https://music.douyin.com/console/complete-publish';

// ---------- args ----------
function parseArgs(argv) {
  const o = { audio:null, cover:null, title:null, artist:null, lyrics:'',
              aiTools:'Suno', musicType:'原创', submit:false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--submit') o.submit = true;
    else if (a.startsWith('--')) { const k = a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); o[k] = argv[++i]; }
  }
  return o;
}
const opt = parseArgs(process.argv);
const log = (...m) => console.log('[publish]', ...m);
const die = (m) => { console.error('[publish] ✗', m); process.exit(1); };
if (!opt.audio) die('--audio <wav> 必填');
if (!opt.cover) die('--cover <jpeg> 必填');
if (!opt.title) die('--title 必填');

// ---------- helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 等待某个 x-field-id 字段出现且稳定(visible)
async function waitForField(page, fieldId, timeout = 30000) {
  const sel = `.douyin-music-form-field[x-field-id="${fieldId}"]`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate((s) => {
      const e = document.querySelector(s);
      return e && e.getBoundingClientRect().width > 0;
    }, sel);
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

// 在某字段作用域内按文本点击(radio / button)
async function clickByText(page, fieldId, text, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(({ fid, txt }) => {
      const scope = document.querySelector(`.douyin-music-form-field[x-field-id="${fid}"]`);
      if (!scope) return false;
      const cand = [...scope.querySelectorAll('span,button,label,div,[role=radio]')]
        .find(e => (e.innerText || '').trim() === txt && e.getBoundingClientRect().width > 0);
      if (cand) { cand.click(); return true; }
      return false;
    }, { fid: fieldId, txt: text });
    if (clicked) return true;
    await sleep(300);
  }
  return false;
}

// React 安全填充(input/textarea)
async function reactFill(page, fieldId, value, { tag } = {}) {
  const sel = `.douyin-music-form-field[x-field-id="${fieldId}"]`;
  const ok = await page.evaluate(({ s, v, preferTag }) => {
    const scope = document.querySelector(s);
    if (!scope) return 'no-scope';
    const el = preferTag === 'textarea'
      ? scope.querySelector('textarea')
      : (scope.querySelector('input:not([type=file])') || scope.querySelector('textarea'));
    if (!el) return 'no-input';
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // 尝试触发 React onChange(props)
    const rk = Object.keys(el).find(k => k.startsWith('__reactProps'));
    if (rk && el[rk].onChange) {
      const ev = new Event('input', { bubbles: true });
      Object.defineProperty(ev, 'target', { value: el, enumerable: true });
      el[rk].onChange(ev);
    }
    return el.value === v ? 'ok' : 'mismatch:' + el.value.slice(0, 20);
  }, { s: sel, v: value, preferTag: tag });
  return ok;
}

// 上传文件到某字段的 file input（绕过 Playwright setInputFiles 对隐藏 input 的超时问题）
async function uploadToField(page, fieldId, filePath) {
  const cdp = page._cdp;
  const rootId = page._cdpRootId;
  if (!cdp || !rootId) die('CDP session 未初始化');
  const sel = `.douyin-music-form-field[x-field-id="${fieldId}"] input[type=file]`;
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: rootId, selector: sel });
  if (!nodeId) die(`未找到文件输入: ${fieldId}`);
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  log(`已选择文件 → ${fieldId}:`, filePath);
}

// 等待并点击"确认"类按钮(封面上传后的裁剪/确认弹窗)
async function clickConfirmDialog(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button,[role=button]')];
      // 优先 modal/弹窗内的确认按钮
      const confirm = btns.find(b => {
        const t = (b.innerText || '').trim();
        return /^(确认|确定|完成|保存裁剪|裁剪完成|完成裁剪)$/.test(t) && b.getBoundingClientRect().width > 0;
      });
      if (confirm) { confirm.click(); return confirm.innerText.trim(); }
      return null;
    });
    if (clicked) return clicked;
    await sleep(400);
  }
  return null;
}

// 主流程
(async () => {
  log('连接 CloakBrowser CDP:', CDP_URL);
  const browser = await chromium.connectOverCDP(CDP_URL);
  let ctx = browser.contexts()[0];
  // 每次新建标签,避免上一轮残留状态;复用旧 tab 容易在微前端上卡住
  const page = await ctx.newPage();
  await page.bringToFront().catch(() => {});

  log('导航到发布页');
  // garfish 微前端:waitUntil load/domcontentloaded 可能永不触发,短超时+忽略,靠下面轮询等表单
  await page.goto(PUBLISH_URL, { waitUntil: 'commit', timeout: 20000 }).catch(e => log('goto(可忽略):', e.message.slice(0,60)));
  // 微前端 garfish 不稳定,轮询等表单字段出现且稳定
  log('等待表单稳定(x-field-id 字段)…');
  let stable = 0, last = 0;
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.douyin-music-form-field[x-field-id]').length);
    if (n >= 12 && n === last) { stable++; if (stable >= 2) break; } else stable = 0;
    last = n;
    await sleep(500);
  }
  log('表单字段数:', last);

  // 初始化 CDP session 用于文件上传（绕过 Playwright 对隐藏 file input 的 setInputFiles 超时）
  page._cdp = await page.context().newCDPSession(page);
  const { root } = await page._cdp.send('DOM.getDocument', { depth: -1 });
  page._cdpRootId = root.nodeId;

  // 1. AI 创作声明 = 是(选「是」后才出现 Suno 工具选择,但 Suno 放最后选,避免被上传重渲染冲掉)
  if (await clickByText(page, 'aiTools[isMakeByAITools]', '是')) log('✓ AI创作声明 = 是');
  else die('AI创作声明「是」点不上');
  await sleep(500);

  // 2. 音乐类型 = 原创
  if (await clickByText(page, 'songs[0][originalType]', opt.musicType)) log('✓ 音乐类型 =', opt.musicType);
  else die('音乐类型「' + opt.musicType + '」点不上');

  // 4. 标题
  let r = await reactFill(page, 'songs[0][title]', opt.title);
  log('标题填充:', r);

  // 5. 歌词
  if (opt.lyrics) {
    r = await reactFill(page, 'songs[0][lyricText]', opt.lyrics, { tag: 'textarea' });
    log('歌词填充:', r);
  }

  // 6. 上传完整版音频
  log('上传音频…(大文件需等待)');
  await uploadToField(page, 'songs[0][_fullAudios]', opt.audio);
  await waitForAudioUpload(page);

  // 7. 上传封面 + 点裁剪确认(adapter 漏的点)。确认可能要点多次/有时序,带验证重试
  log('上传封面…');
  await uploadToField(page, 'album[_coverValue]', opt.cover);
  let coverOk = false;
  for (let attempt = 0; attempt < 3 && !coverOk; attempt++) {
    const c = await clickConfirmDialog(page, 18000);
    log(attempt === 0 ? `封面确认弹窗: ${c || '未出现'}` : `重试确认(${attempt}): ${c || '未出现'}`);
    await sleep(1500);
    coverOk = await page.evaluate(() =>
      !!document.querySelector('.douyin-music-form-field[x-field-id="album[_coverValue]"] img'));
  }
  log(coverOk ? '✓ 封面已写入' : '⚠ 封面未写入(可能需手动补)');

  // Suno 工具选择放最后(真实 Playwright click;放最后避免被上传重渲染冲掉)
  await selectSunoAndClose(page);

  await verifyAndReport(page);

  // 8. 提交
  if (opt.submit) {
    await doSubmit(page);
  } else {
    log('━━ 未加 --submit,已填表单+上传+确认,但不提交。检查无误后加 --submit 重跑,或手动点页面上的提交按钮。');
  }

  await browser.close(); // connectOverCDP 的 close 只断开,不关浏览器
  log('完成。');
  process.exit(0);
})().catch(e => { console.error('[publish] 异常:', e.message); process.exit(1); });

// ---------- 子流程 ----------
async function selectSunoAndClose(page) {
  const FIELD = 'aiTools[makeWithAIToolNames]';
  const tool = opt.aiTools;
  // 已默认选好就跳过
  const already = await page.evaluate(({ fid, t }) => {
    const s = document.querySelector(`.douyin-music-form-field[x-field-id="${fid}"]`);
    return !!(s && (s.innerText || '').includes(t));
  }, { fid: FIELD, t: tool });
  if (already) { log('✓ AI 工具已默认选中:', tool); return; }

  // 用真实 Playwright click(Semi 多选选项需要真指针事件,evaluate 的 .click() 不提交)
  const trigger = page.locator(`.douyin-music-form-field[x-field-id="${FIELD}"] .douyin-music-select`).first();
  await trigger.click();
  await sleep(700);
  const option = page.locator(`.douyin-music-select-option`).filter({ hasText: tool }).first();
  const count = await option.count();
  if (count === 0) { log('⚠ 没找到 AI 工具选项:', tool); await page.keyboard.press('Escape').catch(()=>{}); return; }
  await option.click();
  await sleep(500);
  await page.keyboard.press('Escape').catch(() => {}); // 关闭下拉
  await sleep(300);
  // 验证
  const sel = await page.evaluate((fid) => {
    const s = document.querySelector(`.douyin-music-form-field[x-field-id="${fid}"]`);
    return (s?.innerText || '').replace(/\s+/g, ' ').slice(0, 80);
  }, FIELD);
  log(sel.includes(tool) ? '✓ AI 工具已选中:' + tool : '⚠ AI 工具仍未选中,字段:' + JSON.stringify(sel));
}

// 最终表单状态自检(脚本持有正确的 page 引用,比外部 ocli browser 可靠)
async function verifyAndReport(page) {
  const s = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const f = (id) => q(`.douyin-music-form-field[x-field-id="${id}"]`);
    return JSON.stringify({
      title: (f('songs[0][title]')?.querySelector('input') || {}).value || null,
      lyricsHead: ((f('songs[0][lyricText]')?.querySelector('textarea') || {}).value || '').slice(0, 30),
      audioText: (f('songs[0][_fullAudios]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
      coverText: (f('album[_coverValue]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
      coverHasImg: !!f('album[_coverValue]')?.querySelector('img'),
      sunoSelected: (f('aiTools[makeWithAIToolNames]')?.innerText || '').includes('Suno'),
      aiYes: !!f('aiTools[isMakeByAITools]')?.querySelector('[class*=checked],[role=radio][aria-checked=true]'),
    });
  });
  log('━━ 表单状态自检:', s);
}

async function waitForAudioUpload(page, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const scope = document.querySelector('.douyin-music-form-field[x-field-id="songs[0][_fullAudios]"]');
      if (!scope) return 'no-scope';
      const txt = scope.innerText || '';
      if (/成功|success|完成|重新上传|秒/.test(txt)) return 'success';
      if (/失败|error|错误/.test(txt)) return 'error';
      return 'uploading:' + txt.slice(0, 30);
    });
    if (state === 'success') { log('✓ 音频上传成功'); return; }
    if (state === 'error') die('音频上传失败');
    await sleep(1000);
  }
  die('音频上传超时');
}

async function doSubmit(page) {
  // 找提交按钮(发布/提交审核/保存并提交)
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find(b => {
      const t = (b.innerText || '').trim();
      return /^(发布|提交|提交审核|确认发布|保存并发布)$/.test(t) && !b.disabled && b.getBoundingClientRect().width > 0;
    }) || btns.find(b => /发布|提交/.test(b.innerText || '') && !b.disabled && b.getBoundingClientRect().width > 0);
    if (target) { target.click(); return target.innerText.trim(); }
    return null;
  });
  if (clicked) log('✓ 已点提交:', clicked, '(等待结果…)');
  else die('没找到提交按钮');
  await sleep(5000);
  log('提交后页面 URL:', page.url());
}
