// Finds where the person is from what they type in the chat, so the map,
// resources and agents can follow them without a separate location form.
//
// Deliberately conservative. The geocoder will happily turn "my house" into
// House, Alabama or "Red Cross" into Red Cross, North Carolina, so free text
// is never geocoded wholesale. Only recognisable location phrases are tried,
// a result must be a city, county or ZIP (never a whole state), and a name
// that exists in several states is ignored unless the person named the state.
import {fetchJson} from './server';
import type {Area} from './resources';

const STATES:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico',VI:'Virgin Islands',GU:'Guam',AS:'American Samoa',MP:'Northern Mariana Islands'};
const CODE_BY_NAME:Record<string,string>=Object.fromEntries(Object.entries(STATES).map(([c,n])=>[n.toLowerCase(),c]));
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const NAMES=Object.values(STATES).sort((a,b)=>b.length-a.length).map(esc).join('|');
const CODES=Object.keys(STATES).join('|');
const W="[A-Za-zÀ-ÿ.'’-]+";                     // one word of a place name
const CAP="[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]+";            // a capitalised word

// Words people put before a place ("my apartment in", "estoy en"). Spanish
// articles are left out on purpose: El Paso, La Grange, Del Rio, De Soto.
const LEAD=new Set(('i im i\'m i’m am we were we\'re we’re are is live living lives stay staying stuck located currently now right here there in at near from around outside by to the my our of city town county area just and y en vivo vivimos estoy estamos cerca desde apartment house home place').split(' '));
// Phrases that look like places to a geocoder but are not where anyone is.
const NOT_PLACE=new Set(('home house my house our house apartment shelter hospital school church work danger need trouble help fema sba red cross the red cross english spanish hindi espanol español ingles inglés spanish please thanks thank you yes no ok okay sure hello hi insurance flood fire hurricane storm tornado wildfire earthquake').split(' '));
const ASKED_WHERE=/\b(where|location|located|city|county|zip|area|state|dónde|donde|ubicaci|ciudad|condado|código postal|कहाँ|कहां|स्थान|शहर|ज़िला|जिला)\b/i;

type Candidate={text:string;state?:string;strict:boolean};

function clean(raw:string){
  let words=raw.trim().replace(/[,.;:!?]+$/,'').split(/\s+/);
  // Keep what follows the last lead-in word ("my apartment in | Norfolk").
  // A lead word at the very end is part of the name: "Lake City", "Harris County".
  for(let i=words.length-2;i>=0;i--){if(LEAD.has(words[i].toLowerCase())){words=words.slice(i+1);break;}}
  if(words.every(w=>LEAD.has(w.toLowerCase())))return '';
  const out=words.join(' ').trim();
  return out.length>=2&&!NOT_PLACE.has(out.toLowerCase())?out:'';
}
function stateCode(s?:string){if(!s)return undefined;const up=s.trim().toUpperCase();return STATES[up]?up:CODE_BY_NAME[s.trim().toLowerCase()];}

export function candidates(text:string,previous=''):Candidate[]{
  const out:Candidate[]=[];const add=(t:string,state?:string,strict=false)=>{const c=clean(t);if(c&&!out.some(o=>o.text.toLowerCase()===c.toLowerCase()&&o.state===state))out.push({text:c,state,strict});};
  // 1. ZIP code, but not a dollar amount, a count, or part of a longer number.
  for(const m of text.matchAll(/(?<![\d$€.,#-])\b(\d{5})(?:-\d{4})?\b(?![\d,.]\d)(?!\s*(?:dollars|usd|people|homes|houses|acres|sq|square|feet|ft|miles|mi|%|k\b))/gi))add(m[1],undefined,false);
  // 2. "Buncombe County, NC" / "Orleans Parish"
  for(const m of text.matchAll(new RegExp(`\\b((?:${W}\\s+){0,2}${W}\\s+(?:County|Parish|Borough))\\b(?:,?\\s*(${NAMES}|${CODES})\\b)?`,'gi')))add(m[1],stateCode(m[2]));
  // 3. "Houston, TX" / "houston, texas"
  for(const m of text.matchAll(new RegExp(`\\b((?:${W}\\s+){0,2}${W}),\\s*(${NAMES}|${CODES})\\b`,'gi')))add(m[1],stateCode(m[2]));
  // 4. "Houston TX" (code must be capitals here) / "houston texas"
  for(const m of text.matchAll(new RegExp(`\\b((?:${CAP}\\s+){0,2}${CAP})\\s+(${CODES})\\b`,'g')))add(m[1],m[2]);
  for(const m of text.matchAll(new RegExp(`\\b((?:${W}\\s+){0,2}${W})\\s+(${NAMES})\\b`,'gi')))add(m[1],stateCode(m[2]));
  // 5. "in Asheville", "cerca de Houston": capitalised, and must be unambiguous.
  for(const m of text.matchAll(new RegExp(`\\b(?:in|near|from|around|outside|en|cerca de|desde)\\s+(?:the\\s+(?:city|town)\\s+of\\s+|la\\s+ciudad\\s+de\\s+)?(${CAP}(?:\\s+${CAP}){0,2})`,'g')))add(m[1],undefined,true);
  // 6. A short message that ends in a state code, any case: "weston wv".
  const words=text.trim().split(/\s+/);
  const tail=text.trim().match(new RegExp(`^((?:${W}\\s+){0,2}${W})\\s+(${CODES})[.!]?$`,'i'));
  if(words.length<=4&&tail)add(tail[1],tail[2].toUpperCase());
  // 7. A short reply right after the assistant asked where they are.
  if(words.length<=5&&ASKED_WHERE.test(previous)&&!/\d{6,}/.test(text))add(text,undefined,true);
  return out.slice(0,4);
}

type Hit={address:string;score:number;location:{x:number;y:number};attributes:{Addr_type?:string;Type?:string;RegionAbbr?:string;City?:string;Subregion?:string;Rank?:number}};
const rank=(h:Hit)=>Number.isFinite(h.attributes.Rank)?Number(h.attributes.Rank):99;
// How much more prominent (lower geocoder Rank) a bare name must be than the
// same name in any other state. Asheville NC 8.1 vs OH 18.8 passes; Norfolk
// VA 6.5 vs NE 8.9 and Harris County GA/TX 10 vs 10 do not.
const CLEAR_LEAD=5;
const ACCEPT_ADDR=new Set(['Locality','Postal','PostalLoc','PostalExt','Neighborhood','District']);
const REJECT_TYPE=new Set(['State or Province','Country','Continent','Territory','Zone','Region']);

async function geocode(c:Candidate):Promise<Area|null>{
  const q=c.state?`${c.text}, ${STATES[c.state]}`:c.text;
  const params=new URLSearchParams({SingleLine:q,f:'json',category:'Populated Place,Postal',outFields:'Addr_type,Type,RegionAbbr,City,Subregion,Rank',maxLocations:'8',countryCode:'USA',forStorage:'false'});
  const d=await fetchJson('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?'+params,{},6000);
  const hits:Hit[]=(d.candidates||[]).filter((h:Hit)=>h.score>=88&&ACCEPT_ADDR.has(h.attributes.Addr_type||'')&&!REJECT_TYPE.has(h.attributes.Type||'')&&h.attributes.RegionAbbr);
  if(/^\d{5}/.test(c.text)){const zip=hits.find(h=>h.attributes.Addr_type?.startsWith('Postal'));if(!zip)return null;return toArea(zip);}
  const pool=(c.state?hits.filter(h=>h.attributes.RegionAbbr===c.state):hits).sort((a,b)=>rank(a)-rank(b));
  const best=pool[0];
  if(!best)return null;
  // A bare name found in more than one state ("Norfolk", "Harris County") is
  // ambiguous unless one is far more prominent: guessing wrong would show
  // someone resources hundreds of miles away.
  if(!c.state){
    const rival=pool.find(h=>h.attributes.RegionAbbr!==best.attributes.RegionAbbr);
    if(rival&&rank(rival)-rank(best)<CLEAR_LEAD)return null;
    if(c.strict&&best.score<95)return null;
  }
  return toArea(best);
}
function toArea(best:Hit):Area{
  const a=best.attributes;
  return {label:best.address,lat:best.location.y,lng:best.location.x,state:a.RegionAbbr||'',locality:a.City||a.Subregion||''};
}

export async function detectPlace(text:string,previous=''):Promise<Area|null>{
  for(const c of candidates(text,previous)){
    try{const area=await geocode(c);if(area)return area;}catch{/* try the next phrase */}
  }
  return null;
}
