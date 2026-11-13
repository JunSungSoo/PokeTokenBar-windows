import{createServer,createConnection,isIPv4,type Socket,type Server}from'node:net';
import{networkInterfaces}from'node:os';
export const frameLimit=1024*1024;
export function privateIPv4(address:string){if(!isIPv4(address))return false;const[a,b]=address.split('.').map(Number);return a===10||a===127||(a===192&&b===168)||(a===172&&b>=16&&b<=31)||(a===169&&b===254);}
export function connectionAddress(code:string){const[address,port,extra]=code.trim().split(':');if(extra!==undefined||!privateIPv4(address)||!/^\d{1,5}$/.test(port??'')||+port<1||+port>65535)throw Error('같은 LAN의 IPv4:포트 연결 코드를 입력해 주세요.');return{address,port:+port};}
export class BattleTransport{
 private server?:Server;private socket?:Socket;private buffer=Buffer.alloc(0);
 constructor(private receive:(value:unknown)=>void,private connected:()=>void,private disconnected:()=>void){}
 async listen(){
  const server=createServer(socket=>{if(this.server!==server||this.socket||!privateIPv4(socket.remoteAddress ?? '')){socket.destroy();return;}server.close();this.server=undefined;this.wire(socket,true);});this.server=server;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
  server.on('error',()=>this.fail());const address=server.address();if(!address||typeof address==='string')throw Error('LAN 연결을 열지 못했습니다.');
  const addresses=Object.values(networkInterfaces()).flat().filter(item=>item?.family==='IPv4'&&!item.internal&&privateIPv4(item.address)).map(item=>item!.address);
  return [...new Set(addresses.length?addresses:['127.0.0.1'])].map(ip=>ip+':'+address.port);
 }
 connect(code:string){const{address,port}=connectionAddress(code);this.socket?.destroy();this.wire(createConnection({host:address,port,family:4}),false);}
 private wire(socket:Socket,ready:boolean){
  this.socket=socket;this.buffer=Buffer.alloc(0);socket.setNoDelay(true);socket.setTimeout(10000);
  const opened=()=>{if(this.socket===socket){socket.setTimeout(0);this.connected();}};
  socket.on('error',()=>{if(this.socket===socket)this.fail();});socket.on('timeout',()=>{if(this.socket===socket)this.fail();});
  socket.on('close',()=>{if(this.socket===socket){this.socket=undefined;this.disconnected();}});
  socket.on('data',bytes=>{if(this.socket!==socket)return;try{this.buffer=Buffer.concat([this.buffer,bytes]);while(this.buffer.length>=4){const length=this.buffer.readUInt32BE();if(!length||length>frameLimit)throw Error('Invalid battle frame');if(this.buffer.length<length+4)break;const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(this.buffer.subarray(4,length+4)));this.buffer=this.buffer.subarray(length+4);this.receive(value);}}catch{this.fail();}});
  if(ready)opened();else socket.once('connect',opened);
 }
 send(value:unknown){if(!this.socket?.writable||this.socket.destroyed)throw Error('연결된 상대가 없습니다.');const data=Buffer.from(JSON.stringify(value));if(data.length>frameLimit)throw Error('배틀 메시지가 너무 큽니다.');const header=Buffer.alloc(4);header.writeUInt32BE(data.length);this.socket.write(Buffer.concat([header,data]));}
 private fail(){this.close();this.disconnected();}
 close(){const socket=this.socket;this.socket=undefined;socket?.destroy();const server=this.server;this.server=undefined;if(server?.listening)server.close();this.buffer=Buffer.alloc(0);}
}
