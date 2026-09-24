import {json,fetchJson} from '@/lib/server';
export async function GET(request:Request){const state=new URL(request.url).searchParams.get('state')||'VA';if(!/^[A-Z]{2}$/.test(state))return json({error:'Invalid state'},400);
 const results=await Promise.allSettled([
 fetchJson('https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?'+new URLSearchParams({'$filter':`state eq '${state}'`,'$orderby':'declarationDate desc','$top':'60','$select':'disasterNumber,declarationTitle,declarationDate,incidentType,designatedArea,ihProgramDeclared,iaProgramDeclared'})),
 fetchJson('https://www.fema.gov/api/open/v2/FemaRegions?'+new URLSearchParams({'$top':'20','$select':'name,region,address,city,state,zipCode,states'})),
 fetchJson('https://www.fema.gov/api/open/v1/DataSets?'+new URLSearchParams({'$top':'5'}))]);
 const declarations=results[0].status==='fulfilled'?results[0].value.DisasterDeclarationsSummaries||[]:[];const unique=Array.from(new Map(declarations.map((x:any)=>[x.disasterNumber,x])).values()).slice(0,4);
 const regions=results[1].status==='fulfilled'?results[1].value.FemaRegions||[]:[];
 return json({declarations:unique,region:regions.find((r:any)=>(Array.isArray(r.states)?r.states:[]).includes(state))||null,catalogAvailable:results[2].status==='fulfilled',checkedAt:new Date().toISOString()});
}
