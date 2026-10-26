import {db} from '../db';
import {isImbConfigured} from './imbPayment';
import {cashfreeEnvironment,isCashfreeConfigured} from './cashfreePayment';
export type PaymentProvider='imb'|'cashfree';
db.exec('CREATE TABLE IF NOT EXISTS payment_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
export function activePaymentProvider():PaymentProvider{
 const saved=db.prepare("SELECT value FROM payment_settings WHERE key='gateway_provider'").get() as {value:string}|undefined;
 return saved?.value==='cashfree'?'cashfree':'imb';
}
export function paymentGatewayConfig(){
 const paymentProvider=activePaymentProvider();
 return {paymentProvider,gatewayEnabled:paymentProvider==='cashfree'?isCashfreeConfigured():isImbConfigured(),imbConfigured:isImbConfigured(),cashfreeConfigured:isCashfreeConfigured(),cashfreeEnvironment:cashfreeEnvironment()};
}
export function selectPaymentProvider(provider:unknown){
 if(provider!=='imb'&&provider!=='cashfree')throw new Error('Choose IMB or Cashfree');
 if(process.env.V3_PREVIEW==='true'||process.env.PAYMENT_MODE==='mock')throw new Error('Live gateways cannot be selected in mock mode');
 if(!(provider==='cashfree'?isCashfreeConfigured():isImbConfigured()))throw new Error(`${provider==='cashfree'?'Cashfree':'IMB'} server credentials are not configured`);
 db.prepare("INSERT INTO payment_settings(key,value) VALUES ('gateway_provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(provider);
}
