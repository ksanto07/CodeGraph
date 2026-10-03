export interface RepositoryAddress { owner: string; name: string; slug: string }

export function repositoryAddress(input: string): RepositoryAddress {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a public GitHub repository URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Use an HTTPS github.com repository URL without credentials, a query, or a fragment.');
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('Use the repository URL, without a branch or file path.');
  const owner = parts[0].toLowerCase();
  const name = parts[1].replace(/\.git$/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(owner) || !/^[a-z0-9_.-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error('The GitHub owner or repository name is invalid.');
  }
  return { owner, name, slug: `${owner}/${name}` };
}
