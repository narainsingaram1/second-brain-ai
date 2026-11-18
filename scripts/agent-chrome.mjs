// The real extension core (extension/agent-core.js) on a real Chrome tab, over the DevTools protocol: a stand-in
// for the chrome.* APIs the extension uses, so tests and the model benchmark run the same code the extension
// ships rather than a copy of it.
export const APP = 'http://localhost:5173';

/** Enough of the extension API, over the DevTools protocol, for one tab. Frame ids: 0 is the page. */
export async function cdpChrome(cdp, agentSource) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  const ids = new Map(); // CDP frame id -> number
  let nextId = 1;
  const worlds = new Map(); // CDP frame id -> isolated world context
  const evalIn = async (expression, contextId) => {
    const r = await send('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  async function frames() {
    const { frameTree } = await send('Page.getFrameTree');
    const list = [];
    const visit = (node, top) => {
      if (!ids.has(node.frame.id)) ids.set(node.frame.id, top ? 0 : nextId++);
      list.push({ cdpId: node.frame.id, frameId: ids.get(node.frame.id), url: node.frame.url });
      for (const child of node.childFrames || []) visit(child, false);
    };
    visit(frameTree, true);
    return list;
  }
  async function inWorld(frame, expression) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (!worlds.has(frame.cdpId)) worlds.set(frame.cdpId, (await send('Page.createIsolatedWorld', { frameId: frame.cdpId, worldName: 'synapse-agent' })).executionContextId);
        return await evalIn(expression, worlds.get(frame.cdpId));
      } catch (error) {
        if (attempt === 0 && /context|Cannot find|destroyed/i.test(error.message)) { worlds.delete(frame.cdpId); continue; }
        throw error;
      }
    }
  }
  const store = { local: { pairedOrigins: [APP] }, session: {} };
  const area = name => ({ get: async key => ({ [key]: store[name][key] }), set: async values => { Object.assign(store[name], values); } });
  const TAB = 1;
  const tabInfo = async () => ({ id: TAB, url: await evalIn('location.href'), title: await evalIn('document.title'), status: (await evalIn('document.readyState')) === 'complete' ? 'complete' : 'loading' });
  const navigate = async url => { worlds.clear(); await send('Page.navigate', { url }); };
  const chrome = {
    tabs: {
      create: async ({ url }) => { await navigate(url); return { id: TAB, url, status: 'loading' }; },
      update: async (_id, { url }) => { await navigate(url); return { id: TAB, url, status: 'loading' }; },
      get: async () => tabInfo(),
      remove: async () => {}, group: async () => 1, query: async () => [await tabInfo()],
    },
    tabGroups: { get: async () => ({}), update: async () => ({}) },
    storage: { local: area('local'), session: area('session') },
    scripting: {
      async executeScript({ target, files, func, args }) {
        const all = await frames();
        const chosen = target.allFrames ? all : target.frameIds ? all.filter(f => target.frameIds.includes(f.frameId)) : all.filter(f => f.frameId === 0);
        if (target.frameIds && !chosen.length) throw new Error(`No frame with id ${target.frameIds[0]}.`);
        const out = [];
        for (const frame of chosen) {
          if (!/^https?:/.test(frame.url)) continue; // Like Chrome: nothing is injected into about:blank here.
          if (files) { await inWorld(frame, agentSource); out.push({ frameId: frame.frameId }); continue; }
          out.push({ frameId: frame.frameId, result: await inWorld(frame, `(${func})(${JSON.stringify(args[0])})`) });
        }
        return out;
      },
    },
  };
  /** Evaluates in the page's main world of the first frame whose address matches (cross-origin frames included). */
  const evalInFrame = async (match, expression) => {
    const frame = (await frames()).find(f => f.frameId !== 0 && match.test(f.url));
    if (!frame) return undefined;
    const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frame.cdpId, worldName: 'synapse-check' });
    return evalIn(expression, executionContextId);
  };
  return { chrome, evalIn, evalInFrame, frames, send, close: () => cdp.send('Target.closeTarget', { targetId }) };
}

/** Real input and screenshots like extension/cdp.js, over the test's DevTools session. `ready` decides when it is on. */
export function realInput(send, ready = async () => true) {
  const KEYS = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Backspace: { code: 'Backspace', keyCode: 8 } };
  return {
    ready, detach: async () => {}, detachAll: async () => {},
    async click(_tab, x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    },
    move: (_tab, x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
    insertText: (_tab, text) => send('Input.insertText', { text }),
    async key(_tab, name) { const k = KEYS[name]; const base = { key: name, code: k.code, windowsVirtualKeyCode: k.keyCode }; await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); },
    async shot() {
      const { cssVisualViewport: v } = await send('Page.getLayoutMetrics');
      const scale = Math.min(1, 1280 / v.clientWidth);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale } });
      return { dataUrl: `data:image/jpeg;base64,${data}`, scale, width: Math.round(v.clientWidth * scale), height: Math.round(v.clientHeight * scale) };
    },
    async screenshot() { return (await this.shot()).dataUrl; },
  };
}

