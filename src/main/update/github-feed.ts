import {windowsReleaseBase} from '../../shared/github-release.js';
import {parseUpdateManifest,verifyManifest,type SignedRelease} from './manifest.js';
import {updatePublicKeys} from './public-keys.js';

const manifestMaxBytes=65536;
const signatureMaxBytes=1024;
const requestTimeoutMilliseconds=20000;
const defaultMinInterval=30*60*1000;

export class GitHubUpdateFeed {
 private cached?:{at:number;release:SignedRelease|null};
 private pending?:Promise<SignedRelease|null>;
 constructor(private request:typeof fetch=fetch,private clock=Date.now,private base=windowsReleaseBase,private keys:readonly string[]=updatePublicKeys){}
 check(minInterval=defaultMinInterval):Promise<SignedRelease|null>{
  if(this.pending)return this.pending;
  if(this.cached&&this.clock()-this.cached.at<minInterval)return Promise.resolve(this.cached.release);
  const promise=this.fetchRelease().then(release=>{this.cached={at:this.clock(),release};return release;}).finally(()=>{if(this.pending===promise)this.pending=undefined;});this.pending=promise;return promise;
 }
 private async fetchRelease():Promise<SignedRelease|null>{
  const manifestBytes=await this.download('latest.yml',manifestMaxBytes);if(!manifestBytes)return null;
  const signatureBytes=await this.download('latest.yml.sig',signatureMaxBytes);if(!signatureBytes)return null;
  if(!verifyManifest(manifestBytes,signatureBytes.toString('utf8').trim(),this.keys))throw new Error('업데이트 서명을 확인할 수 없습니다.');
  const release=parseUpdateManifest(manifestBytes.toString('utf8'));if(!release)throw new Error('업데이트 정보를 확인할 수 없습니다.');return release;
 }
 // Returns undefined on 404 (release or signature not published yet).
 private async download(fileName:string,maxBytes:number):Promise<Buffer|undefined>{
  const response=await this.request(this.base+fileName,{cache:'no-store',credentials:'omit',redirect:'follow',signal:AbortSignal.timeout(requestTimeoutMilliseconds)});
  if(response.status===404){await response.body?.cancel();return;}
  if(response.status!==200||Number(response.headers.get('content-length')??0)>maxBytes){await response.body?.cancel();throw new Error('업데이트 정보를 가져올 수 없습니다.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('업데이트 응답이 비어 있습니다.');const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>maxBytes){await reader.cancel();throw new Error('업데이트 응답이 너무 큽니다.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
 }
}
