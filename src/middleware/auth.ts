import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { supabase } from '../lib/supabase';

export interface AuthRequest extends Request {
  userId?: string;
  userPhone?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.userId = payload.userId;
    req.userPhone = payload.phone;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Verify user exists and return their row — call after requireAuth
export async function loadUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.userId)
    .single();

  if (error || !data) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  (req as any).user = data;
  next();
}
