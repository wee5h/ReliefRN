import {json,fetchJson,validPoint,geocode} from '@/lib/server';
import {nearest,seedFor,miles,type Place,type Area,type Kind} from '@/lib/resources';
import managers from '@/lib/va-managers.json';

const UA='ReliefRN-DisasterNavigator/1.0 (hackathon prototype; local resource lookup)';
const mapLink=(lat:number,lng:number)=>`https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;
const title=(s:string)=>s&&s===s.toUpperCase()?s.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()):s;

// USGS National Map structures: nationwide, government-maintained, and
// reliable. The primary source for hospitals and emergency responders.
const USGS='https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer';
const USGS_LAYERS:[number,Kind][]=[[49,'hospital'],[50,'responder'],[51,'responder'],[53,'responder']];
async function usgs(area:Area):Promise<Place[]>{
 const params=new URLSearchParams({f:'json',where:'1=1',geometry:`${area.lng},${area.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:'25',units:'esriSRUnit_StatuteMile',outFields:'NAME,ADDRESS,CITY,STATE,ZIPCODE',outSR:'4326',returnGeometry:'true',resultRecordCount:'40'});
 const layers=await Promise.allSettled(USGS_LAYERS.map(([id])=>fetchJson(`${USGS}/${id}/query?${params}`,{},10000)));
 const out:Place[]=[];
 layers.forEach((r,i)=>{if(r.status!=='fulfilled'||!Array.isArray(r.value.features))return;const [id,kind]=USGS_LAYERS[i];
  for(const f of r.value.features){const a=f.attributes||{},lat=f.geometry?.y,lng=f.geometry?.x,name=a.NAME||a.name;if(!name||!Number.isFinite(lat)||!Number.isFinite(lng))continue;
   out.push({id:`usgs-${id}-${a.OBJECTID||name}-${lat.toFixed(4)}`,kind,name:title(name),address:[title(a.ADDRESS||a.address||''),title(a.CITY||a.city||''),a.STATE||a.state,a.ZIPCODE||a.zipcode].filter(Boolean).join(', '),lat,lng,url:mapLink(lat,lng),source:'official',note:'USGS National Map'});}});
 if(!out.length&&layers.every(r=>r.status==='rejected'))throw new Error('USGS unavailable');
 return out;
}

// FEMA Disaster Recovery Centers currently open (only during declared disasters).
async function recoveryCenters(area:Area):Promise<Place[]>{
 const params=new URLSearchParams({f:'json',where:'1=1',geometry:`${area.lng},${area.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:'80',units:'esriSRUnit_Kilometer',outFields:'drc_name,street_1,city,state,zip,hours,days_open,status,planned_close_date',outSR:'4326',returnGeometry:'true'});
 const d=await fetchJson('https://gis.fema.gov/arcgis/rest/services/FEMA/DRC/FeatureServer/0/query?'+params,{},10000);
 if(d.error||!Array.isArray(d.features))throw new Error();
 return d.features.map((x:any)=>{const a=x.attributes;const hours=[a.days_open,a.hours].filter(Boolean).join(' · ');
  return {id:`drc-${a.drc_name}-${a.zip}`,kind:'drc',name:title(a.drc_name||'Disaster Recovery Center'),address:[title(a.street_1||''),title(a.city||''),a.state,a.zip].filter(Boolean).join(', '),lat:x.geometry?.y,lng:x.geometry?.x,url:'https://egateway.fema.gov/ESF6/DRCLocator',source:'official',reportedOpen:String(a.status||'').toLowerCase()==='open',note:hours?`Hours: ${hours}`:'FEMA Disaster Recovery Center'} as Place;});
}

// Veterinary clinics come from OpenStreetMap, fetched by the browser instead
// (see lib/resources.ts vetLookup). From the local Worker, public Overpass
// servers hang, and every resource lookup would wait on them.

async function shelters(area:Area):Promise<Place[]>{const params=new URLSearchParams({f:'json',where:'1=1',geometry:`${area.lng},${area.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',distance:'80',units:'esriSRUnit_Kilometer',outFields:'shelter_id,shelter_name,address_1,city,state,zip,org_main_phone,shelter_status_code,reporting_period',outSR:'4326',returnGeometry:'true'});const base='https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/FeatureServer/0';const d=await fetchJson(base+'/query?'+params,{},10000);if(d.error||!Array.isArray(d.features))throw new Error();return d.features.map((x:any)=>{const a=x.attributes;return {id:`fema-${a.shelter_id}`,kind:'shelter',name:a.shelter_name,address:[a.address_1,a.city,a.state,a.zip].filter(Boolean).join(', '),lat:x.geometry?.y,lng:x.geometry?.x,phone:a.org_main_phone||undefined,url:base,source:'official',reportedOpen:a.shelter_status_code==='OPEN',note:a.reporting_period?`FEMA reporting period: ${a.reporting_period}`:undefined};});}

async function manager(area:Area):Promise<Place[]>{if(area.state!=='VA')return [];const local=(area.locality||area.label.split(',')[0]).replace(/\s+(city|county)$/i,'').trim().toLowerCase();const m=managers.find(x=>x.locality.replace(/\s+(city|county)$/i,'').trim().toLowerCase()===local);if(!m||!m.address)return [];const g=await geocode(m.address);if(!g[0])return [];return [{id:'manager-'+m.locality,kind:'manager',name:m.name?`${m.name} · ${m.title}`:`${m.locality} Emergency Management`,address:m.address,lat:g[0].lat,lng:g[0].lng,phone:m.phone||undefined,email:m.email||undefined,url:'https://lemd.vdem.virginia.gov/public/',source:'official'}];}

export async function GET(request:Request){const p=new URL(request.url).searchParams,lat=Number(p.get('lat')),lng=Number(p.get('lng'));if(!p.has('lat')||!p.has('lng')||!validPoint(lat,lng))return json({error:'Invalid location'},400);const area:Area={lat,lng,label:(p.get('label')||'').slice(0,120),state:(p.get('state')||'').slice(0,2),locality:(p.get('locality')||'').slice(0,80)};const base=seedFor(area);
 // Order matters: earlier sources win when two listings are the same place.
 const sources=[usgs(area),recoveryCenters(area),shelters(area),base.some(p=>p.kind==='manager')?Promise.resolve([]):manager(area)];
 const results=await Promise.allSettled([...sources,fetchJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`,{headers:{'Accept':'application/geo+json','User-Agent':UA}},11000)]);
 let places:Place[]=[...base];for(let i=0;i<sources.length;i++){const r=results[i];if(r.status==='fulfilled'){for(const place of r.value as Place[]){if(!Number.isFinite(place.lat)||!Number.isFinite(place.lng))continue;if(!places.some(p=>p.kind===place.kind&&(miles(p,place)<0.12||p.name.toLowerCase()===place.name.toLowerCase())))places.push(place);}}}
 const alerts=results[sources.length].status==='fulfilled'&&Array.isArray((results[sources.length] as PromiseFulfilledResult<any>).value.features)?(results[sources.length] as PromiseFulfilledResult<any>).value.features.map((f:any)=>({id:f.id,...f.properties})):null;
 // "partial" means a core source failed.
 const partial=results.slice(0,3).some(r=>r.status==='rejected');
 return json({places:nearest(places,area),alerts,checkedAt:new Date().toISOString(),partial,scope:'nearest among available directory listings',radiusMiles:50});
}
