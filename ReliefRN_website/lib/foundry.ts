// ReliefRN website ⇄ ReliefRN live agents.
//
// The website runs as a Worker, which cannot use `az login` or a browser sign-in,
// so it talks to the local agent bridge (agent-bridge/bridge.py). The bridge
// holds the Azure credential and calls the three Foundry agents by name:
// Assistance-agent, Safety-EscalationAgent and WriteUp-agent.
//
// This replaces the earlier classic `asst_…` Threads/Runs adapter, which
// could not reach agents that are addressed by name.
import {setting} from './server';
import {safeUrl,type Message} from './safety';

const DEFAULT_BRIDGE = 'http://127.0.0.1:8765';

function bridge(){
  const raw = (setting('AGENT_BRIDGE_URL') || DEFAULT_BRIDGE).replace(/\/$/, '');
  const u = new URL(raw);
  if (!['http:','https:'].includes(u.protocol)) throw new Error('Invalid agent bridge URL');
  return raw;
}

async function call(path:string, init:RequestInit = {}, timeout = 15000){
  const headers:Record<string,string> = {'Content-Type':'application/json'};
  const token = setting('AGENT_BRIDGE_TOKEN');
  if (token) headers['X-Bridge-Token'] = token;
  const res = await fetch(bridge() + path, {...init, headers:{...headers, ...(init.headers as Record<string,string>|undefined)}, signal:AbortSignal.timeout(timeout)});
  const body:any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Agent bridge ${res.status}`);
  return body;
}

export type BridgeHealth = {ok:boolean;mode:'live'|'mock'|'offline';auth?:string;detail?:string;agents?:string[]};
let healthCache:{value:BridgeHealth;at:number}|undefined;

// Live only when the bridge is running AND signed in to Azure. A few seconds
// of caching keeps the chat route fast without hiding a bridge that stopped.
export async function health(force = false):Promise<BridgeHealth>{
  if (!force && healthCache && Date.now() - healthCache.at < 5000) return healthCache.value;
  let value:BridgeHealth;
  try { value = await call('/health', {}, 2500); }
  catch (e) { value = {ok:false, mode:'offline', detail:e instanceof Error ? e.message : 'unreachable'}; }
  healthCache = {value, at:Date.now()};
  return value;
}

export async function available(){ return (await health()).ok; }

const RUN_ID = /^[A-Za-z0-9_-]{20,64}$/;

export async function start(messages:Message[], language:string, area:string, summary = false, review = false){
  const d = await call('/runs', {method:'POST', body:JSON.stringify({
    kind: summary ? 'summary' : 'chat',
    messages: messages.map(m => ({role:m.role, content:m.content})),
    language, area, review,
  })});
  if (typeof d.id !== 'string' || !RUN_ID.test(d.id)) throw new Error('Agent bridge returned no run id');
  return d.id as string;
}

export async function poll(token:string){
  if (!RUN_ID.test(token)) throw new Error('Invalid run');
  const d = await call('/runs/' + token);
  if (d.status === 'completed' && d.message) {
    const m = d.message;
    const sources = (Array.isArray(m.sources) ? m.sources : [])
      .filter((s:any) => s && typeof s.url === 'string' && safeUrl(s.url))
      .slice(0, 8)
      .map((s:any) => ({title:String(s.title || new URL(s.url).hostname).slice(0, 120), url:s.url}));
    const message:Message = {
      role:'assistant',
      content:String(m.content || '').slice(0, 16000),
      sources,
      mode:m.mode === 'mock' ? 'mock' : 'foundry',
      escalate:!!m.escalate,
      agents:(Array.isArray(m.agents) ? m.agents : []).map((a:any) => String(a).slice(0, 80)).slice(0, 8),
    };
    return {status:'completed', message, delegations:message.agents};
  }
  if (d.status === 'failed') return {status:'failed'};
  return {status:'pending'};
}

// Neural read-aloud audio (MP3) for languages the browser has no voice for.
export async function speak(text:string, language:string){
  const headers:Record<string,string> = {'Content-Type':'application/json'};
  const token = setting('AGENT_BRIDGE_TOKEN');
  if (token) headers['X-Bridge-Token'] = token;
  const res = await fetch(bridge() + '/tts', {method:'POST', headers, body:JSON.stringify({text, language}), signal:AbortSignal.timeout(50000)});
  if (!res.ok || !(res.headers.get('Content-Type') || '').startsWith('audio/')) throw new Error(`Agent bridge ${res.status}`);
  return res.arrayBuffer();
}

export async function cancel(token:string){
  if (!RUN_ID.test(token)) return;
  await call('/runs/' + token, {method:'DELETE'}).catch(() => {});
}
