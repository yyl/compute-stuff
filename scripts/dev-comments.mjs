import { startLocalServer } from '../test/local-server.mjs';
const port = Number(process.env.COMMENTS_DEMO_PORT || 8789);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('COMMENTS_DEMO_PORT must be a valid port.');
const server = await startLocalServer({ port });
console.log(`Local Hugo blog and comments demo: ${server.base}/posts/hello-world/`);
console.log(`Moderation: ${server.base}/__local/comments-login`);
console.log('Disposable local data; login and spam checks are simulated. Production settings are untouched.');
console.log('Press Ctrl+C to stop. Comments reset when the demo restarts.');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true; await server.close();
});
