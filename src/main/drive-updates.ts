import {driveShareURL,driveRelease} from '../shared/drive-release.js';
export class DriveReleaseSource {
 private cached?:{url:string;at:number;release:{version:string;url:string}};
 private pending?:{url:string;promise:Promise<{version:string;url:string}>};
 constructor(private request:typeof fetch=fetch,private clock=Date.now){}
 check(raw:string,minInterval=30*60*1000):Promise<{version:string;url:string}>{
  const url=driveShareURL(raw);if(!url)return Promise.reject(new Error('Windows 업데이트용 Google Drive 파일 링크를 등록해 주세요.'));
  if(this.pending?.url===url)return this.pending.promise;
  if(this.cached?.url===url&&this.clock()-this.cached.at<minInterval)return Promise.resolve(this.cached.release);
  const promise=this.fetchRelease(url).then(release=>{this.cached={url,at:this.clock(),release};return release;}).finally(()=>{if(this.pending?.promise===promise)this.pending=undefined;});this.pending={url,promise};return promise;
 }
 private async fetchRelease(url:string){
  const response=await this.request(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)}),max=1048576;
  if(response.status!==200||response.url&&driveShareURL(response.url)!==url||!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length')??0)>max){await response.body?.cancel();throw new Error('Google Drive 공개 파일 정보를 확인할 수 없습니다.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Google Drive 응답이 비어 있습니다.');const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>max){await reader.cancel();throw new Error('Google Drive 응답이 너무 큽니다.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const release=driveRelease(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),url);if(!release)throw new Error('Windows ZIP 파일 이름의 버전을 확인할 수 없습니다.');return release;
 }
}
