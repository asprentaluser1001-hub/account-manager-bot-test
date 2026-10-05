import {TestOrder} from './testOrders';
import {sendAdminBookingRecorded} from './telegramBot';
import {sendBookingRecordedPush} from '../routes/push';

export type BookingAlert = {title:string;body:string;tag:string;url:string};

export function bookingAlert(order:TestOrder,extension=false):BookingAlert {
 const amount=extension?50:order.amount;
 const status=order.status==='delivery_failed'?'Delivery failed: share access privately.':order.source==='manual'&&order.chat_id==='manual'&&!extension?'Share access privately from Accounts.':'';
 return {
  title:order.status==='payment_late'?'Late payment — support needed':order.status==='reserved'?'Advance booking confirmed':extension?'Booking extended':'Booking confirmed',
  body:`${order.username} · ₹${amount} · ${order.id}${status?' · '+status:''}`,
  tag:`${extension?'extension':'confirmed'}-${order.id}${extension?'-'+order.expires_at:''}`,
  url:'/?tab=history',
 };
}

// The booking is already committed; notification failures must not undo payment or reservation.
export async function notifyBookingRecorded(order:TestOrder,extension=false):Promise<void> {
 const alert=bookingAlert(order,extension);
 const results=await Promise.allSettled([sendAdminBookingRecorded(alert),sendBookingRecordedPush(alert)]);
 for(const result of results)if(result.status==='rejected')console.error('[Booking alert] Delivery failed',result.reason);
}

