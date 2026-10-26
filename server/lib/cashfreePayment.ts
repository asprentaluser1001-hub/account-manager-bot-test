import {createHmac, timingSafeEqual} from 'crypto';
export type CashfreeEnvironment = 'sandbox' | 'production';
export function cashfreeEnvironment(): CashfreeEnvironment {
 const value=process.env.CASHFREE_ENV||'sandbox';
 if(value!=='sandbox'&&value!=='production')throw new Error('CASHFREE_ENV must be sandbox or production');
 return value;
}
export function isCashfreeConfigured(){return process.env.V3_PREVIEW!=='true'&&process.env.PAYMENT_MODE!=='mock'&&Boolean(process.env.CASHFREE_APP_ID?.trim()&&process.env.CASHFREE_SECRET_KEY?.trim());}
async function request<T>(resource:string,environment:CashfreeEnvironment,body?:unknown):Promise<T>{
 if(!isCashfreeConfigured()||environment!==cashfreeEnvironment())throw new Error('Cashfree credentials are unavailable for this order environment');
 const root=environment==='production'?'https://api.cashfree.com/pg':'https://sandbox.cashfree.com/pg';
 const response=await fetch(root+resource,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-client-id':process.env.CASHFREE_APP_ID!.trim(),'x-client-secret':process.env.CASHFREE_SECRET_KEY!.trim(),'x-api-version':'2025-01-01'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 const payload=await response.json().catch(()=>null);
 if(response.status===409&&resource==='/orders'&&body){return request<T>(`/orders/${encodeURIComponent((body as {order_id:string}).order_id)}`,environment);}
 if(!response.ok||!payload)throw new Error(`Cashfree request failed (${response.status}). Check server payment configuration and Cashfree API logs.`);
 return payload as T;
}
export async function createCashfreeOrder(input:{orderId:string;amount:number;name:string;phone:string;returnUrl:string}){
 if(!/^[6-9]\d{9}$/.test(input.phone))throw new Error('Enter a valid 10-digit Indian mobile number');
 const environment=cashfreeEnvironment();
 const result=await request<{order_id:string;payment_session_id:string}>('/orders',environment,{order_id:input.orderId,order_amount:input.amount,order_currency:'INR',customer_details:{customer_id:input.orderId,customer_name:input.name,customer_phone:input.phone},order_meta:{return_url:input.returnUrl},order_note:'FlingRoulette booking'});
 if(result.order_id!==input.orderId||!result.payment_session_id)throw new Error('Cashfree did not return a valid payment session');
 return {paymentSessionId:result.payment_session_id,cashfreeEnvironment:environment};
}
export async function verifyCashfreeOrder(orderId:string,amount:number,environment:CashfreeEnvironment):Promise<string|null>{
 const order=await request<{order_id:string;order_status:string;order_amount:number;order_currency:string}>(`/orders/${encodeURIComponent(orderId)}`,environment);
 if(order.order_id!==orderId||Number(order.order_amount)!==amount||order.order_currency!=='INR')throw new Error('Cashfree order does not match the stored order');
 if(order.order_status!=='PAID')return null;
 const payments=await request<Array<{cf_payment_id:string|number;payment_status:string;payment_amount:number;payment_currency:string}>>(`/orders/${encodeURIComponent(orderId)}/payments`,environment);
 const payment=payments.find(p=>p.payment_status==='SUCCESS'&&Number(p.payment_amount)===amount&&p.payment_currency==='INR');
 return payment?.cf_payment_id?String(payment.cf_payment_id):null;
}
export function verifyCashfreeSignature(rawBody:Buffer,timestamp:string,signature:string):boolean{
 const secret=process.env.CASHFREE_SECRET_KEY?.trim();
 if(!secret||!timestamp||!signature||!/^\d+$/.test(timestamp))return false;
 const expected=createHmac('sha256',secret).update(timestamp).update(rawBody).digest('base64');
 const actual=Buffer.from(signature),wanted=Buffer.from(expected);
 return actual.length===wanted.length&&timingSafeEqual(actual,wanted);
}
