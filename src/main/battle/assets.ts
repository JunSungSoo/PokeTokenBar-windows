import {createServer,type Server} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';

/** Read-only, token-scoped assets. No LAN listener, arbitrary files, or renderer RPC. */
export class BattleAssets {
  private server?:Server;private pending?:Promise<string>;
  start():Promise<string>{
    if(this.pending)return this.pending;
    this.pending=new Promise<string>((done,reject)=>{
      const root=fileURLToPath(new URL('../../battle-assets/',import.meta.url)),token=randomBytes(24).toString('hex');
      const types:Record<string,string>={'.css':'text/css','.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.gif':'image/gif','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.svg':'image/svg+xml'};
      const server=createServer(async(req,res)=>{
        try{
          if(req.method!=='GET'){res.writeHead(405).end();return;}
          const url=new URL(req.url ?? '/','http://127.0.0.1');
          const path=decodeURIComponent(url.pathname);if(!path.startsWith('/'+token+'/')){res.writeHead(404).end();return;}
          const file=resolve(root,path.slice(token.length+2));if(!file.startsWith(resolve(root)+sep)){res.writeHead(404).end();return;}
          const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)] ?? 'application/octet-stream','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=3600','Cross-Origin-Resource-Policy':'cross-origin'});res.end(bytes);
        }catch{res.writeHead(404).end();}
      });
      this.server=server;server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address || typeof address==='string'){reject(new Error('Battle assets unavailable'));return;}done(`http://127.0.0.1:${address.port}/${token}/`);});
    }).catch(error=>{this.pending=undefined;throw error;});return this.pending;
  }
  close(){this.server?.close();this.server?.closeAllConnections();this.server=undefined;this.pending=undefined;}
}
