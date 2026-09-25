import {json,readBody,sameOrigin} from '@/lib/server';
import {health,start,poll,cancel} from '@/lib/foundry';
import {guidedAnswer,sensitive,urgent,highImpact,type Message} from '@/lib/safety';
import {translations,isLanguage,type Language} from '@/lib/i18n';

// POST starts a live-agent run and returns a token to poll. Urgent and
// sensitive messages never wait for AI: they are answered locally at once.
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'Invalid origin'},403);
 let b:any;
 try{b=await readBody(request);}catch{return json({error:'Invalid request'},400);}
 const language:Language=isLanguage(b.language)?b.language:'en';
 const list=Array.isArray(b.messages)?b.messages:[];
 if(!list.length||list.length>20||list.some((m:any)=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.length||m.content.length>5000))return json({error:'Invalid messages'},400);
 const last=list[list.length-1].content;const summary=b.mode==='summary';
 // Only the user's own words are screened; an agent reply that quotes a
 // 9-digit FEMA number must not lock the conversation.
 if(list.some((m:any)=>m.role==='user'&&sensitive(m.content)))return json({message:{role:'assistant',content:translations[language].sensitive,mode:'privacy'}},200);
 if(!summary&&urgent(last))return json({message:guidedAnswer(last,language)});
 // `fallback` says why a guided answer was used, for whoever runs the demo.
 const h=await health();
 if(!h.ok){const fallback=h.mode==='offline'?'agent bridge not running':'agent bridge not signed in';return summary?json({error:'Live agents are not connected',fallback},503):json({message:guidedAnswer(last,language),configured:false,fallback});}
 try{
  const token=await start(list as Message[],language,String(b.area||'Not provided').slice(0,140),summary,highImpact(last));
  return json({status:'pending',token,escalate:highImpact(last)},202);
 }catch(e){
  // Bridge went away between the health check and the run: still help.
  const fallback='agent bridge error: '+(e instanceof Error?e.message:'unknown').slice(0,160);
  return summary?json({error:'The live agents are unavailable. No automatic resend was made.',fallback},503):json({message:guidedAnswer(last,language),configured:false,fallback});
 }
}

export async function GET(request:Request){
 try{const token=new URL(request.url).searchParams.get('token')||'';return json(await poll(token));}
 catch{return json({error:'Unable to retrieve the reply'},503);}
}

export async function DELETE(request:Request){
 if(!sameOrigin(request))return json({error:'Invalid origin'},403);
 try{const b=await readBody(request);await cancel(String(b.token||''));return json({cancelled:true});}
 catch{return json({error:'Unable to cancel'},400);}
}
