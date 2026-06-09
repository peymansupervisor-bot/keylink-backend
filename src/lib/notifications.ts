/**
 * Expo Push Notification sender.
 * Uses Expo's Push API — no SDK needed on the server side.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
}

/**
 * Send a push notification to one or more Expo push tokens.
 * Silently ignores invalid / unregistered tokens.
 */
export async function sendPushNotification(
  tokens: string | string[],
  payload: PushPayload
): Promise<void> {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter((t) => t && t.startsWith('ExponentPushToken['));

  if (valid.length === 0) return;

  const messages = valid.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? 'default',
    badge: payload.badge,
    channelId: 'default',
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error('[push] Expo API error:', res.status, await res.text());
      return;
    }

    const result = await res.json() as any;
    // Log any per-token errors (DeviceNotRegistered, etc.) but don't throw
    for (const ticket of result?.data ?? []) {
      if (ticket.status === 'error') {
        console.warn('[push] ticket error:', ticket.message, ticket.details);
      }
    }
  } catch (err) {
    console.error('[push] Failed to send notification:', err);
  }
}

/**
 * Look up the push token for a user and send them a notification.
 * Requires a Supabase client with service-role access.
 */
export async function notifyUser(
  supabase: any,
  userId: string,
  payload: PushPayload
): Promise<void> {
  const { data } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', userId)
    .single();

  if (data?.push_token) {
    await sendPushNotification(data.push_token, payload);
  }
}
