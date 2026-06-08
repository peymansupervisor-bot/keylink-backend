import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── GET /messages/conversations ─────────────────────────────────────────────
router.get('/conversations', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      id,
      listing_id,
      tenant_id,
      landlord_id,
      last_message,
      last_message_at,
      listings (title, photos),
      tenant:profiles!conversations_tenant_id_fkey (id, display_name, avatar_url),
      landlord:profiles!conversations_landlord_id_fkey (id, display_name, avatar_url)
    `)
    .or(`tenant_id.eq.${req.userId},landlord_id.eq.${req.userId}`)
    .order('last_message_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const conversations = await Promise.all((data ?? []).map(async (conv: any) => {
    const isTenant = conv.tenant_id === req.userId;
    const other = isTenant ? conv.landlord : conv.tenant;
    const listing = conv.listings as any;

    const { count } = await supabase
      .from('app_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .neq('sender_id', req.userId)
      .is('read_at', null);

    return {
      id: conv.id,
      listingId: conv.listing_id,
      listingTitle: listing?.title ?? '',
      listingPhoto: listing?.photos?.[0] ?? '',
      otherUserId: other?.id ?? '',
      otherUserName: other?.display_name ?? 'User',
      otherUserAvatar: other?.avatar_url ?? null,
      lastMessage: conv.last_message ?? '',
      lastMessageAt: conv.last_message_at,
      unreadCount: count ?? 0,
    };
  }));

  res.json(conversations);
});

// ─── GET /messages/:conversationId ───────────────────────────────────────────
router.get('/:conversationId', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: conv } = await supabase
    .from('conversations')
    .select('tenant_id, landlord_id')
    .eq('id', req.params.conversationId)
    .single();

  if (!conv || (conv.tenant_id !== req.userId && conv.landlord_id !== req.userId)) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const { before, limit = '50' } = req.query as { before?: string; limit?: string };

  let query = supabase
    .from('app_messages')
    .select('*')
    .eq('conversation_id', req.params.conversationId)
    .order('created_at', { ascending: false })
    .limit(+limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json((data ?? []).reverse());
});

// ─── POST /messages/start ─────────────────────────────────────────────────────
router.post('/start', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { listingId, firstMessage } = req.body as { listingId?: string; firstMessage?: string };

  if (!listingId || !firstMessage?.trim()) {
    res.status(400).json({ error: 'listingId and firstMessage are required' });
    return;
  }

  const { data: listing } = await supabase
    .from('listings')
    .select('landlord_id')
    .eq('id', listingId)
    .single();

  if (!listing) { res.status(404).json({ error: 'Listing not found' }); return; }
  if (listing.landlord_id === req.userId) {
    res.status(400).json({ error: 'You cannot message your own listing' });
    return;
  }

  // Ensure landlord_id is set on listing (website listings may not have it)
  if (!listing.landlord_id) {
    res.status(400).json({ error: 'This listing does not have a linked landlord account' });
    return;
  }

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('listing_id', listingId)
    .eq('tenant_id', req.userId)
    .single();

  let conversationId: string;

  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        listing_id: listingId,
        tenant_id: req.userId,
        landlord_id: listing.landlord_id,
        last_message: firstMessage.trim(),
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !created) { res.status(500).json({ error: 'Could not start conversation' }); return; }
    conversationId = created.id;
  }

  const { data: message, error: msgError } = await supabase
    .from('app_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: req.userId,
      body: firstMessage.trim(),
      delivered_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (msgError || !message) { res.status(500).json({ error: 'Could not send message' }); return; }

  res.status(201).json({ conversationId, message });
});

// ─── POST /messages/:conversationId/read ─────────────────────────────────────
router.post('/:conversationId/read', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const now = new Date().toISOString();

  await supabase
    .from('app_messages')
    .update({ read_at: now })
    .eq('conversation_id', req.params.conversationId)
    .neq('sender_id', req.userId)
    .is('read_at', null);

  res.json({ ok: true, readAt: now });
});

export default router;
