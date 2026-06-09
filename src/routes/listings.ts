import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/storage';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { scoreApplication } from '../lib/claude';
import { notifyUser } from '../lib/notifications';

const router = Router();

// Normalize DB listing columns to the shape the mobile app expects
function normalizeListing(l: any) {
  return {
    ...l,
    price: l.monthly_rent,
    sqft: l.living_area_sqft,
    availableFrom: l.available_date,
    status: l.rental_status ?? 'active',
  };
}

// ─── GET /listings ────────────────────────────────────────────────────────────
router.get('/', async (req, res): Promise<void> => {
  const { city, minPrice, maxPrice, bedrooms, propertyType, page = '1', limit = '20' } = req.query as Record<string, string>;

  let query = supabase
    .from('listings')
    .select('*', { count: 'exact' })
    .eq('rental_status', 'active')
    .order('refreshed_at', { ascending: false })
    .range((+page - 1) * +limit, +page * +limit - 1);

  if (city) query = query.ilike('city', `%${city}%`);
  if (minPrice) query = query.gte('monthly_rent', +minPrice);
  if (maxPrice) query = query.lte('monthly_rent', +maxPrice);
  if (bedrooms) query = query.eq('bedrooms', +bedrooms);
  if (propertyType) query = query.eq('property_type', propertyType);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ listings: (data ?? []).map(normalizeListing), total: count ?? 0 });
});

// ─── GET /listings/mine ───────────────────────────────────────────────────────
router.get('/mine', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('landlord_id', req.userId)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map(normalizeListing));
});

// ─── GET /listings/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res): Promise<void> => {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Listing not found' }); return; }

  // Increment view count (fire and forget)
  supabase.from('listings').update({ view_count: (data.view_count ?? 0) + 1 }).eq('id', data.id).then(() => {});

  res.json(normalizeListing(data));
});

// ─── POST /listings ───────────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  upload.array('photos', 30),
  async (req: AuthRequest, res): Promise<void> => {
    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length < 10) {
      res.status(400).json({ error: 'At least 10 photos are required' });
      return;
    }

    const {
      title, description, address, city, state, zip,
      price, bedrooms, bathrooms, sqft, propertyType,
      availableFrom, amenities,
    } = req.body as Record<string, string>;

    if (!title || !address || !city || !price || !bedrooms) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Get landlord contact info from profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email, phone')
      .eq('id', req.userId)
      .single();

    let photoUrls: string[];
    try {
      photoUrls = await Promise.all(
        files.map((f) => uploadImage(f.buffer, 'listings', { width: 1400, quality: 80 }))
      );
    } catch (err: any) {
      console.error('Photo upload error:', err);
      res.status(500).json({ error: 'Failed to upload photos' });
      return;
    }

    const { data, error } = await supabase
      .from('listings')
      .insert({
        landlord_id: req.userId,
        title,
        description,
        address,
        city,
        state,
        zip,
        monthly_rent: +price,
        bedrooms: +bedrooms,
        bathrooms: +(bathrooms ?? 1),
        living_area_sqft: +(sqft ?? 0),
        property_type: propertyType ?? 'house',
        available_date: availableFrom ?? null,
        amenities: JSON.parse(amenities ?? '[]'),
        photos: photoUrls,
        rental_status: 'active',
        view_count: 0,
        applicant_count: 0,
        refreshed_at: new Date().toISOString(),
        listed_date: new Date().toISOString().split('T')[0],
        contact_name: profile?.display_name ?? null,
        contact_email: profile?.email ?? null,
        contact_phone: profile?.phone ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Could not create listing' });
      return;
    }
    res.status(201).json(normalizeListing(data));
  }
);

// ─── PUT /listings/:id ────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: listing } = await supabase
    .from('listings')
    .select('landlord_id')
    .eq('id', req.params.id)
    .single();

  if (!listing || listing.landlord_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const fieldMap: Record<string, string> = {
    price: 'monthly_rent',
    sqft: 'living_area_sqft',
    availableFrom: 'available_date',
    status: 'rental_status',
  };
  const allowed = ['title', 'description', 'price', 'sqft', 'availableFrom', 'amenities', 'status', 'property_type'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const dbKey = fieldMap[key] ?? key;
      updates[dbKey] = req.body[key];
    }
  }

  const { data, error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(normalizeListing(data));
});

// ─── DELETE /listings/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: listing } = await supabase
    .from('listings')
    .select('landlord_id')
    .eq('id', req.params.id)
    .single();

  if (!listing || listing.landlord_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  await supabase.from('listings').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── POST /listings/:id/refresh ───────────────────────────────────────────────
router.post('/:id/refresh', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: listing } = await supabase
    .from('listings')
    .select('landlord_id, refreshed_at')
    .eq('id', req.params.id)
    .single();

  if (!listing || listing.landlord_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  if (listing.refreshed_at) {
    const lastRefresh = new Date(listing.refreshed_at).getTime();
    if (Date.now() - lastRefresh < 24 * 60 * 60 * 1000) {
      res.status(429).json({ error: 'You can only refresh once every 24 hours' });
      return;
    }
  }

  const { data, error } = await supabase
    .from('listings')
    .update({ refreshed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(normalizeListing(data));
});

// ─── POST /listings/:id/apply ─────────────────────────────────────────────────
router.post('/:id/apply', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { message, income, tenantPhone, tenantName } = req.body as Record<string, string>;

  if (!message || !income) {
    res.status(400).json({ error: 'Message and income are required' });
    return;
  }

  const { data: existing } = await supabase
    .from('applications')
    .select('id')
    .eq('listing_id', req.params.id)
    .eq('tenant_id', req.userId)
    .single();

  if (existing) {
    res.status(409).json({ error: 'You have already applied to this listing' });
    return;
  }

  const { data: listing } = await supabase
    .from('listings')
    .select('monthly_rent, bedrooms, property_type, landlord_id')
    .eq('id', req.params.id)
    .single();

  let aiScore = null;
  let aiSummary = null;
  if (listing) {
    try {
      const result = await scoreApplication({
        listing: { price: listing.monthly_rent, bedrooms: listing.bedrooms, propertyType: listing.property_type ?? 'house' },
        application: { income: +income, message },
      });
      aiScore = result.score;
      aiSummary = result.summary;
    } catch (e) {
      console.error('AI scoring failed (non-fatal):', e);
    }
  }

  const { data: application, error } = await supabase
    .from('applications')
    .insert({
      listing_id: req.params.id,
      tenant_id: req.userId,
      tenant_name: tenantName,
      tenant_phone: tenantPhone,
      message,
      income: +income,
      ai_match_score: aiScore,
      ai_summary: aiSummary,
      status: 'pending',
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  supabase.rpc('increment_applicant_count', { listing_id: req.params.id }).then(() => {});

  // Notify landlord of new application (fire and forget)
  if (listing?.landlord_id) {
    const { data: tenant } = await supabase
      .from('profiles').select('display_name').eq('id', req.userId).single();
    notifyUser(supabase, listing.landlord_id, {
      title: '📋 New Application',
      body: `${tenant?.display_name ?? 'Someone'} applied to your listing`,
      data: { screen: 'applications', listingId: req.params.id },
    }).catch(() => {});
  }

  res.status(201).json(application);
});

// ─── GET /listings/:id/applications ──────────────────────────────────────────
router.get('/:id/applications', requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { data: listing } = await supabase
    .from('listings')
    .select('landlord_id')
    .eq('id', req.params.id)
    .single();

  if (!listing || listing.landlord_id !== req.userId) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('listing_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

export default router;
