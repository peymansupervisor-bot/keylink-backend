import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyFirebaseToken } from '../lib/firebase-admin';
import { supabase } from '../lib/supabase';
import { signToken } from '../lib/jwt';
import { uploadImage } from '../lib/storage';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

const tokenLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /auth/verify-firebase-token ────────────────────────────────────────
// Called by the app after Firebase Phone Auth confirms the OTP on-device.
// Receives the Firebase ID token, validates it, and returns a RentalDom JWT.
router.post('/verify-firebase-token', tokenLimit, async (req, res): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    res.status(400).json({ error: 'idToken is required' });
    return;
  }

  let phone: string;
  try {
    ({ phone } = await verifyFirebaseToken(idToken));
  } catch (err: any) {
    console.error('Firebase token verification error:', err);
    res.status(401).json({ error: 'Invalid or expired authentication token' });
    return;
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('phone', phone)
    .single();

  let user = existing;
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    const { data: created, error } = await supabase
      .from('profiles')
      .insert({ phone, email: `${phone.replace(/\D/g, '')}@rentaldom.com` })
      .select()
      .single();

    if (error || !created) {
      res.status(500).json({ error: 'Could not create user account' });
      return;
    }
    user = created;
  }

  const token = signToken({ userId: user.id, phone: user.phone });
  res.json({ token, user: normalizeUser(user), isNewUser });
});

// ─── POST /auth/complete-profile ─────────────────────────────────────────────
router.post('/complete-profile', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { name, role, avatar } = req.body as { name?: string; role?: string; avatar?: string };

  if (!name || !role || !['tenant', 'landlord'].includes(role)) {
    res.status(400).json({ error: 'Name and valid role are required' });
    return;
  }

  const { data: user, error } = await supabase
    .from('profiles')
    .update({
      display_name: name.trim(),
      role,
      avatar_url: avatar ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.userId)
    .select()
    .single();

  if (error || !user) {
    res.status(500).json({ error: 'Could not update profile' });
    return;
  }

  const token = signToken({ userId: user.id, phone: user.phone });
  res.json({ token, user: normalizeUser(user) });
});

// ─── POST /auth/upload-avatar ─────────────────────────────────────────────────
router.post(
  '/upload-avatar',
  requireAuth,
  upload.single('avatar'),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'No image uploaded' });
      return;
    }
    try {
      const url = await uploadImage(req.file.buffer, 'avatars', { width: 400, height: 400, quality: 88 });
      res.json({ url });
    } catch (err: any) {
      console.error('avatar upload error:', err);
      res.status(500).json({ error: 'Image upload failed' });
    }
  }
);

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: user, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.userId)
    .single();

  if (error || !user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(normalizeUser(user));
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// Map DB profile columns to the shape the mobile app expects
function normalizeUser(p: any) {
  return {
    id: p.id,
    phone: p.phone,
    name: p.display_name,
    role: p.role,
    avatar: p.avatar_url,
    email: p.email,
    createdAt: p.created_at,
  };
}

export default router;
