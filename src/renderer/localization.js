(() => {
  const { languages, messages } = window.localeCatalog;
  const exact = new Map(messages.map(row => [row[0], row]));
  const patterns = [...exact.values()].filter(row => row[0].includes('{')).map(row => {
    const keys = [];
    const escaped = row[0].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{([^{}]+)\}/g, (_, key) => { keys.push(key); return '(.+?)'; });
    return { row, keys, regex: new RegExp('^' + escaped + '$', 'u') };
  });
  let language = 'ko';
  const originals = new WeakMap();
  function t(source, args = {}) {
    let row = exact.get(source);
    if (!row) for (const entry of patterns) {
      const match = source.match(entry.regex);
      if (match) { row = entry.row; args = Object.fromEntries(entry.keys.map((key, index) => [key, match[index + 1]])); break; }
    }
    if (!row && source.includes(' · ')) return source.split(' · ').map(part => t(part)).join(' · ');
    return (row?.[languages.indexOf(language)] ?? source).replace(/\{([^{}]+)\}/g, (match, key) => {
      const value = String(args[key] ?? match);
      return exact.get(value)?.[languages.indexOf(language)] ?? value;
    });
  }
  function convert(node, key, value) {
    let saved = originals.get(node);
    if (!saved) { saved = {}; originals.set(node, saved); }
    const record = saved[key];
    const source = record?.rendered === value ? record.source : value;
    const trimmed = source.trim();
    const rendered = trimmed ? source.replace(trimmed, t(trimmed)) : source;
    saved[key] = { source, rendered };
    return rendered;
  }
  function visit(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement?.closest('script,style,[data-no-translate]')) return;
      const value = convert(root, 'text', root.nodeValue);
      if (value !== root.nodeValue) root.nodeValue = value;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.matches('script,style,[data-no-translate]')) return;
      for (const name of ['title', 'aria-label', 'placeholder']) if (root.hasAttribute(name)) {
        const value = convert(root, name, root.getAttribute(name));
        if (value !== root.getAttribute(name)) root.setAttribute(name, value);
      }
    }
    for (const child of root.childNodes) visit(child);
  }
  const observer = new MutationObserver(records => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) visit(node);
      else visit(record.target);
    }
    observe();
  });
  function observe() { observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] }); }
  function apply(settings) {
    const code = (settings.language === 'system' ? navigator.language : settings.language ?? 'ko').toLowerCase().split(/[-_]/)[0];
    language = languages.includes(code) ? code : 'en';
    document.documentElement.lang = language;
    observer.disconnect(); visit(document); observe();
    window.dispatchEvent(new Event('language-changed'));
  }
  window.i18n = { t, get language() { return language; } };
  window.addEventListener('preferences-changed', event => apply(event.detail));
  observe();
})();
