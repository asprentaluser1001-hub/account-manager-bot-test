self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text()||''}}
  const title=data.title||'FlingRoulette';
  const options={body:data.body||'A payment approval is waiting.',icon:'/icon.svg',badge:'/icon.svg',tag:data.tag||'approval',data:{url:data.url||'/?tab=approvals'}};
  event.waitUntil(Promise.all([
    self.registration.showNotification(title,options),
    self.registration.setAppBadge?self.registration.setAppBadge():Promise.resolve()
  ]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/?tab=approvals',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const existing=list.find(client=>client.url.startsWith(self.location.origin));
    if(existing){existing.navigate(target);return existing.focus()}
    return clients.openWindow(target);
  }).then(()=>self.registration.clearAppBadge?self.registration.clearAppBadge():undefined));
});
