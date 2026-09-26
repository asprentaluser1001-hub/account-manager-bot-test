const API_ROOT='https://api.imbpay.in/v2';

function apiToken(){
 const token=process.env.IMB_API_TOKEN?.trim();
 if(!token)throw new Error('IMB API token is not configured on the server');
 return token;
}

async function postForm<T>(path:string, values:Record<string,string>):Promise<T>{
 const body=new URLSearchParams({...values,user_token:apiToken()});
 const response=await fetch(`${API_ROOT}/${path}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 const payload=await response.json().catch(()=>null) as T|null;
 if(!response.ok||!payload)throw new Error(`IMB request failed (${response.status})`);
 return payload;
}

export type ImbCreateResult={status:boolean;message?:string;result?:{orderId?:string;payment_url?:string;phonepe_link?:string;paytm_link?:string;bhim_link?:string;check_link?:string}};
export type ImbStatusResult={status?:string|boolean;message?:string;result?:{txnStatus?:string;status?:string;orderId?:string;amount?:number|string;utr?:string}};

export async function createImbOrder(input:{orderId:string;amount:number;mobile:string;redirectUrl:string}){
 const result=await postForm<ImbCreateResult>('create-order',{
  customer_mobile:input.mobile.replace(/\D/g,'').slice(-10)||'9999999999',
  amount:String(input.amount),order_id:input.orderId,redirect_url:input.redirectUrl,
  remark1:'FlingRoulette booking',remark2:input.orderId,
 });
 if(result.status!==true||!result.result?.payment_url)throw new Error(result.message||'IMB could not create the payment order');
 return result.result;
}

export async function checkImbOrder(orderId:string){
 return postForm<ImbStatusResult>('check-order-status',{order_id:orderId});
}

export function isImbConfigured(){return process.env.V3_PREVIEW!=='true' && process.env.PAYMENT_MODE!=='mock' && Boolean(process.env.IMB_API_TOKEN?.trim());}
