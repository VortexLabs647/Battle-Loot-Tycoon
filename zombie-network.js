'use strict';
const Simulation=require('./zombie-simulation'),worlds=require('./zombie-worlds.json'),catalog=require('./weapon-catalog.json');
module.exports=function({send,group,weapon,now=Date.now}){const members=new Map(),rooms=new Map();let last=now();
 function packet(p,data){send(p.id,{...data,world:p.world,session:p.session,protocol:2})}
 function room(p){let r=rooms.get(p.key);if(!r){r={world:p.world,simulation:Simulation.create(worlds[p.world],{world:p.world}),last:0};rooms.set(p.key,r)}return r}
 function peers(p){return [...members.values()].filter(q=>q.key===p.key&&q.active&&now()-q.poseAt<2000)}
 function sync(p){const g=group(p.id);if(!g||g.world!==p.world){members.delete(p.id);return false}p.key=g.key;return true}
 function message(id,m){if(!String(m.type||'').startsWith('zombie_'))return false;const g=group(id),old=members.get(id);
  if(m.type==='zombie_enter'){if(!g||!worlds[g.world]||m.world!==g.world||!Number.isSafeInteger(m.session)||m.session<1)return true;const p=old&&old.session===m.session&&old.world===g.world?old:{id,world:g.world,key:g.key,session:m.session,x:0,z:0,angle:0,slope:0,active:false,poseAt:0,lastShot:-1e9};p.key=g.key;members.set(id,p);packet(p,{type:'zombie_state',zombies:room(p).simulation.snapshot(),strikes:room(p).simulation.strikeSnapshot(),corpses:room(p).simulation.corpseSnapshot()});return true}
  if(!old||m.session!==old.session||m.world!==old.world)return true;const p=old;if(m.type==='zombie_leave'){members.delete(id);return true}if(!sync(p))return true;
  if(m.type==='zombie_pause'){p.active=false;return true}
  if(m.type==='zombie_pose'){if(![m.x,m.z,m.angle,m.slope].every(Number.isFinite)||Math.abs(m.x)>63.8||Math.abs(m.z)>63.8||Math.abs(m.slope)>4)return true;if(now()-p.poseAt<70)return true;const nav=room(p).simulation.nav;if(!nav.free(m.x,m.z)){p.active=false;return true}Object.assign(p,{x:m.x,z:m.z,angle:m.angle,slope:m.slope,active:m.active===true,poseAt:now()});return true}
  if(m.type==='zombie_shoot'){if(!p.active||now()-p.poseAt>650||now()-p.lastShot<165||![m.angle,m.slope].every(Number.isFinite)||Math.abs(m.slope)>4)return true;const gun=catalog.find(w=>w.id===weapon(id)?.id);if(!gun)return true;p.lastShot=now();const hit=room(p).simulation.shoot({...p,angle:m.angle,slope:m.slope},{...gun,...weapon(id)});if(hit){packet(p,{type:'zombie_hit',...hit});for(const q of peers(p))packet(q,{type:'zombie_state',zombies:room(p).simulation.snapshot(),strikes:room(p).simulation.strikeSnapshot(),corpses:room(p).simulation.corpseSnapshot()})}return true}
  return true;
 }
 function tick(){const time=now(),dt=Math.min(.12,Math.max(0,(time-last)/1000));last=time;for(const p of members.values())sync(p);for(const [key,r]of rooms){const all=[...members.values()].filter(p=>p.key===key);if(!all.length){rooms.delete(key);continue}const active=all.filter(p=>p.active&&time-p.poseAt<2000);const caught=r.simulation.update(dt,active);for(const id of caught){const p=members.get(id);if(p){p.active=false;packet(p,{type:'zombie_caught'})}}if(time-r.last>=95){r.last=time;const snapshot=r.simulation.snapshot();for(const p of all)packet(p,{type:'zombie_state',zombies:snapshot,strikes:r.simulation.strikeSnapshot(),corpses:r.simulation.corpseSnapshot()})}}
 }
 return {message,tick,leave:id=>members.delete(id)};
};
