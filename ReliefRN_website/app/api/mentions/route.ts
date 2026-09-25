import {json,readBody,sameOrigin,validPoint} from '@/lib/server';
import {placesFromText,nearOrElsewhere} from '@/lib/mentions';
import {detectPlace} from '@/lib/location';

// POST {text, lat?, lng?, state?} -> {places, area?}
// places: places named in an assistant reply whose street addresses check out.
// area:   set when those places are all in another city than the one on the
//         map (the person asked about Fairfax while the map showed Norfolk),
//         so the page can move there, just as it does when the person names a place.
export async function POST(request:Request){
 if(!sameOrigin(request))return json({error:'Invalid origin'},403);
 try{
  const b=await readBody(request,20000);
  const text=String(b.text||'').slice(0,16000);
  const lat=Number(b.lat),lng=Number(b.lng);
  const near=validPoint(lat,lng)?{lat,lng,label:'',state:String(b.state||'').slice(0,2)}:null;
  if(!text.trim())return json({places:[]});
  const {places,moveTo}=nearOrElsewhere(await placesFromText(text),near);
  const area=moveTo?await detectPlace(moveTo):null;
  return json({places:moveTo&&!area?[]:places,area});
 }catch{return json({places:[]});}
}
