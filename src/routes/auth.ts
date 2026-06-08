import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { sendOtp, verifyOtp } from '../lib/twilio';
import { supabase } from '../lib/supabase';
import { signToken } from '../lib/jwt';
import { uploadImage } from '../lib/storage';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

const otpLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── POST /auth/send-otp ─────────────────────────────────────────────────────
router.post('/send-otp', otpLimit, async (req, res): Promise<void> => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !/^\+\d{7,15}$/.test(phone)) {
    res.status(400).json({ error: 'Invalid phone number format. Use E.164 (e.g. +15555551234)' });
    return;
  }

  try {
    await sendOtp(phone);
    res.json({ status: 'pending' });
  } catch (err: any) {
    if (err.code === 'INVALID_LINE_TYPE') {
      res.status(400).json({ error: err.message, code: err.code });
    } else {
      console.error('sendOtp error:', err);
      res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
    }
  }
});

// ─── POST /auth/verify-otp ───────────────────────────────────────────────────
router.post('/verify-otp', async (req, res): Promise<void> => {
  const { phone, code } = req.body as { phone?: string; code?: string };

  if (!phone || !code) {
    res.status(400).json({ error: 'Phone and code are required' });
    return;
  }

  let approved: boolean;
  try {
    approved = await verifyOtp(phone, code);
  } catch (err: any) {
    console.error('verifyOtp error:', err);
    res.status(500).json({ error: 'Verification service unavailable' });
    return;
  }

  if (!approved) {
    res.status(400).json({ error: 'Incorrect or expired code' });
    return;
  }

  // Look up existing profile by phone
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
      .insert({ phone, email: `${phone.replace(/\D/g, '')}@keylink.app` })
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
