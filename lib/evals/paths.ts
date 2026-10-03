export interface PathMention { raw: string; start: number; end: number }
export interface PathEvaluation { version: string; score: 0 | 1; checked: PathMention[]; invented: PathMention[] }

export const pathEvaluatorVersion = 'exact-paths-v1';
export const pathGrammarLimitations = 'Unquoted whitespace paths are separate lexical pieces. Frame paths containing spaces or punctuation in code or quotes. Bare dotted prose and slash-separated prose can be path-shaped; the evaluator never uses the allowed list to reinterpret them.';

function pathShaped(raw: string): boolean {
  if (!raw || !/[\p{L}\p{N}_]/u.test(raw)) return false;
  return /[/\\]/.test(raw) || /\.[\p{L}\p{N}_-]+(?:[.,!?;:]*)$/u.test(raw);
}
function delimiter(character: string): boolean {
  return /[\s`'"*(){}<>\[\],;!]/u.test(character);
}

function pathMentions(body: string): PathMention[] {
  const result: PathMention[] = [];
  function scan(start: number, end: number): void {
    let cursor = start;
    while (cursor < end) {
      const character = body[cursor];
      const quoteBoundary = cursor === start || delimiter(body[cursor - 1]) || body[cursor - 1] === ':';
      if (character === '`' || (quoteBoundary && (character === '"' || character === "'"))) {
        let markerEnd = cursor + 1;
        if (character === '`') while (markerEnd < end && body[markerEnd] === '`') markerEnd++;
        const marker = body.slice(cursor, markerEnd);
        let closing = body.indexOf(marker, markerEnd);
        while (closing !== -1 && character === '`' && (body[closing - 1] === '`' || body[closing + marker.length] === '`')) {
          closing = body.indexOf(marker, closing + marker.length);
        }
        if (closing !== -1 && closing + marker.length <= end) {
          const raw = body.slice(markerEnd, closing);
          if (!/[\r\n]/.test(raw) && pathShaped(raw)) result.push({ raw, start: markerEnd, end: closing });
          else scan(markerEnd, closing);
          cursor = closing + marker.length;
          continue;
        }
      }
      if (delimiter(character) || character === ':') { cursor++; continue; }
      const tokenStart = cursor;
      const url = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(body.slice(cursor, end));
      const drive = /^[A-Za-z]:\\/.test(body.slice(cursor, end));
      if (url) cursor += url[0].length;
      else if (drive) cursor += 3;
      while (cursor < end && !delimiter(body[cursor]) &&
        (url || (body[cursor] !== ':' && body[cursor] !== '?'))) cursor++;
      let tokenEnd = cursor;
      while (tokenEnd > tokenStart && body[tokenEnd - 1] === '.') tokenEnd--;
      const raw = body.slice(tokenStart, tokenEnd);
      if (pathShaped(raw)) result.push({ raw, start: tokenStart, end: tokenEnd });
      if (cursor === tokenStart || body[cursor] === '?') cursor++;
    }
  }
  scan(0, body.length);
  return result;
}

export function evaluatePaths(body: string, allowedPaths: readonly string[]): PathEvaluation {
  const allowed = new Set(allowedPaths);
  const checked = pathMentions(body);
  const invented = checked.filter(mention => !allowed.has(mention.raw));
  return { version: pathEvaluatorVersion, score: invented.length ? 0 : 1, checked, invented };
}
