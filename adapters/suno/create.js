/**
 * suno create — trigger Suno song generation from a natural-language description.
 *
 * Strategy: INTERCEPT.
 *   1. goto /create, ensure Simple mode is active, type description into the
 *      visible textarea via React-aware native setter.
 *   2. installInterceptor on /api/feed/v3 (Suno's bulk clip status query
 *      endpoint — the page polls it periodically while clips are streaming).
 *      Install AFTER goto: the interceptor monkey-patches window.fetch on
 *      the current page; goto reloads the page and wipes the patch.
 *   3. Click "Create song" via page.click() — CDP-level. Synthetic events
 *      via .evaluate() don't reliably fire React's onPointerDown handlers,
 *      so the click registers in the DOM but no generation request fires.
 *   4. Watch intercepted feed/v3 responses for a clip whose
 *      metadata.gpt_description_prompt matches our description — that gives
 *      us the new clip IDs.
 *   5. Poll GET /api/feed/v2?ids=<csv> with a fresh Clerk Bearer token until
 *      every clip reaches a terminal status (complete / error).
 *   6. Return song list (index, id, title, audio_url, image_url, duration, status).
 *
 * Login: requires user to be logged in to suno.com in main Chrome (the bridge profile).
 * Each generation costs ~10 Suno credits and produces 2 song variants.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, AuthRequiredError } from '@jackwener/opencli/errors';

const SUNO_API = 'https://studio-api-prod.suno.com';
const FEED_V3_PATTERN = 'studio-api-prod.suno.com/api/feed/v3';
const TERMINAL_STATUSES = new Set(['complete', 'error']);

cli({
  site: 'suno',
  name: 'create',
  description: '触发 Suno 歌曲生成（输入描述，等生成完成后返回 mp3 列表）',
  access: 'write',
  domain: 'studio-api-prod.suno.com',
  strategy: Strategy.INTERCEPT,
  args: [
    {
      name: 'description',
      positional: true,
      required: true,
      type: 'string',
      help: '歌曲描述（自然语言，如 "A romantic love song about sunsets"）',
    },
    {
      name: 'timeout',
      type: 'int',
      default: 420,
      help: '等待生成完成的最大秒数（默认 420 = 7 分钟，v5.5 模型生成 4-5 分钟长歌曲常见，必要时调高）',
    },
  ],
  columns: ['index', 'id', 'title', 'audio_url', 'image_url', 'duration', 'status'],
  func: async (page, args) => {
    const description = String(args.description ?? '').trim();
    if (!description) {
      throw new CliError('INVALID_ARGUMENT', 'description is required');
    }
    const timeoutS = Math.max(60, Math.min(Number(args.timeout) || 420, 900));

    // 1. Navigate first. The interceptor monkey-patches window.fetch on the
    //    current page; if we install it before goto, the patches get wiped
    //    when the new page loads. Install AFTER navigation, then click.
    await page.goto('https://suno.com/create');
    await page.wait(5);

    // 2. Confirm Clerk session is alive (we need its token for polling later).
    const sessRaw = await page.evaluate(`
      (async () => {
        if (!window.Clerk?.session) return JSON.stringify({ ok: false });
        try {
          const tok = await window.Clerk.session.getToken();
          return JSON.stringify({ ok: !!tok, userId: window.Clerk.user?.id || null });
        } catch (e) {
          return JSON.stringify({ ok: false, err: String(e) });
        }
      })()
    `);
    const sess = JSON.parse(sessRaw);
    if (!sess.ok) {
      throw new AuthRequiredError('suno.com');
    }

    // 3. Suno's create page can land in Simple, Advanced, or Sounds mode based
    //    on last user state. We need Simple mode (the description-only flow).
    //    Detect first; only switch if needed. Switching uses page.click()
    //    (CDP-level mouse event) — synthetic dispatches via .evaluate() don't
    //    reliably trigger Suno's React onPointerDown handlers in 4.x.
    const modeRaw = await page.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button')).filter(
          b => ['Simple', 'Advanced', 'Sounds'].includes(b.textContent?.trim())
        );
        const active = tabs.find(b => b.className.includes('active'));
        return JSON.stringify({
          active: active?.textContent?.trim() || null,
          tabs: tabs.map(b => b.textContent?.trim()),
        });
      })()
    `);
    const mode = JSON.parse(modeRaw);
    if (mode.active !== 'Simple') {
      try {
        // CSS selector path of page.click — see target-resolver.js (any string
        // that isn't pure digits is treated as a CSS selector).
        await page.click('button.active');
        await page.wait(1);
        // Then click the Simple tab specifically. There's no aria-label on
        // these tab buttons, so we rely on text-content scan via a tiny eval
        // that returns the button's data-opencli-ref (assigned on snapshot).
        const simpleClickRaw = await page.evaluate(`
          (() => {
            const btn = Array.from(document.querySelectorAll('button')).find(
              b => b.textContent?.trim() === 'Simple'
            );
            if (!btn) return JSON.stringify({ ok: false, err: 'Simple tab not found' });
            btn.setAttribute('data-opencli-ref', '__suno_simple__');
            return JSON.stringify({ ok: true });
          })()
        `);
        const simpleClick = JSON.parse(simpleClickRaw);
        if (!simpleClick.ok) {
          throw new CliError('UI_ERROR', `cannot find Simple tab; available: ${mode.tabs.join(',')}`);
        }
        await page.click('[data-opencli-ref="__suno_simple__"]');
        await page.wait(1);
      } catch (err) {
        if (err instanceof CliError) throw err;
        throw new CliError('UI_ERROR', `failed to switch to Simple mode: ${err?.message || err}`);
      }
    }

    // 4. Set description via the React-aware native setter. opencli's `type`
    //    sends keyboard events that React's controlled component sometimes
    //    silently drops; using the prototype setter + 'input' event is the
    //    canonical way to update React-controlled textareas from outside.
    //
    //    Selector is computed-display-based: Suno keeps all four mode
    //    textareas (Simple description / Advanced lyrics+styles / Sounds)
    //    in the DOM, but hides the inactive ones via display:none on a
    //    grandparent. The single textarea whose computed display chain has
    //    no "none" / "hidden" link is the active mode's primary input —
    //    i.e. our description textarea in Simple mode. This avoids brittle
    //    placeholder-string matching (Suno rotates placeholders: "Meditative
    //    dream pop..." / "Fun latin pop song about a stranger's kindness" /
    //    etc).
    const descJson = JSON.stringify(description);
    const typedRaw = await page.evaluate(`
      (() => {
        const all = Array.from(document.querySelectorAll('textarea'));
        const visible = all.filter(t => {
          const cs = getComputedStyle(t);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          let p = t.parentElement;
          while (p && p !== document.body) {
            const pcs = getComputedStyle(p);
            if (pcs.display === 'none' || pcs.visibility === 'hidden') return false;
            p = p.parentElement;
          }
          return true;
        });
        if (visible.length === 0) {
          return JSON.stringify({ ok: false, err: 'no visible textarea on /create — page failed to load? placeholders=' + all.map(t => t.placeholder).join('|') });
        }
        if (visible.length > 1) {
          return JSON.stringify({ ok: false, err: 'expected exactly 1 visible textarea (Simple mode), got ' + visible.length + ': ' + visible.map(t => t.placeholder).join('|') });
        }
        const ta = visible[0];
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${descJson});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ ok: true, value: ta.value, placeholder: ta.placeholder });
      })()
    `);
    const typed = JSON.parse(typedRaw);
    if (!typed.ok) {
      throw new CliError('UI_ERROR', typed.err || 'failed to type description');
    }
    if (typed.value !== description) {
      throw new CliError('UI_ERROR', 'description was not stored in the textarea correctly');
    }

    await page.wait(1);

    // 5. Install feed/v3 interceptor RIGHT before clicking Create — patches
    //    are page-scoped and get lost on goto(). Drain in case of any
    //    pre-existing array (no-op on a fresh patch).
    await page.installInterceptor(FEED_V3_PATTERN);
    await page.getInterceptedRequests();

    // 6. Click "Create song" via CDP-level page.click(). Synthetic
    //    dispatchEvent in evaluate() does not reliably fire React's
    //    onPointerDown handler — the click registers in the DOM but no
    //    generation request goes out. CDP's Input.dispatchMouseEvent goes
    //    through the browser's real input pipeline.
    try {
      await page.click('button[aria-label="Create song"]');
    } catch (err) {
      throw new CliError('UI_ERROR', `Create button click failed: ${err?.message || err}`);
    }

    // 7. Wait for a feed/v3 response that contains a clip whose
    //    metadata.gpt_description_prompt equals our description — that's the
    //    generation polling response with the freshly-minted clip IDs.
    let clipIds = null;
    const captureDeadline = Date.now() + 60_000;
    while (Date.now() < captureDeadline) {
      await page.wait(2);
      const captured = await page.getInterceptedRequests();
      for (const resp of captured) {
        const clips = Array.isArray(resp?.clips) ? resp.clips : [];
        const matched = clips.filter((c) => c?.metadata?.gpt_description_prompt === description);
        if (matched.length > 0) {
          clipIds = matched.map((c) => c.id).filter(Boolean);
          break;
        }
      }
      if (clipIds && clipIds.length > 0) break;
    }
    if (!clipIds || clipIds.length === 0) {
      throw new CliError(
        'NO_DATA',
        'Generation did not start — Create click did not produce a feed/v3 response with our description. Check Suno credits or session.'
      );
    }

    // 8. Poll for terminal status. The page itself polls /api/feed/v3 on its
    //    own schedule while clips are streaming, and our interceptor
    //    captures every response. We read those captures (free, no rate
    //    limit) and only fall back to a direct feed/v2 fetch when we
    //    haven't seen a fresh response in a while. Direct fetches use a
    //    conservative 15s interval — Suno rate-limits per-user requests
    //    to /api/feed/* and 429s combined with the page's own polling.
    const pollDeadline = Date.now() + timeoutS * 1000;
    let finalClips = null;
    let lastDirectFetch = 0;
    const wantedIds = new Set(clipIds);
    // Seed with the clips already known (the feed/v3 response that revealed
    // them — they were streaming at that point).
    const latestById = new Map();

    while (Date.now() < pollDeadline) {
      // 8a. Read all feed/v3 captures the page has produced since we last
      //     looked. They contain our clips (the page polls them while
      //     they're streaming). Update latestById with the freshest copy.
      const captured = await page.getInterceptedRequests();
      for (const resp of captured) {
        const clips = Array.isArray(resp?.clips) ? resp.clips : [];
        for (const c of clips) {
          if (c?.id && wantedIds.has(c.id)) latestById.set(c.id, c);
        }
      }
      // 8b. If we have terminal status for every wanted clip, we're done.
      if (
        latestById.size === wantedIds.size &&
        [...latestById.values()].every((c) => TERMINAL_STATUSES.has(c.status))
      ) {
        finalClips = [...latestById.values()];
        break;
      }
      // 8c. If we haven't directly polled in a while AND we don't have a
      //     fresh-enough captured response, do one direct feed/v2 fetch.
      //     This covers the case where the page stops polling (e.g. user
      //     navigated away from the workspace) and our captures go stale.
      const sinceLast = Date.now() - lastDirectFetch;
      if (sinceLast > 15000) {
        lastDirectFetch = Date.now();
        const idsParamJson = JSON.stringify(clipIds.join(','));
        const respRaw = await page.evaluate(`
          (async () => {
            try {
              const tok = await window.Clerk.session.getToken();
              const r = await fetch('${SUNO_API}/api/feed/v2?ids=' + ${idsParamJson}, {
                headers: { Authorization: 'Bearer ' + tok },
              });
              if (!r.ok) return JSON.stringify({ err: 'HTTP ' + r.status });
              return JSON.stringify(await r.json());
            } catch (e) {
              return JSON.stringify({ err: String(e) });
            }
          })()
        `);
        const data = JSON.parse(respRaw);
        if (data.err) {
          // 429 / 5xx are transient; just skip this round and keep relying
          // on captures. Hard-fail only if every poll path is broken at
          // the end (handled by the TIMEOUT below).
        } else {
          for (const c of data.clips || []) {
            if (c?.id && wantedIds.has(c.id)) latestById.set(c.id, c);
          }
          if (
            latestById.size === wantedIds.size &&
            [...latestById.values()].every((c) => TERMINAL_STATUSES.has(c.status))
          ) {
            finalClips = [...latestById.values()];
            break;
          }
        }
      }
      // 8d. Pause before next loop. Short pause is fine — most of the work
      //     is just reading already-captured responses.
      await page.wait(3);
    }

    if (!finalClips) {
      const idsParam = clipIds.join(',');
      throw new CliError(
        'TIMEOUT',
        `Generation did not complete within ${timeoutS}s. Clip IDs: ${idsParam}. Pass --timeout=<larger> and retry, or look up the clips later via the Suno UI.`
      );
    }

    // 9. Map clips to columns, ordered by Suno's metadata.batch_index when
    //    present (typically 0 / 1 for the two variants).
    const ordered = [...finalClips].sort((a, b) => {
      const ai = Number.isFinite(a?.metadata?.batch_index) ? a.metadata.batch_index : 0;
      const bi = Number.isFinite(b?.metadata?.batch_index) ? b.metadata.batch_index : 0;
      return ai - bi;
    });

    return ordered.map((c, i) => ({
      index: i + 1,
      id: String(c.id || ''),
      title: String(c.title || ''),
      audio_url: String(c.audio_url || ''),
      image_url: String(c.image_url || ''),
      duration: Number(c?.metadata?.duration ?? 0),
      status: String(c.status || ''),
    }));
  },
});
