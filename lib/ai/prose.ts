export type ProseInline = { kind: 'text' | 'code'; text: string } | { kind: 'bold'; children: ProseInline[] };
export type ProseBlock = { kind: 'paragraph'; children: ProseInline[] } | { kind: 'list'; items: ProseInline[][] };

function inline(text: string): ProseInline[] {
  const tokens: ProseInline[] = [];
  const clean = (value: string) => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*#]/g, '');
  const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) tokens.push({ kind: 'text', text: clean(text.slice(offset, match.index)) });
    tokens.push(match[1] !== undefined ? { kind: 'code', text: match[1] } : { kind: 'bold', children: inline(match[2]) });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) tokens.push({ kind: 'text', text: clean(text.slice(offset)) });
  return tokens;
}

export function explanationProse(body: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', children: inline(paragraph.join(' ')) }); paragraph = []; };
  for (const original of body.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || /^```/.test(line)) { flush(); continue; }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      flush();
      const previous = blocks.at(-1);
      if (previous?.kind === 'list') previous.items.push(inline(bullet[1]));
      else blocks.push({ kind: 'list', items: [inline(bullet[1])] });
    } else paragraph.push(line.replace(/^#{1,6}\s*/, ''));
  }
  flush();
  return blocks;
}

export function repositoryPathParts(text: string, paths: readonly string[]): { text: string; path?: string }[] {
  const parts: { text: string; path?: string }[] = [];
  let offset = 0;
  while (offset < text.length) {
    let nearest: { index: number; path: string } | undefined;
    for (const path of paths) {
      if (!path) continue;
      let index = text.indexOf(path, offset);
      while (index !== -1) {
        const before = text[index - 1] ?? '';
        const after = text[index + path.length] ?? '';
        const continuation = after === '.' ? /[A-Za-z0-9_]/.test(text[index + path.length + 1] ?? '') : /[A-Za-z0-9_\/-]/.test(after);
        if (!/[A-Za-z0-9_.\/-]/.test(before) && !continuation) {
          if (!nearest || index < nearest.index || index === nearest.index && path.length > nearest.path.length) nearest = { index, path };
          break;
        }
        index = text.indexOf(path, index + 1);
      }
    }
    if (!nearest) { parts.push({ text: text.slice(offset) }); break; }
    if (nearest.index > offset) parts.push({ text: text.slice(offset, nearest.index) });
    parts.push({ text: nearest.path, path: nearest.path });
    offset = nearest.index + nearest.path.length;
  }
  return parts;
}
