/** FloatingPetController / PettingDetector / HeartBubbleArt, Mac feature/battle ad1bb7c. */
export const prayerQuips=["일단 한번 빌어봄","하늘이 아직 확인 안 함","알이 살짝 부담스러워함","손 모으는 자세가 제법 프로","하늘 서버 응답 지연 중","하늘 대기열 3,812번째","손바닥이 닳는 중","이쯤 되면 알도 같이 빌어줌","하늘: \"접수했습니다. 검토 후 답변드릴게요\"","알이 방금 \"그만…\"이라고 한 것 같음","전설 나오면 이건 실력임"];
export const heartRows=["..OOOOOOOOOOOOO..",".OWWWWWWWWWWWWWO.","OWWWWWWWWWWWWWWWO","OWWWWRRRWRRRWWWWO","OWWWRHHRRRRRRWWWO","OWWWRHRRRRRRDWWWO","OWWWRRRRRRRRDWWWO","OWWWWRRRRRRDWWWWO","OWWWWWRRRRDWWWWWO","OWWWWWWRRDWWWWWWO","OWWWWWWWDWWWWWWWO","OWWWWWWWWWWWWWWWO",".OWWWWWWWWWWWWWO.","..OOOOOWWWOOOOO..",".......OWO.......","........O........"];
export const heartColors={O:'#202020',W:'#ffffff',R:'#e0303c',D:'#a8202c',H:'#ff9aa2'};
export function spriteOpaqueTop(data:Uint8ClampedArray,width:number,height:number){
 const first=(start:number,end:number)=>{for(let y=0;y<height;y++)for(let x=start;x<end;x++)if(data[(y*width+x)*4+3]!>16)return y;return undefined;};
 return (first(Math.floor(width*.35),Math.max(Math.floor(width*.35)+1,Math.floor(width*.65)))??first(0,width)??0)/height;
}
export function spriteVisibleTop(size:number,width:number,height:number,fractions:number[]){const fit=Math.min(size/width,size/height)*height,fraction=[...fractions].sort((a,b)=>a-b)[Math.floor(fractions.length/2)]??0;return(size-fit)/2+Math.max(0,Math.min(1,fraction))*fit;}
export function petPanelSize(size:number,bubble:boolean){return{width:bubble?Math.max(size,180):size,height:size+(bubble?72:0)};}
/** Keep the Windows composition surface stationary; native regions expose only the visible UI. */
export function petSurfaceSize(size:number){return petPanelSize(size,true);}
export function petSurfaceShape(size:number,bubble:boolean,surface=petSurfaceSize(size)){const left=(surface.width-size)/2;return bubble?[{x:0,y:0,width:surface.width,height:surface.height}]:[{x:Math.floor(left),y:surface.height-size,width:Math.ceil(left+size)-Math.floor(left),height:size}];}
export function petOrigin(bounds:{x:number;y:number;width:number;height:number},size:number){return{x:Math.round(bounds.x+(bounds.width-size)/2),y:bounds.y+bounds.height-size};}
export function prayerHoverLine(count:number,t:(text:string,args?:Record<string,string|number>)=>string){if(count<=0)return '';return t(count===1?'기도 1회':'기도 {n}회',{n:count})+' · '+t(prayerQuips[Math.min(Math.floor(count/30),10)]!);}
export class PettingDetector{
 private direction=0;private extreme=0;private last:number|undefined;private reversals:number[]=[];
 reset(){this.direction=0;this.extreme=0;this.last=undefined;this.reversals=[];}
 feed(x:number,time:number,minStroke:number){if(this.last===undefined||time-this.last>1200){this.reset();this.last=time;this.extreme=x;return false;}this.last=time;this.reversals=this.reversals.filter(t=>time-t<=1200);if(!this.direction){if(Math.abs(x-this.extreme)<minStroke)return false;this.direction=x>this.extreme?1:-1;this.extreme=x;return false;}if((x-this.extreme)*this.direction>0){this.extreme=x;return false;}if((this.extreme-x)*this.direction<minStroke)return false;this.direction=-this.direction;this.extreme=x;this.reversals.push(time);return this.reversals.length>=3;}
}
