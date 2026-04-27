import { createApp } from './app';
import { getStripe } from './lib/stripe';
import { sendLicenseEmail } from './lib/resend';

const app = createApp({ getStripe, sendLicenseEmail });

export default app;
