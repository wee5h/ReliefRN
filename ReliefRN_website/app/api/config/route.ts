import {json,setting} from '@/lib/server';
import {health} from '@/lib/foundry';

// aiConfigured is true only when the agent bridge is running and signed in,
// so the site never labels itself "live" while it is really answering from rules.
export async function GET(){
 const h=await health(true);
 return json({
  aiConfigured:h.ok,
  agentMode:h.ok?h.mode:'guided',
  agents:h.ok?(h.agents||[]):[],
  agentDetail:h.ok?'':(h.mode==='offline'?'Agent bridge is not running':(h.detail||'Agent bridge is not signed in')),
  callbackConfigured:!!(setting('HANDOFF_WEBHOOK_URL')&&setting('HANDOFF_WEBHOOK_TOKEN')),
  voiceNumber:setting('SUPPORT_VOICE_NUMBER')||'',
  smsNumber:setting('SUPPORT_SMS_NUMBER')||''
 });
}
