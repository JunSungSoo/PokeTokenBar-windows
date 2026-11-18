/** Mac DriveReleaseSource / UpdateChecker rules, with Windows ZIP names. */
export const windowsDriveURL='https://drive.google.com/file/d/1ykwLYTBaFVFfKR6NlDHXNcrk9p-lTQfY/view';
export function driveShareURL(raw:string):string|undefined {
 try{const url=new URL(raw.trim());if(url.protocol!=='https:'||url.hostname!=='drive.google.com'||url.port||url.username||url.password)return;const match=/^\/file\/d\/([A-Za-z0-9_-]{10,200})\/view\/?$/.exec(url.pathname);if(match)return'https://drive.google.com/file/d/'+match[1]+'/view';}catch{}
}
export function releaseVersion(tag:string):string|undefined {
 const match=/^[vV]?([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})$/.exec(tag.trim());return match?match.slice(1).map(Number).join('.'):undefined;
}
export function newerVersion(candidate:string,current:string):boolean {
 const a=releaseVersion(candidate),b=releaseVersion(current);if(!a||!b)return false;const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]!>bb[i]!;return false;
}
export function windowsZipVersion(filename:string):string|undefined {
 const match=/^PokeTokenBar-Windows-([0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9})(?:-(?:[0-9]{6,8}(?:\([1-9][0-9]{0,5}\))?|x64(?:-[A-Za-z0-9_-]{1,100})?))?\.zip$/.exec(filename);return match?releaseVersion(match[1]!):undefined;
}
export function driveRelease(html:string,url:string):{version:string;url:string}|undefined {
 const trusted=driveShareURL(url),match=/<title[^>]*>([^<]{1,256})<\/title>/i.exec(html);if(!trusted||!match)return;const title=match[1]!.trim().replace(/&#(?:40|x28);/gi,'(').replace(/&#(?:41|x29);/gi,')');if(!title.endsWith(' - Google Drive'))return;const version=windowsZipVersion(title.slice(0,-' - Google Drive'.length));return version?{version,url:trusted}:undefined;
}
