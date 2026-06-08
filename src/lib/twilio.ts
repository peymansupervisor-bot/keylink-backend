import twilio from 'twilio';

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_VERIFY_SID) {
  throw new Error('Missing Twilio environment variables');
}

export const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const VERIFY_SID = process.env.TWILIO_VERIFY_SID;

// Send OTP — throws if number is VOIP/landline
export async function sendOtp(phone: string): Promise<void> {
  // 1. Check line type — block VOIP and landlines
  const lookup = await twilioClient.lookups.v2
    .phoneNumbers(phone)
    .fetch({ fields: 'line_type_intelligence' });

  const lineType = (lookup as any).lineTypeIntelligence?.type as string | undefined;

  if (lineType && lineType !== 'mobile' && lineType !== 'nonFixedVoip') {
    // nonFixedVoip = Google Voice, Skype, etc. — block those too
    // Only allow 'mobile' line type
    const isVoip = lineType === 'nonFixedVoip' || lineType === 'voip';
    throw Object.assign(
      new Error(isVoip
        ? 'VOIP and internet numbers are not accepted. Please use a real mobile number.'
        : 'Only mobile phone numbers are accepted.'),
      { code: 'INVALID_LINE_TYPE', lineType }
    );
  }

  // 2. Send OTP via Twilio Verify
  await twilioClient.verify.v2
    .services(VERIFY_SID)
    .verifications.create({ to: phone, channel: 'sms' });
}

// Verify OTP — returns true if approved
export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const check = await twilioClient.verify.v2
    .services(VERIFY_SID)
    .verificationChecks.create({ to: phone, code });

  return check.status === 'approved';
}
