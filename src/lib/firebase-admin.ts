import admin from 'firebase-admin';

let initialized = false;

function getApp(): admin.app.App {
  if (!initialized) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is missing');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccount)) });
    initialized = true;
  }
  return admin.app();
}

export async function verifyFirebaseToken(idToken: string): Promise<{ phone: string; uid: string }> {
  const decoded = await getApp().auth().verifyIdToken(idToken);
  if (!decoded.phone_number) throw new Error('Token does not contain a phone number');
  return { phone: decoded.phone_number, uid: decoded.uid };
}
