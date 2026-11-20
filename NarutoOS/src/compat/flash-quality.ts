// Runs in the page world: PPAPI's scriptable Flash methods live there.
export function installFlashQuality(initial: string) {
  const host = window as any;
  if (host.__narutoDefaultQuality) { host.__narutoDefaultQuality(initial); return; }
  let quality = initial;
  const objects = new Map<Element, { timer?: number; attempts: number }>();
  const documents = new WeakSet<Document>();
  function apply(element: Element) {
    const item = objects.get(element)!;
    if (item.timer) clearTimeout(item.timer);
    if (!element.isConnected) { objects.delete(element); return; }
    const flash = element as any;
    try {
      if (typeof flash.SetVariable === 'function' && typeof flash.PercentLoaded === 'function' && flash.PercentLoaded() >= 100) {
        flash.SetVariable('_quality', quality.toUpperCase());
        return;
      }
    } catch { /* The movie may still be starting. */ }
    if (++item.attempts < 120) item.timer = window.setTimeout(() => apply(element), 500);
  }
  function scan(doc: Document) {
    for (const element of Array.from(doc.querySelectorAll('object,embed'))) {
      if (objects.has(element)) continue;
      const type = element.getAttribute('type') || '';
      const source = element.getAttribute('data') || element.getAttribute('src') || '';
      if (!/application\/x-shockwave-flash/i.test(type) && !/\.swf(?:[?#]|$)/i.test(source)) continue;
      element.setAttribute('quality', quality);
      if (element.tagName === 'OBJECT') {
        let param = Array.from(element.querySelectorAll('param')).find(p => p.name.toLowerCase() === 'quality');
        if (!param) { param = doc.createElement('param'); param.name = 'quality'; element.appendChild(param); }
        param.value = quality;
      }
      objects.set(element, { attempts: 0 }); apply(element);
    }
    for (const frame of Array.from(doc.querySelectorAll('iframe,frame'))) {
      try { const child = (frame as HTMLIFrameElement).contentDocument; if (child) watch(child); } catch { /* Cross-origin frames retain their own settings. */ }
      if (!(frame as any).__narutoQualityLoad) {
        (frame as any).__narutoQualityLoad = true;
        frame.addEventListener('load', () => scan(doc));
      }
    }
    for (const [element, item] of objects) if (!element.isConnected) { if (item.timer) clearTimeout(item.timer); objects.delete(element); }
  }
  function watch(doc: Document) {
    if (documents.has(doc)) return;
    documents.add(doc);
    new MutationObserver(() => scan(doc)).observe(doc, { childList: true, subtree: true });
    scan(doc);
  }
  host.__narutoDefaultQuality = (value: string) => {
    if (!['low', 'medium', 'high'].includes(value)) return;
    quality = value;
    for (const [element, item] of objects) { item.attempts = 0; apply(element); }
  };
  watch(document);
  window.addEventListener('pagehide', () => { for (const item of objects.values()) if (item.timer) clearTimeout(item.timer); });
}
