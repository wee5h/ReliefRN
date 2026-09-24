import {json,readBody,sameOrigin} from '@/lib/server';
import {configured,start,poll,cancel} from '@/lib/foundry';
import {guidedAnswer,sensitive,urgent,highImpact,type Message} from '@/lib/safety';
import {translations,type Language} from '@/lib/i18n';
export async function POST(request:Request){if(!sameOrigin(request))return json({error:'Invalid origin'},403);try{const b=await readBody(request);const language:Language=['en','es','hi'].includes(b.language)?b.language:'en';const list=Array.isArray(b.messages)?b.messages:[];if(!list.length||list.length>20||list.some((m:any)=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>5000))return json({error:'Invalid messages'},400);const last=list[list.length-1].content;
 if(list.some((m:any)=>sensitive(m.content)))return json({message:{role:'assistant',content:translations[language].sensitive,mode:'privacy'}},200);
 if(urgent(last))return json({message:guidedAnswer(last,language)});
 if(!configured())return json({message:guidedAnswer(last,language),configured:false});
 const token=await start(list as Message[],language,String(b.area||'Not provided').slice(0,140),b.mode==='summary');return json({status:'pending',token,escalate:highImpact(last)},202);
 }catch{return json({error:'The assistant is unavailable. No automatic resend was made.'},503);}}
export async function GET(request:Request){try{if(!configured())return json({error:'Not connected'},503);const token=new URL(request.url).searchParams.get('token')||'';return json(await poll(token));}catch{return json({error:'Unable to retrieve the reply'},503);}}
export async function DELETE(request:Request){if(!sameOrigin(request))return json({error:'Invalid origin'},403);try{const b=await readBody(request);await cancel(String(b.token||''));return json({cancelled:true});}catch{return json({error:'Unable to cancel'},400);}}
