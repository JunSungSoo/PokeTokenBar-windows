// Only the owning frame can drive the unchanged Mac/PokéRogue player.
window.webkit={messageHandlers:{rogue:{postMessage:value=>parent.postMessage({ptbPlayer:true,...value},'*')}}};
window.addEventListener('message',async event=>{
 if(event.source!==parent||!event.data?.ptbCall)return;
 const {id,method,args}=event.data;
 if(!['ptbPrepare','ptbAdvance','ptbFinish','ptbInspect','ptbSetEffectsVolume'].includes(method))return;
 try{const result=await window[method](...(Array.isArray(args)?args:[]));parent.postMessage({ptbReply:id,result},'*');}
 catch(error){parent.postMessage({ptbReply:id,error:String(error.message??error)},'*');}
});
