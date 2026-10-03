export interface PathMention { raw: string; start: number; end: number }
export interface PathEvaluation { version: string; score: 0 | 1 | null; checked: PathMention[]; invented: PathMention[]; ambiguous: PathMention[] }
interface PathCandidate extends PathMention { literal: boolean }

export const pathEvaluatorVersion = 'exact-paths-v2';
export const pathEvaluationKey = 'invented_path_free_v2';
export const pathGrammarLimitations = 'Unframed whitespace paths are separate lexical pieces. Unknown unframed slash terms and one-letter dotted suffixes are ambiguous and prevent a passing score. Frame extensionless paths in code or quotes. Filelike prose such as Next.js can still collide with filename syntax; this is a lexical check, not proof of semantic intent.';

function pathShaped(raw: string): boolean {
  if (!raw || !/[\p{L}\p{N}_]/u.test(raw)) return false;
  return /[/\\]/.test(raw) || /\.[\p{L}\p{N}_-]+(?:[.,!?;:]*)$/u.test(raw);
}
function delimiter(character: string): boolean {
  return /[\s`'"*(){}<>\[\],;!]/u.test(character);
}

function definitePath(candidate: PathCandidate): boolean {
  return candidate.literal || /^(?:[/\\]|\.{1,2}[/\\]|[A-Za-z]:\\|[A-Za-z][A-Za-z0-9+.-]*:\/\/|\.[\p{L}\p{N}_])/u.test(candidate.raw) ||
    /\.[\p{L}\p{N}_-]{2,}(?:[.,!?;:]*)$/u.test(candidate.raw);
}

function pathMentions(body: string): PathCandidate[] {
  const result: PathCandidate[] = [];
  function scan(start: number, end: number, literal = false): void {
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
          if (!/[\r\n]/.test(raw) && pathShaped(raw)) result.push({ raw, start: markerEnd, end: closing, literal: true });
          else scan(markerEnd, closing, true);
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
      if (pathShaped(raw)) result.push({ raw, start: tokenStart, end: tokenEnd, literal });
      if (cursor === tokenStart || body[cursor] === '?') cursor++;
    }
  }
  scan(0, body.length);
  return result;
}

export function evaluatePaths(body: string, allowedPaths: readonly string[]): PathEvaluation {
  const allowed = new Set(allowedPaths);
  const candidates = pathMentions(body);
  const mention = ({ raw, start, end }: PathCandidate): PathMention => ({ raw, start, end });
  const unsupported = candidates.filter(candidate => !allowed.has(candidate.raw));
  const invented = unsupported.filter(definitePath).map(mention);
  const ambiguous = unsupported.filter(candidate => !definitePath(candidate)).map(mention);
  return { version: pathEvaluatorVersion, score: invented.length ? 0 : ambiguous.length ? null : 1,
    checked: candidates.map(mention), invented, ambiguous };
}
