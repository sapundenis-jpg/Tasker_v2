import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import webpush from 'web-push';

dotenv.config();

const app = express();
const port = process.env.PORT || 8787;
const subscriptions = new Map();

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:you@example.com';

if (!publicKey || !privateKey) {
  console.warn('Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env. Run: npm run keys');
} else {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, subscriptions: subscriptions.size, hasVapidKeys: Boolean(publicKey && privateKey) });
});

app.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey });
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Missing subscription endpoint' });
  subscriptions.set(subscription.endpoint, subscription);
  res.json({ ok: true, subscriptions: subscriptions.size });
});

app.post('/notify', async (req, res) => {
  const payload = JSON.stringify({
    title: req.body.title || 'FocusFlow',
    body: req.body.body || 'Пора вернуться к плану.',
    tag: req.body.tag || 'focusflow-reminder'
  });
  const results = [];
  for (const [endpoint, subscription] of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      results.push({ endpoint, ok: true });
    } catch (error) {
      results.push({ endpoint, ok: false, statusCode: error.statusCode });
      if (error.statusCode === 404 || error.statusCode === 410) subscriptions.delete(endpoint);
    }
  }
  res.json({ ok: true, sent: results.filter(r => r.ok).length, results });
});

app.listen(port, () => {
  console.log(`FocusFlow push server listening on http://localhost:${port}`);
});
