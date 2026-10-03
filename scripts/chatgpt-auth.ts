import { connectLocalChatGPT, disconnectLocalChatGPT, getLocalChatGPTStatus, LocalChatGPTError } from '../lib/ai/local-auth.ts';

const [command, flag, userId, ...extra] = process.argv.slice(2);
async function main() {
  if (extra.length || (flag !== undefined && flag !== '--user') || (flag === '--user' && !userId) ||
      !['connect', 'status', 'disconnect'].includes(command ?? '') || (command !== 'status' && !userId)) {
    throw new LocalChatGPTError('usage', 'Usage: node scripts/chatgpt-auth.ts connect|disconnect --user user_ID, or status [--user user_ID].');
  }
  if (command === 'connect') {
    console.log('Opening ChatGPT sign-in for Cartograph. Review and grant ChatGPT plan usage in your browser.');
    const state = await connectLocalChatGPT(userId);
    console.log(state.sharing ? 'Connected. ChatGPT plan usage is authorized for the selected application user.' : 'Signed in. ChatGPT plan usage was not granted.');
  } else if (command === 'disconnect') {
    await disconnectLocalChatGPT(userId);
    console.log('Disconnected. Local credentials were removed.');
  } else {
    const state = await getLocalChatGPTStatus(userId);
    console.log(`Connection: ${state.status}. Plan usage: ${state.sharing ? 'enabled' : 'disabled'}. Selected application user: ${state.authorized ? 'authorized' : 'not authorized'}.`);
    if (state.identity?.email || state.identity?.name) console.log(`Account: ${state.identity.email ?? state.identity.name}.`);
    console.log(`Manage usage: ${state.usageURL}`);
  }
}
main().catch(error => {
  console.error(error instanceof LocalChatGPTError ? `${error.code}: ${error.message}` : 'Local ChatGPT authentication failed. Check directory permissions and retry.');
  process.exitCode = 1;
});
