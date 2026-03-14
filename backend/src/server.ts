import { createApp, env } from './app';

const app = createApp();
// Trust only the first reverse proxy (typical for nginx / load balancer setups).
// This is safer for IP-based rate limiting than `true`.
app.set('trust proxy', 1);

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`);
});
