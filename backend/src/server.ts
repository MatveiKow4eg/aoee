import { createApp, env } from './app';

const app = createApp();
app.set('trust proxy', true);

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`);
});
