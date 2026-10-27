// Telegram's openLink must run directly from a customer tap, not after fetch().
export function isTelegramCheckout(): boolean {
  const app = window.Telegram?.WebApp;
  return Boolean(app?.initData || (app?.platform && app.platform !== 'unknown') || /Telegram/i.test(navigator.userAgent));
}
export function openPaymentInBrowser(paymentUrl: string): void {
  const url = new URL(paymentUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid payment link. Contact support with your order ID.');
  if (isTelegramCheckout()) {
    const app = window.Telegram?.WebApp;
    if (!app?.openLink) throw new Error('Copy the payment link below and paste it into Safari or Chrome.');
    app.openLink(url.toString(), {try_instant_view: false});
  } else {
    window.location.assign(url.toString());
  }
}
