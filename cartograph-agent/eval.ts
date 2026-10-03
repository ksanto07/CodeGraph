if (!process.argv.includes('--live')) process.argv.push('--live');
await import('./verify-runtime.ts');
export {};
