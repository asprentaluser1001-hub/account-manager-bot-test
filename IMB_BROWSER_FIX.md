# v6.0.1: Telegram IMB browser handoff

IMB QR downloads and payment-app buttons can fail inside Telegram's embedded
browser on Android or iOS. The app cannot change IMB's hosted page, but can
provide an external-browser route for the same payment.

- Telegram checkout keeps the existing IMB order page visible, rather than
  immediately navigating inside the embedded browser after order creation.
- Open payment in browser calls Telegram WebApp.openLink directly from a tap.
  It does not call that API after awaiting a network request.
- Copy payment link is available for manual browser opening. If clipboard
  access fails, a selectable read-only payment link appears.
- The IMB order, amount and verification remain unchanged. Cashfree retains
  its existing flow. API keys, database schema and webhook URLs do not change.

The frontend build, mocked Android/iOS handoff checks and payment regression
suite pass. Actual QR saving and payment-app launching on physical devices
still require testing; this does not claim to fix IMB's hosted-page code.

Deploy this release from v6.0.0, rebuild the client, then reload checkout. Check
one IMB booking in Android Telegram and one on iOS: tap the browser button,
confirm the order remains the same, test the QR download/payment-app button,
and return to the existing order page for verified ID delivery.

Never send customers a new order just to retry an already-paid payment. Payment
links are private and should not be shared publicly or sent to support screenshots.
