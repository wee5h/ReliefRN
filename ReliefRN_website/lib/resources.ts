export type Kind = 'shelter'|'drc'|'responder'|'hospital'|'vet'|'manager';
export type Place = {id:string;kind:Kind;name:string;address:string;lat:number;lng:number;phone?:string;email?:string;url:string;source:'official'|'provider'|'community'|'mentioned';distance?:number;note?:string;reportedOpen?:boolean;updated?:string;tags?:string[]};
export type Area = {label:string;lat:number;lng:number;state:string;locality?:string};
export const defaultArea:Area={label:'Norfolk, Virginia',lat:36.8508,lng:-76.2859,state:'VA',locality:'Norfolk'};
export const limits:Record<Kind,number>={shelter:2,drc:2,responder:2,hospital:1,vet:1,manager:1};
export const kinds:Kind[]=['shelter','drc','responder','hospital','vet','manager'];
export const zoneService='https://services3.arcgis.com/qVupYidwzMKkDQzr/arcgis/rest/services/Virginia_Evacuation_Zones_2020/FeatureServer/0';
export const zoneTiles='https://services3.arcgis.com/qVupYidwzMKkDQzr/arcgis/rest/services/VirginiaHurricaneEvacuationZones_2020Update_TileCache/MapServer/tile/{z}/{y}/{x}';
export const seedPlaces:Place[]=[
 {id:'norfolk-southside',kind:'shelter',name:'Southside STEM Academy',address:'1106 Campostella Rd, Norfolk, VA 23523',lat:36.829611,lng:-76.260483,phone:'757-664-6510',url:'https://www.norfolk.gov/647/Shelter-Information',source:'official',tags:['Accessible','Pets welcome'],updated:'2026-09-23'},
 {id:'norfolk-norview',kind:'shelter',name:'Norview High School',address:'6501 Chesapeake Blvd, Norfolk, VA 23513',lat:36.900317,lng:-76.239839,phone:'757-664-6510',url:'https://www.norfolk.gov/647/Shelter-Information',source:'official',tags:['Accessible','Pets welcome'],updated:'2026-09-23'},
 {id:'norfolk-fire1',kind:'responder',name:'Norfolk Fire-Rescue · Station 1',address:'450 St. Paul Blvd, Norfolk, VA 23510',lat:36.851215,lng:-76.284623,phone:'911',url:'https://www.norfolk.gov/610/Fire-Stations',source:'official',updated:'2026-09-23'},
 {id:'norfolk-fire2',kind:'responder',name:'Norfolk Fire-Rescue · Station 2',address:'2501 Church St, Norfolk, VA 23504',lat:36.869539,lng:-76.280206,phone:'911',url:'https://www.norfolk.gov/610/Fire-Stations',source:'official',updated:'2026-09-23'},
 {id:'norfolk-sentara',kind:'hospital',name:'Sentara Norfolk General Hospital',address:'600 Gresham Dr, Norfolk, VA 23507',lat:36.861980,lng:-76.303419,phone:'757-388-3000',url:'https://www.sentara.com/hospitalslocations/sentara-norfolk-general-hospital',source:'provider',updated:'2026-09-23'},
 {id:'norfolk-ghent',kind:'vet',name:'Ghent Veterinary Hospital',address:'939 W 21st St, Norfolk, VA 23517',lat:36.872403,lng:-76.300102,phone:'757-960-6977',url:'https://www.ghentvet.com/',source:'provider',email:'welcome@ghentandgranby.com',updated:'2026-09-23'},
 {id:'norfolk-manager',kind:'manager',name:'Daniel Hudson · Norfolk Emergency Management',address:'3661 E Virginia Beach Blvd, Norfolk, VA 23502',lat:36.854546,lng:-76.236579,phone:'757-441-5724',url:'https://lemd.vdem.virginia.gov/public/',source:'official',updated:'2026-09-23'}
];
export function miles(a:{lat:number;lng:number},b:{lat:number;lng:number}){const r=Math.PI/180;const dlat=(b.lat-a.lat)*r,dlng=(b.lng-a.lng)*r;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;return 3958.7613*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
export function nearest(places:Place[],area:Area){const withDistance=places.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).map(p=>({...p,distance:miles(area,p)}));return kinds.flatMap(k=>withDistance.filter(p=>p.kind===k).sort((a,b)=>a.distance-b.distance).slice(0,limits[k]));}
// Adds listings to an existing nearest-N list without duplicating a place.
export function mergeNearby(existing:Place[],extra:Place[],area:Area){const all=[...existing];for(const p of extra){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng))continue;if(!all.some(x=>x.kind===p.kind&&(miles(x,p)<0.12||x.name.toLowerCase()===p.name.toLowerCase())))all.push(p);}return nearest(all,area);}
// Veterinary clinics and year-round shelters from OpenStreetMap, fetched by
// the browser (Overpass allows cross-origin requests). FEMA's shelter feed only
// lists disaster shelters that are open right now, so OSM fills in the family
// and homeless shelters people are actually referred to. Two public mirrors are
// tried in turn; both are often busy, so a failure leaves the list as it was.
// Shelters for people without housing; not respite, nursing or animal shelters.
const SHELTER_FOR=(f?:string)=>!f||/homeless|displaced|family|underprivileged|refugee|victim|women|youth/i.test(f);
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
export async function communityLookup(area:Area):Promise<Place[]>{
 const q=`[out:json][timeout:8];(nwr(around:25000,${area.lat},${area.lng})[amenity=veterinary];nwr(around:30000,${area.lat},${area.lng})[social_facility=shelter];);out center tags 60;`;
 for(const u of OVERPASS){try{const r=await fetch(u+'?data='+encodeURIComponent(q),{signal:AbortSignal.timeout(8000)});if(!r.ok)continue;const d:any=await r.json();
  return (d.elements||[]).filter((e:any)=>e.tags?.name&&(e.tags.amenity==='veterinary'||SHELTER_FOR(e.tags['social_facility:for']))).map((e:any)=>{const t=e.tags;const kind:Kind=t.amenity==='veterinary'?'vet':'shelter';return {id:`osm-${e.type}-${e.id}`,kind,name:t.name,address:[t['addr:housenumber'],t['addr:street'],t['addr:city'],t['addr:postcode']].filter(Boolean).join(' '),lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon,phone:t.phone||t['contact:phone']||undefined,url:`https://www.openstreetmap.org/${e.type}/${e.id}`,source:'community' as const};});}catch{/* next mirror */}}
 return [];
}
export function seedFor(area:Area){return area.state==='VA'&&miles(area,defaultArea)<12?nearest(seedPlaces,area):[];}
export const sourceLinks=[
 {name:'Virginia Department of Emergency Management',url:'https://www.vdem.virginia.gov/',group:'Virginia'},
 {name:'Virginia disaster events',url:'https://www.vdem.virginia.gov/disaster-events/',group:'Virginia'},
 {name:'Virginia · Know Your Zone',url:'https://www.vdem.virginia.gov/know-your-zone/',group:'Virginia'},
 {name:'Virginia VOAD · community recovery',url:'https://www.virginiavoad.org/',group:'Virginia'},
 {name:'Virginia.gov · emergency services',url:'https://www.virginia.gov/services/public-safety/emergency/',group:'Virginia'},
 {name:'Local emergency managers · Virginia',url:'https://lemd.vdem.virginia.gov/public/',group:'Virginia'},
 {name:'DisasterAssistance.gov',url:'https://www.disasterassistance.gov/',group:'Federal'},
 {name:'FEMA · disaster declarations',url:'https://www.fema.gov/disaster/declarations',group:'Federal'},
 {name:'Ready.gov · disability preparedness',url:'https://www.ready.gov/disability',group:'Federal'},
 {name:'USA.gov · every state’s emergency agency',url:'https://www.usa.gov/state-emergency-management',group:'Federal'},
 {name:'211 · local help directory',url:'https://www.211.org/',group:'Community'},
 {name:'American Red Cross · find a shelter',url:'https://www.redcross.org/get-help/disaster-relief-and-recovery-services/find-an-open-shelter.html',group:'Community'},
 {name:'OpenFEMA · dataset catalog API',url:'https://www.fema.gov/api/open/v1/DataSets',group:'Data'},
 {name:'OpenFEMA · FEMA regions API',url:'https://www.fema.gov/api/open/v2/FemaRegions',group:'Data'},
 {name:'OpenFEMA · data documentation',url:'https://www.fema.gov/about/openfema/data-sets',group:'Data'},
];
export const stateAgencies:Record<string,{name:string;url:string;zone?:string}>={VA:{name:'Virginia Department of Emergency Management',url:'https://www.vdem.virginia.gov/',zone:'https://va-know-your-zone-vdemgis.hub.arcgis.com/'},NC:{name:'North Carolina Emergency Management',url:'https://www.ncdps.gov/our-organization/emergency-management'},FL:{name:'Florida Division of Emergency Management',url:'https://www.floridadisaster.org/'},CA:{name:'California Governor’s Office of Emergency Services',url:'https://www.caloes.ca.gov/'},TX:{name:'Texas Division of Emergency Management',url:'https://tdem.texas.gov/'},NY:{name:'New York Homeland Security and Emergency Services',url:'https://www.dhses.ny.gov/'}};
export function stateAgency(state:string){return stateAgencies[state]||{name:'USA.gov · state emergency agencies',url:'https://www.usa.gov/state-emergency-management'};}

/** @deprecated use communityLookup */
export const vetLookup=communityLookup;
