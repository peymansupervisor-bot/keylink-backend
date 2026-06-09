import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── POST /notifications/register ────────────────────────────────────────────
// Called by the app on login/foreground to save the device push token
router.post('/register', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { token } = req.body as { token?: string };

  if (!token || !token.startsWith('ExponentPushToken[')) {
    res.status(400).json({ error: 'Valid Expo push token required' });
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ push_token: token })
    .eq('id', req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

// ─── DELETE /notifications/register ──────────────────────────────────────────
// Called on logout to unregister the device
router.delete('/register', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await supabase
    .from('profiles')
    .update({ push_token: null })
    .eq('id', req.userId);

  res.json({ ok: true });
});

export default router;
