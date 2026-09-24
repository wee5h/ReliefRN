import {translations,type Language} from './i18n';
export type Message = {role:'user'|'assistant';content:string;sources?:{title:string;url:string}[];escalate?:boolean;mode?:string;agents?:string[]};
export function sensitive(text:string){return /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b|\b(?:\d[ -]?){13,19}\b|(?:ssn|social security|bank account|routing number|verification code|one.time code|passport number|आधार|खाता संख्या|código de verificación|número de cuenta)\s*(?:is|es|है|:|=)?\s*\d/i.test(text);}
export function urgent(text:string){return /\b(can'?t breathe|cannot breathe|chest pain|unconscious|trapped|drowning|suicid\w*|kill myself|immediate danger|severe bleeding|house is on fire|fire in my house|gas leak)\b|no puedo respirar|atrapad[oa]|sangrado grave|peligro inmediato|सांस नहीं|फँस|फंस|तुरंत खतरा|आत्महत्या|गैस लीक/i.test(text);}
export function highImpact(text:string){return /appeal|denied|immigra|citizenship|eviction|legal|abuse|human|representative|person|medical|pregnan|insulin|oxygen|medication|dementia|disab|accessib|discrimin|disputed|fraud|scam|no id|lost.*(id|document)|apelaci|deneg|persona|médic|medicamento|fraude|discap|दवा|इंसान|व्यक्ति|नागरिकता|धोख|दस्तावेज़|विकलांग|ऑक्सीजन/i.test(text);}
export function guidedAnswer(message:string,language:Language='en'):Message{
 const t=translations[language];const text=message.toLowerCase();let content=t.assistantIntro,sources=[{title:'DisasterAssistance.gov',url:'https://www.disasterassistance.gov/'}];
 if(urgent(text))return {role:'assistant',content:t.urgentMessage,escalate:true,mode:'urgent',sources:[]};
 if(sensitive(text))return {role:'assistant',content:t.sensitive,mode:'privacy',sources:[]};
 if(/scam|fraud|fee|pay.*fema|fraude|estafa|धोख|शुल्क/i.test(text)){content=t.fraudText;sources=[{title:'FEMA · disaster fraud',url:'https://www.fema.gov/assistance/individual/disaster-fraud'}];}
 else if(/lost|document|identification|\bid\b|perd|दस्तावेज़|पहचान/i.test(text)){content=t.lostDocsText+'\n\n'+t.localText;sources=[{title:'USA.gov · FEMA assistance',url:'https://www.usa.gov/disaster-assistance'},{title:'211',url:'https://www.211.org/'}];}
 else if(/shelter|safe place|home|refugio|alojamiento|आश्रय|सुरक्षित|घर/i.test(text)){content=t.localText+'\n\n'+t.shelterNote+' '+t.callFirst+'.';sources=[{title:'American Red Cross · find a shelter',url:'https://www.redcross.org/get-help/disaster-relief-and-recovery-services/find-an-open-shelter.html'},{title:'211',url:'https://www.211.org/'}];}
 else if(/evac|transport|zone|निकासी|परिवहन/i.test(text)){content=t.zonesNote+'\n\n'+t.noExact+' '+t.mobilityTip;sources=[{title:'Ready.gov · evacuation',url:'https://www.ready.gov/evacuation'},{title:'USA.gov · state emergency agencies',url:'https://www.usa.gov/state-emergency-management'}];}
 else if(/medical|medic|access|disab|mobility|oxygen|médic|silla|चिकित्सा|सुलभता|दवा/i.test(text)){content=t.medicationsTip+'\n\n'+t.mobilityTip+' '+t.humanEscalation;sources=[{title:'Ready.gov · disability',url:'https://www.ready.gov/disability'}];}
 else if(/pet|dog|cat|mascota|पालतू/i.test(text)){content=t.vetNote+'\n\n'+t.callFirst+'.';sources=[{title:'Ready.gov · pets',url:'https://www.ready.gov/pets'}];}
 else if(/food|water|essential|comida|alimento|भोजन|पानी|सामान/i.test(text)){content=t.localText+'\n\n'+t.localWhy;sources=[{title:'211',url:'https://www.211.org/'},{title:'USA.gov · disaster help',url:'https://www.usa.gov/disasters-and-emergencies'}];}
 else if(/fema|money|financ|cost|qualif|eligible|rent|apply|ayuda|costo|dinero|आवेदन|खर्च|पात्र|पैस/i.test(text)){content=t.federalText+'\n\n'+t.noGuarantee;sources=[{title:'USA.gov · disaster assistance',url:'https://www.usa.gov/disaster-assistance'},{title:'DisasterAssistance.gov',url:'https://www.disasterassistance.gov/'}];}
 else {content=t.noAi+'\n\n'+t.need+' '+t.safePlace+', '+t.food+', '+t.medical+', '+t.financial+'?';}
 return {role:'assistant',content,sources,mode:'guided',escalate:highImpact(text)};
}
export function safeUrl(value:string){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.toString():null;}catch{return null;}}
