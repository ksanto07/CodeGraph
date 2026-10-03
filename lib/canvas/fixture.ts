import raw from './fixture.json';
import { validateParseResult } from '../parser/result-file';
import { runnerConfigAdapter } from '../adapters/entry-points';
import type { ParseResult } from '../parser/types';

const parsed = validateParseResult(raw);
export const fixture: ParseResult = { ...parsed, files: parsed.files.map(file => ({ ...file, annotations: runnerConfigAdapter.annotate(file) })) };
