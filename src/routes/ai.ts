import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { generateListingContent, generateRentSuggestion } from '../lib/claude';
import rateLimit from 'express-rate-limit';

const router = Router();

const aiLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many AI requests. Please slow down.' },
});

// ─── POST /ai/generate-description ───────────────────────────────────────────
router.post('/generate-description', requireAuth, aiLimit, async (req, res): Promise<void> => {
  const { bedrooms, bathrooms, sqft, propertyType, amenities, address, city } = req.body;

  if (!propertyType || bedrooms === undefined) {
    res.status(400).json({ error: 'bedrooms and propertyType are required' });
    return;
  }

  try {
    const result = await generateListingContent({
      bedrooms: +bedrooms,
      bathrooms: +(bathrooms ?? 1),
      sqft: +(sqft ?? 0),
      propertyType,
      amenities: Array.isArray(amenities) ? amenities : [],
      address: address ?? '',
      city: city ?? '',
    });
    res.json(result);
  } catch (err: any) {
    console.error('AI description error:', err);
    res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
});

// ─── POST /ai/rent-suggestion ─────────────────────────────────────────────────
router.post('/rent-suggestion', requireAuth, aiLimit, async (req, res): Promise<void> => {
  const { city, bedrooms, bathrooms, sqft, propertyType, amenities } = req.body;

  if (!city || bedrooms === undefined || !propertyType) {
    res.status(400).json({ error: 'city, bedrooms, and propertyType are required' });
    return;
  }

  try {
    const result = await generateRentSuggestion({
      city,
      bedrooms: +bedrooms,
      bathrooms: +(bathrooms ?? 1),
      sqft: +(sqft ?? 0),
      propertyType,
      amenities: Array.isArray(amenities) ? amenities : [],
    });
    res.json(result);
  } catch (err: any) {
    console.error('AI rent suggestion error:', err);
    res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
});

export default router;
