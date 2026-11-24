import{createSocket,type Socket}from'node:dgram';
import{privateIPv4}from'./transport.js';
export interface BattlePeer{code:string;nickname:string;address:string}
const group='239.255.84.66',port=47831;
/** Windows LAN discovery; the TCP connection code remains available when multicast is filtered. */
export class BattleDiscovery{
 private socket?:Socket;private timer?:ReturnType<typeof setInterval>;private peers=new Map<string,BattlePeer&{seen:number}>();
 constructor(private changed:(peers:BattlePeer[])=>void){}
 start({code,nickname}:{code:string;nickname:string},tcpPort:number){this.stop();const socket=createSocket({type:'udp4',reuseAddr:true});this.socket=socket;
  const broadcast=()=>{if(this.socket!==socket)return;const bytes=Buffer.from(JSON.stringify({service:'ptb-battle-windows',version:1,mode:'singles',code,nickname,port:tcpPort}));socket.send(bytes,port,group,()=>{});let expired=false;for(const[key,p]of this.peers)if(Date.now()-p.seen>7000){this.peers.delete(key);expired=true;}if(expired)this.publish();};
  socket.on('error',()=>{if(this.socket===socket)this.stop();});
  socket.on('message',(data,remote)=>{if(data.length>1024||!privateIPv4(remote.address))return;try{const p=JSON.parse(data.toString('utf8'));if(p.service!=='ptb-battle-windows'||p.version!==1||p.mode!=='singles'||p.code===code||typeof p.code!=='string'||!/^[A-HJ-NP-Z2-9]{8}$/.test(p.code)||typeof p.nickname!=='string'||p.nickname.length>40||!Number.isInteger(p.port)||p.port<1||p.port>65535)return;const previous=this.peers.get(p.code),address=remote.address+':'+p.port;this.peers.set(p.code,{code:p.code,nickname:p.nickname,address,seen:Date.now()});if(!previous||previous.nickname!==p.nickname||previous.address!==address)this.publish();}catch{}});
  socket.bind(port,()=>{if(this.socket!==socket)return;try{socket.addMembership(group);socket.setMulticastTTL(1);broadcast();this.timer=setInterval(broadcast,2000);}catch{this.stop();}});
 }
 private publish(){this.changed([...this.peers.values()].map(({seen,...peer})=>peer));}
 stop(){clearInterval(this.timer);this.timer=undefined;const socket=this.socket;this.socket=undefined;try{socket?.close();}catch{}this.peers.clear();}
}
