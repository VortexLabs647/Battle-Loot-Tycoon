'use strict';
const http=require('http'),WebSocket=require('ws'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=Number(process.env.PORT)||10000;
const players=new Map(),sockets=new Map(),friends=new Map(),requests=new Set(),invites=new Set(),offers=new Map();const rooms=new Map(),drops=new Map(),pendingDrops=new Map(),pendingPickups=new Map();
const DATA_FILE=path.join(process.env.DATA_DIR||__dirname,'blt-friends.json');
let savedAccounts={};
try{savedAccounts=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))||{}}catch(e){if(e.code!=='ENOENT')console.warn('[friends] read failed',e.message)}
function saveAccounts(){try{fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(savedAccounts));fs.renameSync(tmp,DATA_FILE)}catch(e){console.error('[friends] save failed',e.message)}}
function accountOf(id){return players.get(id)?.accountId}
function onlineId(accountId){for(const [id,p] of players)if(p.accountId===accountId)return id;return null}
function friendSnapshot(id){const aid=accountOf(id);const account=savedAccounts[aid];return (account?.friends||[]).map(fid=>({accountId:fid,id:onlineId(fid),username:savedAccounts[fid]?.username||'Player',level:savedAccounts[fid]?.level||1,online:!!onlineId(fid)}))}
function updateFriends(){for(const id of players.keys())if(accountOf(id))send(id,{type:'friends_snapshot',friends:friendSnapshot(id)})}
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');if(req.url==='/'||req.url==='/health'){res.writeHead(200);return res.end(JSON.stringify({status:'online',game:'Battle Loot Tycoon',players:players.size,features:['friends','base_visits','gun_gifts','ground_drops']}))}res.writeHead(404);res.end(JSON.stringify({error:'Not found'}))});
const wss=new WebSocket.Server({server,maxPayload:65536});
function send(id,data){const ws=sockets.get(id);if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
function broadcast(data,except){for(const id of sockets.keys())if(id!==except)send(id,data)}
function err(id,msg){console.warn('[server_error]',id,msg);send(id,{type:'error',message:msg})}
function key(a,b){return [a,b].sort().join(':')}
function connected(id){return typeof id==='string'&&players.has(id)}
function isFriend(a,b){return friends.get(a)?.has(b)}
function usernameAllowed(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_]{3,18}$/.test(value))return false;
  const lower=value.toLowerCase();
  const normalized=lower.replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t').replace(/8/g,'b').replace(/9/g,'g');
  const parts=normalized.split(/_+/).filter(Boolean);
  const words=new Set(['fuck','fucker','fucking','shit','shitty','bitch','bitches','cunt','dick','cock','pussy','asshole','motherfucker','porn','porno','sex','sexy','nude','nudes','naked','rape','rapist','nazi','hitler','kkk','retard','retarded','slut','whore','fag','faggot','nigger','nigga','kike','spic','chink']);
  const severe=['nigger','nigga','faggot','motherfucker','asshole','rapist','porn','nazi','hitler'];
  const condensed=normalized.replace(/_/g,'').replace(/(.)\1{2,}/g,'$1$1');
  if(parts.some(p=>words.has(p)))return false;
  if(words.has(normalized)||words.has(condensed))return false;
  if(severe.some(w=>condensed.includes(w)))return false;
  return true;
}
function safeGun(g){return g&&typeof g.id==='string'&&['scrap','cobalt','thorn','specter','halloween','nova','voidstar'].includes(g.id)&&Array.isArray(g.perks)&&g.perks.length<=2&&g.perks.every(p=>['redstone','dark','plasma','fire'].includes(p))}
function validPieces(p){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length>576)return false;return Object.entries(p).every(([k,v])=>/^([1-9]|1[0-9]|2[0-2]),([1-9]|1[0-9]|2[0-2])$/.test(k)&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length<=12)}
wss.on('connection',ws=>{
 const id=crypto.randomUUID(),player={id,username:'Player',level:1,x:0,y:0,z:0};players.set(id,player);sockets.set(id,ws);friends.set(id,new Set());
 send(id,{type:'welcome',id,players:[...players.values()],friends:[]});broadcast({type:'player_joined',player},id);
 let lastMove=0;
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}if(!m||typeof m!=='object')return;
 const to=m.to,from=m.from;if(['drop_request','drop_commit','pickup_request','base_enter','base_leave'].includes(m.type))console.log('[message]',id,m.type);
 switch(m.type){
 case 'account_hello':{
 const aid=String(m.accountId||'');
 if(!/^[a-f0-9]{32,64}$/.test(aid))return err(id,'Invalid account identity');
 if(player.accountId&&player.accountId!==aid)return err(id,'Account already initialized');
 player.accountId=aid;
 const acc=savedAccounts[aid]||(savedAccounts[aid]={username:'Player',friends:[]});
 if(!Array.isArray(acc.friends))acc.friends=[];
 if(usernameAllowed(m.username))acc.username=m.username;
 player.username=acc.username;player.level=Math.max(1,Math.min(9999,Math.floor(Number(m.level)||acc.level||1)));acc.level=player.level;
 for(const fid of acc.friends){const peer=onlineId(fid);if(peer){friends.get(id).add(peer);friends.get(peer)?.add(id)}}
 saveAccounts();send(id,{type:'player_updated',player});broadcast({type:'player_updated',player},id);updateFriends();break}
 case 'set_level':{const lv=Math.floor(Number(m.level));if(!Number.isFinite(lv)||lv<1||lv>9999)return;player.level=lv;if(player.accountId&&savedAccounts[player.accountId]){savedAccounts[player.accountId].level=lv;saveAccounts();updateFriends()}broadcast({type:'player_updated',player});break}
 case 'set_username':{const username=String(m.username||'').trim();if(!usernameAllowed(username))return err(id,'Username not allowed. Choose a different name (3–18 letters, numbers, or underscores).');player.username=username;if(player.accountId){savedAccounts[player.accountId].username=username;saveAccounts();updateFriends()}broadcast({type:'player_updated',player});break}
 case 'move':{if(Date.now()-lastMove<50)return;lastMove=Date.now();if(!['x','y','z'].every(k=>Number.isFinite(m[k])&&Math.abs(m[k])<100000))return;Object.assign(player,{x:m.x,y:m.y,z:m.z});broadcast({type:'player_moved',id,x:player.x,y:player.y,z:player.z},id);break}
 case 'friend_request':{if(!connected(to)||to===id)return err(id,'Player is offline');if(isFriend(id,to))return;requests.add(id+':'+to);send(to,{type:'friend_request',from:id,player});break}
 case 'friend_accept':{if(!connected(from)||!requests.has(from+':'+id))return err(id,'Friend request expired');requests.delete(from+':'+id);friends.get(id).add(from);friends.get(from).add(id);const a=accountOf(id),b=accountOf(from);if(a&&b&&a!==b){for(const [x,y] of [[a,b],[b,a]]){const f=savedAccounts[x].friends;if(!f.includes(y))f.push(y)}saveAccounts()}updateFriends();send(id,{type:'friend_added',id:from});send(from,{type:'friend_added',id});break}
 case 'base_invite':{if(!connected(to)||!isFriend(id,to))return err(id,'Invite a connected friend');invites.add(id+':'+to);send(to,{type:'base_invite',from:id,player});break}
 case 'base_visit':{if(!connected(to)||!invites.has(to+':'+id)||!isFriend(id,to))return err(id,'Base invitation expired');invites.delete(to+':'+id);send(to,{type:'base_snapshot_request',from:id});break}
 case 'base_snapshot':{if(!connected(to)||!isFriend(id,to)||!validPieces(m.pieces))return err(id,'Invalid base data');send(to,{type:'base_snapshot',username:player.username,pieces:m.pieces,hostId:id});break}
 case 'base_enter':{const host=m.host;console.log('[base_enter]',id,'host',host);if(!connected(host)||!(host===id||isFriend(id,host)))return err(id,'Base is unavailable');rooms.set(id,host);send(id,{type:'base_entered',host});player.baseX=undefined;player.baseY=undefined;const items=[...drops.values()].filter(d=>d.room===host).map(({id,gun,x,y})=>({id,gun,x,y}));send(id,{type:'base_drops',drops:items});send(id,{type:'base_players',players:[...rooms].filter(([pid,r])=>r===host&&pid!==id).map(([pid])=>({id:pid,username:players.get(pid)?.username||'Player',level:players.get(pid)?.level||1,x:players.get(pid)?.baseX,y:players.get(pid)?.baseY,a:players.get(pid)?.baseA})).filter(p=>Number.isFinite(p.x))});for(const [pid,r] of rooms)if(pid!==id&&r===host)send(pid,{type:'base_player_joined',player:{id,username:player.username}});break}
 case 'base_leave':{const old=rooms.get(id);rooms.delete(id);if(old)for(const [pid,r] of rooms)if(r===old)send(pid,{type:'base_player_left',id});break}
 case 'base_position':{if(!rooms.has(id)||!Number.isFinite(m.x)||!Number.isFinite(m.y)||m.x<0||m.y<0||m.x>24||m.y>24)return;player.baseX=m.x;player.baseY=m.y;if(Number.isFinite(m.a))player.baseA=m.a;for(const [pid,r] of rooms)if(pid!==id&&r===rooms.get(id))send(pid,{type:'base_player_position',id,username:player.username,level:player.level||1,x:m.x,y:m.y,a:player.baseA||0});break}
 case 'drop_request':{console.log('[drop_request]',id,'ticket',m.ticket,'gun',m.gun?.id,'room',rooms.get(id),'coords',m.x,m.y);if(!rooms.has(id)||typeof m.ticket!=='string'||m.ticket.length>100||!safeGun(m.gun)||typeof m.uid!=='string'||m.uid.length>100||!Number.isFinite(m.x)||!Number.isFinite(m.y)||m.x<0||m.x>24||m.y<0||m.y>24)return err(id,'Invalid drop');if(Math.hypot(m.x-(player.baseX??m.x),m.y-(player.baseY??m.y))>2)return err(id,'Move closer before dropping');if(pendingDrops.has(m.ticket))return;pendingDrops.set(m.ticket,{owner:id,room:rooms.get(id),x:m.x,y:m.y,gun:m.gun,time:Date.now()});send(id,{type:'drop_claim',ticket:m.ticket});console.log('[drop_claim]',id,m.ticket);break}
 case 'drop_cancel':{if(pendingDrops.get(m.ticket)?.owner===id)pendingDrops.delete(m.ticket);break}
 case 'drop_commit':{console.log('[drop_commit]',id,m.ticket,m.gun?.id);const p=pendingDrops.get(m.ticket);if(!p||p.owner!==id||!safeGun(m.gun)||JSON.stringify(m.gun.perks)!==JSON.stringify(p.gun.perks)||m.gun.id!==p.gun.id)return err(id,'Drop not authorized');pendingDrops.delete(m.ticket);const drop={id:crypto.randomUUID(),room:p.room,x:p.x,y:p.y,gun:{id:m.gun.id,perks:m.gun.perks,bonusSlot:!!m.gun.bonusSlot}};drops.set(drop.id,drop);console.log('[drop_added]',drop.id,'room',drop.room);for(const [pid,r] of rooms)if(r===drop.room)send(pid,{type:'drop_added',drop});break}
 case 'pickup_request':{console.log('[pickup_request]',id,m.id);const drop=drops.get(m.id);if(!drop||rooms.get(id)!==drop.room||!Number.isFinite(player.baseX)||Math.hypot(player.baseX-drop.x,player.baseY-drop.y)>.9)return;drops.delete(drop.id);const ticket=crypto.randomUUID();pendingPickups.set(ticket,{drop,to:id,time:Date.now()});send(id,{type:'drop_pickup',ticket,gun:drop.gun});console.log('[drop_pickup]',id,drop.id);for(const [pid,r] of rooms)if(r===drop.room)send(pid,{type:'drop_removed',id:drop.id});break}
 case 'pickup_receipt':{const p=pendingPickups.get(m.ticket);if(!p||p.to!==id){send(id,{type:'pickup_confirmed',ticket:m.ticket});return}pendingPickups.delete(m.ticket);send(id,{type:'pickup_confirmed',ticket:m.ticket});console.log('[pickup_receipt]',id,m.ticket,m.ok);if(!m.ok){drops.set(p.drop.id,p.drop);for(const [pid,r] of rooms)if(r===p.drop.room)send(pid,{type:'drop_added',drop:p.drop})}break}
 case 'gift_offer':{if(!connected(to)||!isFriend(id,to)||!safeGun(m.gun)||typeof m.uid!=='string'||m.uid.length>100)return err(id,'Invalid gift or friend offline');const offerId=crypto.randomUUID();offers.set(offerId,{from:id,to,uid:m.uid,gun:m.gun,stage:'offered',time:Date.now()});send(to,{type:'gift_offer',offerId,from:id,username:player.username,gun:m.gun});send(id,{type:'gift_offered',offerId});break}
 case 'gift_decline':{const o=offers.get(m.offerId);if(!o||o.to!==id)return;offers.delete(m.offerId);send(o.from,{type:'gift_rejected'});break}
 case 'gift_accept':{const o=offers.get(m.offerId);if(!o||o.to!==id||o.stage!=='offered')return err(id,'Gift unavailable');o.stage='claiming';send(o.from,{type:'gift_claim',offerId:m.offerId,uid:o.uid});break}
 case 'gift_cancel':{const o=offers.get(m.offerId);if(!o||o.from!==id)return;offers.delete(m.offerId);send(o.to,{type:'gift_rejected'});break}
 case 'gift_commit':{const o=offers.get(m.offerId);if(!o||o.from!==id||o.stage!=='claiming'||!safeGun(m.gun)||m.gun.id!==o.gun.id)return err(id,'Gift not authorized');o.stage='delivering';o.gun={id:m.gun.id,perks:m.gun.perks,bonusSlot:!!m.gun.bonusSlot};send(o.to,{type:'gift_received',offerId:m.offerId,gun:o.gun});break}
 case 'gift_receipt':{const o=offers.get(m.offerId);if(!o||o.to!==id||o.stage!=='delivering')return;offers.delete(m.offerId);if(m.ok)send(o.from,{type:'gift_delivered'});else send(o.from,{type:'gift_refund',gun:o.gun});break}
 }
 });
 ws.on('close',()=>{const oldRoom=rooms.get(id);rooms.delete(id);if(oldRoom)for(const [pid,r] of rooms)if(r===oldRoom)send(pid,{type:'base_player_left',id});for(const [ticket,p] of pendingDrops)if(p.owner===id)pendingDrops.delete(ticket);for(const [ticket,p] of pendingPickups)if(p.to===id){pendingPickups.delete(ticket);console.warn('[pickup] unconfirmed delivery expired; not respawning to prevent duplication',ticket)}players.delete(id);sockets.delete(id);for(const [pid,host] of rooms)if(host===id){rooms.delete(pid);send(pid,{type:'base_drops',drops:[]});send(pid,{type:'base_players',players:[]})}friends.delete(id);for(const f of friends.values())f.delete(id);updateFriends();for(const k of [...requests])if(k.startsWith(id+':')||k.endsWith(':'+id))requests.delete(k);for(const k of [...invites])if(k.startsWith(id+':')||k.endsWith(':'+id))invites.delete(k);for(const [offerId,o] of offers){if(o.from===id||o.to===id){offers.delete(offerId);if(o.stage==='delivering'&&o.from!==id)send(o.from,{type:'gift_refund',gun:o.gun});}}broadcast({type:'player_left',id})});ws.on('error',e=>console.error('WebSocket error:',e.message));
});
setInterval(()=>{const now=Date.now();for(const [ticket,p] of pendingDrops)if(now-p.time>15000)pendingDrops.delete(ticket);for(const [ticket,p] of pendingPickups)if(now-p.time>15000){pendingPickups.delete(ticket);console.warn('[pickup] unconfirmed delivery expired; not respawning to prevent duplication',ticket)}},5000);
server.listen(PORT,'0.0.0.0',()=>console.log('Battle Loot multiplayer listening on '+PORT));
