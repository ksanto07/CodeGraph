import 'server-only';

export function pipelineWriteCredential(): string {
  const value = process.env.PIPELINE_WRITE_SECRET;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Configure PIPELINE_WRITE_SECRET and its database hash before starting an analysis.');
  return value;
}
