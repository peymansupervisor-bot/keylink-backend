import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── GET /applications/mine ───────────────────────────────────────────────────
// Returns all applications the authenticated tenant has submitted,
// joined with the listing snapshot they applied to.
router.get('/mine', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data, error } = await supabase
    .from('applications')
    .select(`
      id,
      listing_id,
      status,
      message,
      income,
      ai_match_score,
      ai_summary,
      created_at,
      listings (
        id,
        title,
        address,
        city,
        state,
        monthly_rent,
        bedrooms,
        bathrooms,
        property_type,
        photos,
        rental_status
      )
    `)
    .eq('tenant_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const result = (data ?? []).map((row: any) => ({
    id: row.id,
    listingId: row.listing_id,
    status: row.status,
    message: row.message,
    income: row.income,
    aiMatchScore: row.ai_match_score,
    aiSummary: row.ai_summary,
    createdAt: row.created_at,
    listing: row.listings
      ? {
          id: row.listings.id,
          title: row.listings.title,
          address: row.listings.address,
          city: row.listings.city,
          state: row.listings.state,
          price: row.listings.monthly_rent,
          bedrooms: row.listings.bedrooms,
          bathrooms: row.listings.bathrooms,
          propertyType: row.listings.property_type,
          photos: row.listings.photos ?? [],
          status: row.listings.rental_status,
        }
      : null,
  }));

  res.json(result);
});

// ─── DELETE /applications/:id ─────────────────────────────────────────────────
// Tenant withdraws their own application (only if still pending)
router.delete('/:id', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: app } = await supabase
    .from('applications')
    .select('id, tenant_id, status')
    .eq('id', req.params.id)
    .single();

  if (!app || app.tenant_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  if (app.status !== 'pending') {
    res.status(409).json({ error: 'Only pending applications can be withdrawn' });
    return;
  }

  await supabase.from('applications').update({ status: 'withdrawn' }).eq('id', app.id);
  res.json({ ok: true });
});

export default router;
