// Places the assistant names in a reply ("Fair Ridge Shelter, 3997 Fair Ridge
// Drive, Fairfax, VA 22033, phone 703-536-2155") become resource-list and map
// entries, so the page matches what the assistant just said.
//
// The assistant's words are not trusted as fact: a place is only added when
// its street address geocodes to a real address near the person, and it is
// labelled "named by your assistant · call to confirm" everywhere it appears.
import {fetchJson} from './server';
import {miles,type Area,type Kind,type Place} from './resources';

const STREET='(?:Road|Rd|Drive|Dr|Court|Ct|Highway|Hwy|Street|St|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Way|Pike|Parkway|Pkwy|Place|Pl|Circle|Cir|Terrace|Ter|Trail|Trl|Square|Sq|Loop|Plaza|Route|Rte|Turnpike|Tpke|Expressway|Expy|Crossing|Xing|Row|Run|Walk|Center|Ctr)';
// "3997 Fair Ridge Drive, Fairfax, VA 22033" / "3160 Campbell Drive, Fairfax, VA"
const ADDRESS_SOURCE=String.raw`(\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.'’\- ]{1,50}?\b`+STREET+String.raw`\b\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW)\b\.?)?(?:,?\s*(?:Suite|Ste|Unit|#)\s*[\w-]+)?)\s*,\s*([A-Za-z .'’-]{2,40}?)\s*,\s*([A-Z]{2})\b(?:\s+(\d{5}))?`;
const PHONE=/(?:\+?1[-. ]?)?\(?\b(\d{3})\)?[-. ](\d{3})[-. ](\d{4})\b/;

// First match wins. Shelter words come first: "a drop-in centre providing food,
// showers and medical services" is a shelter, not a hospital.
const KINDS:[Kind,RegExp][]=[
 ['drc',/recovery cent|\bDRC\b|centro de recuperaci|恢复中心|trung tâm phục hồi|مركز التعافي|مراكز التعافي|복구 센터|بحالی مرکز|የማገገሚያ ማዕከል|centre de reconstruction/i],
 ['shelter',/shelter|homeless|drop-in|family (?:center|centre)|housing|refugio|albergue|避难所|庇护所|nơi trú ẩn|ملجأ|مأوى|대피소|쉼터|پناہ گاہ|መጠለያ|\babri\b|refuge|hébergement|आश्रय/i],
 ['vet',/veterinar|animal hospital|pet hospital|\bvet\b|宠物医院|thú y|بيطري|동물병원|جانوروں کا ہسپتال|የእንስሳት ሆስፒታል|vétérinaire/i],
 ['hospital',/hospital|medical cent|health cent|clinic|urgent care|emergency room|\bER\b|医院|诊所|bệnh viện|مستشفى|병원|ہسپتال|ሆስፒታል|hôpital|clinique|अस्पताल/i],
 ['responder',/fire (?:station|department|rescue)|police|sheriff|rescue squad|\bEMS\b|ambulance/i],
 ['manager',/emergency management|office of emergency|\bOEM\b/i],
];

export type Mention={name:string;address:string;phone?:string;kind:Kind;note?:string};

function cleanName(s:string){
 let n=s.trim().replace(/^[\s\-*•\d.)]+/,'').replace(/\*\*/g,'');
 // Prose: "If you need care, go to Inova Fairfax Hospital at" -> "Inova Fairfax Hospital"
 const lead=[...n.matchAll(/\b(?:go to|head to|visit|try|contact|call|see|reach|there is|there's)\s+/gi)].pop();
 if(lead&&lead.index!==undefined)n=n.slice(lead.index+lead[0].length);
 const comma=n.lastIndexOf(', ');
 if(comma>0&&/^(?:for|if|in|near|during|when|to|also|and|or)\b/i.test(n))n=n.slice(comma+2);
 return n.replace(/^(?:the\s+)?(?:at|in)\s+/i,'').replace(/\s+(?:is|are)?\s*(?:located\s+)?(?:at|on)$/i,'')
  .replace(/[\s,:;–—-]+$/,'').replace(/\s*\((?:[^)]*)\)\s*$/,'').trim().slice(0,90);
}
// The last clause before an address is the place's name. A period after a
// single capital is an initial ("Katherine K. Hanley"), not a sentence end.
const CLAUSE_END=/(?:(?<!\b[A-Z])\.|[:;])(?=\s)/;
const SENTENCE_END=/(?<=[.!?])\s+(?=[A-Z])/;

export function extractMentions(text:string):Mention[]{
 const out:Mention[]=[];
 const chunks=text.split(/\n+/);
 for(const raw of chunks){
  // A paragraph can name several places; each one's name is the text since
  // the previous address, and its note/phone the text up to the next one.
  const hits=[...raw.matchAll(new RegExp(ADDRESS_SOURCE,'g'))];
  hits.forEach((m,i)=>{
   if(m.index===undefined)return;
   const from=i?hits[i-1].index!+hits[i-1][0].length:0;
   const before=raw.slice(from,m.index);
   const name=cleanName(before.split(CLAUSE_END).pop()||'');
   if(!name||name.length<3||/^\d+$/.test(name))return;
   const [,street,city,state,zip]=m;
   const address=[street.trim(),city.trim(),`${state}${zip?' '+zip:''}`].join(', ');
   const rest=raw.slice(m.index+m[0].length,i+1<hits.length?hits[i+1].index:undefined);
   // The next place's name sits at the end of this rest; the note is the first sentence only.
   const restFirst=rest.replace(/^[\s,]*(?:phone|tel|call)?[\s:]*(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/i,'').replace(/^[\s,.;:-]+/,'').split(SENTENCE_END)[0]||'';
   const ph=rest.match(PHONE);
   const kind=(KINDS.find(([,re])=>re.test(name))||KINDS.find(([,re])=>re.test(restFirst))||[])[0];
   if(!kind)return;                                   // food pantries etc. stay in the chat
   // A note is a description of the place, not a trailing "or call 911".
   const note=/^(?:or|and|but|then)\b/i.test(restFirst)?undefined:restFirst.replace(/\*\*/g,'').trim().slice(0,140)||undefined;
   if(!out.some(o=>o.address.toLowerCase()===address.toLowerCase()))
    out.push({name,address,phone:ph?`${ph[1]}-${ph[2]}-${ph[3]}`:undefined,kind,note});
  });
 }
 return out.slice(0,12);
}

// Street-level only: a city centroid would put the pin in the wrong place.
const STREET_LEVEL=new Set(['PointAddress','StreetAddress','StreetAddressExt','Subaddress','StreetInt','POI']);

export type Found={places:Place[];towns:string[]};

// Geocodes every named place. Distance filtering is left to the caller, which
// knows where the person is.
export async function placesFromText(text:string):Promise<Found>{
 const found=extractMentions(text);
 const geocoded=await Promise.allSettled(found.map(async m=>{
  const params=new URLSearchParams({SingleLine:m.address,f:'json',outFields:'Addr_type',maxLocations:'1',countryCode:'USA',forStorage:'false'});
  const d=await fetchJson('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?'+params,{},6000);
  const c=(d.candidates||[])[0];
  if(!c||c.score<90||!STREET_LEVEL.has(c.attributes?.Addr_type))return null;
  const lat=c.location.y,lng=c.location.x;
  const q=encodeURIComponent(m.name+' '+m.address);
  const [, city='', stateZip='']=m.address.split(', ');
  return {town:`${city}, ${stateZip.slice(0,2)}`,place:{id:`mentioned-${m.kind}-${m.address.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,kind:m.kind,name:m.name,address:m.address,lat,lng,phone:m.phone,
   url:`https://www.openstreetmap.org/search?query=${q}`,source:'mentioned',note:m.note} as Place};
 }));
 const ok=geocoded.flatMap(r=>r.status==='fulfilled'&&r.value?[r.value]:[]);
 return {places:ok.map(o=>o.place),towns:ok.map(o=>o.town)};
}

// The places near the person, or, when every named place is far away but they
// sit together (the person asked about another city), that city to move to.
export function nearOrElsewhere(found:Found,near:Area|null,radius=60):{places:Place[];moveTo?:string}{
 if(!found.places.length)return {places:[]};
 if(near){const close=found.places.filter(p=>miles(near,p)<=radius);if(close.length)return {places:close};}
 const first=found.places[0];
 const together=found.places.every(p=>miles(first,p)<=40);
 if(!together)return {places:[]};
 // The town named most often in the reply, e.g. "Fairfax, VA".
 const counts=new Map<string,number>();for(const t of found.towns)counts.set(t,(counts.get(t)||0)+1);
 const moveTo=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
 return {places:found.places,moveTo};
}
