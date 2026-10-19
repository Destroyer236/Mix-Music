// The challenge decision and official component stay in the isolated Passport
// page. Only a boolean completion result leaves this main-world script.
export function isQishuiVerificationResource(input: string, resourceType: string): boolean {
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    const staticTypes = ['script', 'stylesheet', 'image', 'font', 'media', 'xhr', 'other', 'subFrame']
    const cdns = ['bytescm.com', 'bytetos.com', 'byteimg.com', 'bytegoofy.com', 'bytecdntp.com', 'bytednsdoc.com', 'pstatp.com', 'douyinpic.com', 'douyincdn.com', 'douyinstatic.com', 'yhgfb-cn-static.com', 'ibytedtos.com', 'ttwstatic.com']
    if (cdns.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return staticTypes.includes(resourceType)
    // Qishui's pack_verify_ways_data returns its component from the Passport
    // API host; its lazy chunks still come from the official CDN above.
    if (url.hostname === 'auth.zijieapi.com' && resourceType === 'script') return url.pathname === '/ucenter_web/app/second_verification_web/dist/index.umd.production.js'
    // sdk-glue's official captcha 2.28.11 renders this frame; its rmc-captcha
    // component declares these exact public API paths on verify.zijieapi.com.
    if (url.hostname === 'rmc.bytedance.com') return resourceType === 'subFrame' && /^\/verifycenter\/captcha\/v2\/?$/.test(url.pathname)
    if (url.hostname === 'verify.zijieapi.com') return resourceType === 'xhr' && (/^\/captcha\/(?:get|verify|i18n)\/?$/.test(url.pathname) || /^\/feedback\/(?:tags|detail)\/?$/.test(url.pathname) || /^\/passport\/safe\//.test(url.pathname))
    if (!['xhr', 'subFrame'].includes(resourceType)) return false
    if (url.hostname === 'auth.zijieapi.com') return true
    if (!['api.qishui.com', 'bff-pc.qishui.com'].includes(url.hostname)) return false
    return /^\/passport\//.test(url.pathname) || /^\/light\/(?:passport|account|verify|safe)\//.test(url.pathname) || /^\/light\/invoke\/(?:scan_login|verify|second_verify|account_verify)(?:\/|$)/.test(url.pathname)
  } catch { return false }
}

// Keep this resolver self-contained: the same function runs in the isolated
// page after webpack builds it. Only resource policy decides which URL loads.
export function resolveQishuiVerificationUrl(source: unknown): string {
  const invalidCharacters = (value: string) => {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code < 32 || code === 92 || code === 127) return true
    }
    return false
  }
  let address: string
  if (typeof source === 'string') {
    address = source.trim()
    if (!address) throw new Error('QV04_EMPTY')
    if (invalidCharacters(source)) throw new Error('QV04_FORMAT')
  } else if (source && typeof source === 'object' && !Array.isArray(source)) {
    const value = source as Record<string, unknown>
    if (typeof value.host !== 'string' || !value.host.trim()) throw new Error('QV04_EMPTY')
    if (value.path != null && typeof value.path !== 'string') throw new Error('QV04_FORMAT')
    const host = value.host.trim()
    const rawPath = value.path
    const trimmedPath = rawPath?.trim() ?? ''
    const path = trimmedPath.length ? trimmedPath : '/'
    if (invalidCharacters(value.host) || /[/:?#@\s]/.test(host) || invalidCharacters(rawPath ?? '') || path.startsWith('//')) throw new Error('QV04_FORMAT')
    address = `https://${host}${path.startsWith('/') ? path : `/${path}`}`
  } else throw new Error('QV04_EMPTY')
  try { return new URL(address, 'https://api.qishui.com/').toString() } catch { throw new Error('QV04_FORMAT') }
}

/** Bridge only cross-origin authentication requests; same-origin BDMS hooks stay intact. */
export function getQishuiVerificationXhrBridgeScript(): string {
  return `(() => {
    if (window.__linklineVerificationBridgeInstalled) return;
    const allowed = (${isQishuiVerificationResource.toString()});
    const shouldBridge = value => {
      try {
        const url = new URL(String(value), location.href);
        return url.origin !== location.origin && ['auth.zijieapi.com', 'api.qishui.com', 'bff-pc.qishui.com'].includes(url.hostname) && allowed(url.toString(), 'xhr');
      } catch { return false; }
    };
    const responseHeaders = value => {
      const headers = new Headers();
      if (typeof value === 'string') {
        for (const line of value.split(/\\r?\\n/)) {
          const colon = line.indexOf(':');
          if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
      } else if (Array.isArray(value)) {
        for (const [name, content] of value) headers.append(name, content);
      } else if (value && typeof value === 'object') {
        for (const [name, values] of Object.entries(value)) for (const content of Array.isArray(values) ? values : [values]) headers.append(name, String(content));
      }
      return headers;
    };
    const own = (target, name, value) => Object.defineProperty(target, name, { configurable: true, value });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (!shouldBridge(url) || typeof window.__linklineVerificationRequest !== 'function') return nativeFetch(input, init);
      const request = new Request(input, init);
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let onAbort;
      try {
        const aborted = new Promise((resolve, reject) => {
          onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
          request.signal.addEventListener('abort', onAbort, { once: true });
        });
        const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.text();
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const reply = await Promise.race([window.__linklineVerificationRequest({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body, timeout: 180000 }), aborted]);
        const response = new Response([204, 205, 304].includes(reply.status) ? null : String(reply.body || ''), { status: reply.status, headers: responseHeaders(reply.headers) });
        own(response, 'url', String(reply.responseURL || request.url));
        return response;
      } finally { if (onAbort) request.signal.removeEventListener('abort', onAbort); }
    };
    const prototype = XMLHttpRequest.prototype;
    const open = prototype.open;
    const send = prototype.send;
    const abort = prototype.abort;
    const setHeader = prototype.setRequestHeader;
    const states = new WeakMap();
    prototype.open = function(method, url, async = true, username, password) {
      const previous = states.get(this);
      if (previous) { previous.stopped = true; clearTimeout(previous.timer); }
      if (previous && previous.bridged) for (const name of ['status', 'statusText', 'responseURL', 'response', 'responseText', 'readyState', 'getResponseHeader', 'getAllResponseHeaders']) delete this[name];
      const address = new URL(String(url), location.href).toString();
      states.set(this, { method: String(method).toUpperCase(), url: address, async, headers: {}, stopped: false, sent: false });
      return open.call(this, method, url, async, username, password);
    };
    prototype.setRequestHeader = function(name, value) {
      const state = states.get(this);
      if (state) {
        const key = String(name).toLowerCase();
        state.headers[key] = state.headers[key] ? state.headers[key] + ', ' + value : String(value);
      }
      return setHeader.call(this, name, value);
    };
    prototype.abort = function() {
      const state = states.get(this);
      if (!state || !state.bridged || state.stopped) return abort.call(this);
      state.stopped = true;
      clearTimeout(state.timer);
      own(this, 'readyState', 0);
      own(this, 'status', 0);
      this.dispatchEvent(new Event('abort'));
      this.dispatchEvent(new Event('loadend'));
    };
    prototype.send = function(body) {
      const state = states.get(this);
      if (!state || !shouldBridge(state.url) || typeof window.__linklineVerificationRequest !== 'function') return send.call(this, body);
      if (!state.async) throw new DOMException('Synchronous verification requests are unsupported', 'InvalidAccessError');
      if (state.sent) throw new DOMException('Request already sent', 'InvalidStateError');
      if (body != null && typeof body !== 'string' && !(body instanceof URLSearchParams)) throw new TypeError('Unsupported verification request body');
      state.sent = true;
      state.bridged = true;
      const fail = kind => {
        if (state.stopped) return;
        state.stopped = true;
        clearTimeout(state.timer);
        own(this, 'status', 0);
        own(this, 'readyState', 4);
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event(kind));
        this.dispatchEvent(new Event('loadend'));
      };
      if (this.timeout > 0) state.timer = setTimeout(() => fail('timeout'), this.timeout);
      Promise.resolve().then(() => window.__linklineVerificationRequest({ method: state.method, url: state.url, headers: state.headers, body: body == null ? null : String(body), timeout: this.timeout || 180000 })).then(reply => {
        if (state.stopped) return;
        clearTimeout(state.timer);
        const text = String(reply.body || '');
        const headers = responseHeaders(reply.headers);
        let response = text;
        if (this.responseType === 'json') { try { response = JSON.parse(text); } catch { response = null; } }
        else if (this.responseType === 'arraybuffer') response = new TextEncoder().encode(text).buffer;
        else if (this.responseType === 'blob') response = new Blob([text], { type: headers.get('content-type') || '' });
        own(this, 'status', Number(reply.status) || 0);
        own(this, 'statusText', Number(reply.status) === 200 ? 'OK' : '');
        own(this, 'responseURL', String(reply.responseURL || state.url));
        own(this, 'response', response);
        Object.defineProperty(this, 'responseText', { configurable: true, get: () => {
          if (this.responseType && this.responseType !== 'text') throw new DOMException('Response is not text', 'InvalidStateError');
          return text;
        } });
        this.getResponseHeader = name => headers.get(name);
        this.getAllResponseHeaders = () => [...headers].map(([name, value]) => name + ': ' + value).join('\\r\\n');
        for (const readyState of [2, 3, 4]) {
          if (state.stopped) return;
          own(this, 'readyState', readyState);
          this.dispatchEvent(new Event('readystatechange'));
        }
        if (state.stopped) return;
        state.stopped = true;
        this.dispatchEvent(new Event('load'));
        this.dispatchEvent(new Event('loadend'));
      }).catch(() => fail('error'));
    };
    window.__linklineVerificationBridgeInstalled = true;
  })()`
}

export function getQishuiVerificationScript(decision: Record<string, unknown>, generalParams: Record<string, string>): string {
  const serialized = JSON.stringify({ decision, generalParams })
  if (serialized.length > 600_000) throw new Error('汽水音乐安全验证数据异常，请重新扫码')
  return `(async () => {
    ${getQishuiVerificationXhrBridgeScript()};
    const allowed = (${isQishuiVerificationResource.toString()});
    const resolveUrl = (${resolveQishuiVerificationUrl.toString()});
    const input = ${serialized};
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const parseObject = value => { if (typeof value !== 'string') return object(value); try { return object(JSON.parse(value)); } catch { return {}; } };
    if (location.origin !== 'https://api.qishui.com') throw new Error('汽水音乐安全验证页面异常，请重新扫码');
    if (typeof window.__linklineCancelQishuiVerification === 'function') window.__linklineCancelQishuiVerification();
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;padding:28px;font-family:system-ui,sans-serif;background:#fafafa;color:#222;';
    const title = document.createElement('h2');
    title.textContent = '汽水音乐安全验证';
    title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px;';
    const status = document.createElement('p');
    status.id = 'linkline-qishui-verification-status';
    status.style.cssText = 'font-size:14px;line-height:1.7;';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消验证';
    cancel.style.cssText = 'padding:8px 18px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer;';
    document.body.append(title, status, cancel);
    let done = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const finish = passed => {
      if (done) return;
      done = true;
      cancel.disabled = true;
      status.textContent = passed ? '验证已完成，正在继续登录…' : '验证已取消，请返回重新扫码';
      resolveResult(passed === true);
    };
    const cancelVerification = () => finish(false);
    window.__linklineCancelQishuiVerification = cancelVerification;
    cancel.addEventListener('click', cancelVerification);
    const checked = () => { if (done) throw new Error('cancelled'); };
    let phase = 'QV03';
    const run = async () => {
      status.textContent = '正在加载官方安全验证…';
      let decision = object(input.decision);
      const generalParams = object(input.generalParams);
      if (decision.verify_from === 'verify_center') {
        const payload = { ...decision, ...generalParams, aid: '386088' };
        delete payload.is_login;
        const body = new URLSearchParams();
        for (const [name, value] of Object.entries(payload)) if (value != null) body.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
        const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded', 'x-tt-passport-verify-portrait': String(decision.verify_portrait_id || '') });
        const csrf = name => { const prefix = name + '='; const entry = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith(prefix)); return entry ? entry.slice(prefix.length) : ''; };
        headers.set('x-tt-passport-csrf-token', csrf('passport_csrf_token') || csrf('passport_csrf_token_default'));
        const reply = await fetch('https://api.qishui.com/passport/safe/pack_verify_ways_data/?aid=386088', { method: 'POST', headers, body: body.toString(), credentials: 'include', redirect: 'error' });
        checked();
        if (!reply.ok) throw new Error('decision unavailable');
        const text = await reply.text();
        checked();
        if (text.length > 600000) throw new Error('decision too large');
        const envelope = object(JSON.parse(text));
        const expanded = object(envelope.data || envelope);
        // Passport keeps 2046 on a valid expanded second-verification decision.
        // It tells the official component to render the challenge.
        const code = Number(expanded.error_code ?? envelope.error_code ?? 0);
        if (code !== 0 && code !== 2046) throw new Error('decision rejected');
        decision = { ...decision, ...expanded };
      }
      checked();
      phase = 'QV04';
      let url;
      try { url = new URL(resolveUrl(decision.url)); }
      catch (error) { phase = error && error.message === 'QV04_EMPTY' ? 'QV04_EMPTY' : 'QV04_FORMAT'; throw error; }
      if (!allowed(url.toString(), 'script')) { phase = 'QV04_HOST'; throw new Error('untrusted script'); }
      const eventParams = parseObject(decision.event_params);
      url.searchParams.set('aid', '386088');
      url.searchParams.set('verify_reason', String(eventParams.verify_reason || ''));
      url.searchParams.set('verify_scene', String(eventParams.verify_scene || ''));
      window.$$account_verify_portrait_id = String(decision.verify_portrait_id || '');
      phase = 'QV02';
      if (!window.ucSecondVerifyReact || !window.ucSecondVerifyReactDom) throw new Error('React unavailable');
      phase = 'QV05';
      if (typeof window.ucWebSecondVerify !== 'function') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          const timer = setTimeout(() => { script.remove(); reject(new Error('script timeout')); }, 20000);
          script.crossOrigin = 'anonymous';
          // The API's 404 document and the component response omit charset.
          // Its Chinese identifiers must not inherit the document's encoding.
          script.charset = 'utf-8';
          script.src = url.toString();
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('script unavailable')); };
          document.head.append(script);
        });
      }
      checked();
      if (typeof window.ucWebSecondVerify !== 'function') throw new Error('component unavailable');
      phase = 'QV06';
      status.textContent = '请在窗口中完成官方验证码或身份验证';
      const now = Date.now();
      const options = {
        ...decision,
        aid: 386088,
        isNewVerifyUI: true,
        generalParams,
        event_params: eventParams,
        verifyFinishCallback: response => finish(Boolean(response && response.status === true)),
        newSecondVerifyWebOptions: { host: 'https://api.qishui.com', verifyAppName: '汽水音乐移动端' },
        newSecondVerificationCall: { reportAppLog: () => {} },
        monitorTime: { startTime: now, fetchEndTime: now, scriptLoadStartTime: now, scriptLoadEndTime: now, renderStartTime: now },
        fun: decision.verify_from === 'verify_center' ? 'verify_center' : 'verify',
        uc_account_verify_version: '1.0.29',
      };
      const invoked = window.ucWebSecondVerify(options);
      if (invoked && typeof invoked.then === 'function') invoked.catch(() => {
        if (done) return;
        done = true;
        status.textContent = '安全验证未能完成，请关闭窗口后重试';
        rejectResult(new Error('汽水音乐安全验证未完成（QV07），请重新扫码'));
      });
    };
    run().catch(() => {
      if (done) return;
      done = true;
      status.textContent = '安全验证加载失败，请关闭窗口后重试';
      rejectResult(new Error('汽水音乐安全验证加载失败（' + phase + '），请重新扫码'));
    });
    try { return await result; }
    finally {
      cancel.removeEventListener('click', cancelVerification);
      if (window.__linklineCancelQishuiVerification === cancelVerification) delete window.__linklineCancelQishuiVerification;
    }
  })()`
}
