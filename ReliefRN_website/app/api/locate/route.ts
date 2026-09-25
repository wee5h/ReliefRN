import {json,readBody,sameOrigin} from '@/lib/server';
import {detectPlace} from '@/lib/location';
import {sensitive} from '@/lib/safety';

// POST {text, previous} -> {area} when the message says where the person is,
// otherwise {area:null}. Only city, county or ZIP-level places are returned.
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'Invalid origin'},403);
 try{
  const b=await readBody(request,6000);
  const text=String(b.text||'').slice(0,2000),previous=String(b.previous||'').slice(-600);
  if(!text.trim()||sensitive(text))return json({area:null});
  return json({area:await detectPlace(text,previous)});
 }catch{return json({area:null});}
}
