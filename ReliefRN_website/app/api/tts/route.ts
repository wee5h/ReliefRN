import {json,readBody,sameOrigin} from '@/lib/server';
import {speak} from '@/lib/foundry';
import {isLanguage} from '@/lib/i18n';

// Read aloud for languages the visitor's computer has no voice for. The agent
// bridge turns the text into Microsoft neural speech and this returns the MP3.
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'Invalid origin'},403);
 let b:any;
 try{b=await readBody(request,20000);}catch{return json({error:'Invalid request'},400);}
 const text=typeof b.text==='string'?b.text.trim().slice(0,6000):'';
 if(!text||!isLanguage(b.language))return json({error:'Invalid request'},400);
 try{
  const audio=await speak(text,b.language);
  return new Response(audio,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return json({error:'Read aloud is unavailable'},503);}
}
