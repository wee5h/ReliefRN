// "Find assistance": which official programs fit the situation someone ticks.
//
// Each program lists the situations it is meant for. Results are ranked by how
// many of the person's answers they match, and every card says which answers
// it matched, so nothing is recommended without a visible reason. Links and
// phone numbers are the programs' own official pages, checked 2026-09-25.
// These are possible options, never eligibility decisions.
import type {Language} from './i18n';

export type Situation='renter'|'owner'|'displaced'|'lostId'|'accessNeeds'|'noTransport'|'hasPet';
export type AidIcon='phone'|'fema'|'home'|'repair'|'loan'|'flood'|'shelter'|'center'|'document'|'legal'|'access'|'medicine'|'transport'|'pet'|'heart'|'state';
export type Aid={id:string;icon:AidIcon;for:Situation[]|'always';rank:number;url:string;phone?:string;action:'apply'|'learnMore'};

export const aidCatalog:Aid[]=[
 {id:'fema',icon:'fema',for:['renter','owner','displaced','lostId'],rank:10,url:'https://www.disasterassistance.gov/',phone:'1-800-621-3362',action:'apply'},
 {id:'housing',icon:'home',for:['renter','displaced'],rank:9,url:'https://www.fema.gov/assistance/individual/housing',action:'learnMore'},
 {id:'redcross',icon:'shelter',for:['displaced'],rank:9,url:'https://www.redcross.org/get-help/disaster-relief-and-recovery-services/find-an-open-shelter.html',phone:'1-800-733-2767',action:'learnMore'},
 {id:'repair',icon:'repair',for:['owner'],rank:8,url:'https://www.fema.gov/assistance/individual/housing',action:'learnMore'},
 {id:'disability',icon:'access',for:['accessNeeds'],rank:9,url:'https://disasterstrategies.org/hotline/',phone:'1-800-626-4959',action:'learnMore'},
 {id:'medicine',icon:'medicine',for:['accessNeeds'],rank:7,url:'https://aspr.hhs.gov/EPAP/Pages/default.aspx',phone:'1-855-793-7470',action:'learnMore'},
 {id:'documents',icon:'document',for:['lostId'],rank:9,url:'https://www.usa.gov/replace-vital-documents',action:'learnMore'},
 {id:'drc',icon:'center',for:['displaced','lostId','accessNeeds'],rank:7,url:'https://egateway.fema.gov/ESF6/DRCLocator',action:'learnMore'},
 {id:'sba',icon:'loan',for:['owner','renter'],rank:6,url:'https://www.sba.gov/funding-programs/disaster-assistance',phone:'1-800-659-2955',action:'apply'},
 {id:'flood',icon:'flood',for:['owner','renter'],rank:5,url:'https://www.floodsmart.gov/start',action:'learnMore'},
 {id:'legal',icon:'legal',for:['renter','owner','lostId'],rank:5,url:'https://www.americanbar.org/groups/young_lawyers/about/initiatives/disaster-legal-services/',action:'learnMore'},
 {id:'transport',icon:'transport',for:['noTransport'],rank:9,url:'https://www.ready.gov/evacuation',phone:'211',action:'learnMore'},
 {id:'pets',icon:'pet',for:['hasPet'],rank:8,url:'https://www.ready.gov/pets',action:'learnMore'},
 {id:'counseling',icon:'heart',for:['displaced'],rank:4,url:'https://www.samhsa.gov/find-help/helplines/disaster-distress-helpline',phone:'1-800-985-5990',action:'learnMore'},
 // For everyone, after the matched programs.
 {id:'call211',icon:'phone',for:'always',rank:2,url:'https://www.211.org/',phone:'211',action:'learnMore'},
 {id:'state',icon:'state',for:'always',rank:1,url:'',action:'learnMore'},
];

export type AidMatch={aid:Aid;matched:Situation[]};

// With nothing ticked, show a sensible general starting set.
const GENERAL=['fema','redcross','call211','state'];

export function matchAid(selected:string[]):AidMatch[]{
 const picked=selected as Situation[];
 if(!picked.length)return aidCatalog.filter(a=>GENERAL.includes(a.id)).map(aid=>({aid,matched:[]}));
 const hits=aidCatalog.filter(a=>a.for!=='always').map(aid=>({aid,matched:picked.filter(s=>(aid.for as Situation[]).includes(s))}))
  .filter(m=>m.matched.length).sort((a,b)=>b.matched.length-a.matched.length||b.aid.rank-a.aid.rank);
 return [...hits,...aidCatalog.filter(a=>a.for==='always').map(aid=>({aid,matched:[] as Situation[]}))];
}

type T=[title:string,description:string];
const en:Record<string,T>={
 fema:['FEMA disaster assistance','Apply for federal help after a declared disaster: a safe place to stay, home repairs and other disaster costs. Applying is free.'],
 housing:['Rent and temporary housing help','FEMA can help pay for somewhere to stay while you cannot live at home, including rent and hotel costs.'],
 redcross:['Red Cross shelter and emergency help','Find an open shelter, meals and emergency supplies. Shelters are free, and service animals are always welcome.'],
 repair:['Home repair help','FEMA can help make a home you own and live in safe to live in again, when insurance does not cover the damage.'],
 disability:['Disability & Disaster Hotline','Disability-led help around the clock with accessible shelter, equipment, benefits and access barriers. Call, text or email.'],
 medicine:['Replace prescriptions and medical equipment','If you have no insurance, this federal program can cover medicines and some medical equipment lost in a disaster, when it is active for your disaster.'],
 documents:['Replace lost documents','Step-by-step help replacing Social Security cards, birth certificates, IDs and other vital records.'],
 drc:['Disaster Recovery Center (in person)','Talk face to face with FEMA, SBA and state staff about applications, missing documents and accessibility needs.'],
 sba:['Low-interest disaster loans (SBA)','Homeowners can borrow to repair or rebuild. Renters and homeowners can borrow to replace belongings such as furniture, clothes and cars.'],
 flood:['Flood insurance claim','If you have flood insurance, including renters’ contents cover, start your claim early and photograph the damage first.'],
 legal:['Free disaster legal help','Volunteer lawyers help with landlord problems, insurance claims, contractors and replacing legal documents, if you cannot afford a lawyer.'],
 transport:['Transport to safety and services','211 and your local emergency office can arrange rides to shelters and recovery centers. Ask about evacuation help before you need it.'],
 pets:['Help for your pet','Ask 211 for shelters that accept pets. Bring food, medicine, vaccination records and a carrier or leash.'],
 counseling:['Talk to a crisis counselor','Free, confidential support for stress after a disaster, by call or text, 24/7 and in many languages.'],
 call211:['211 local help','A free, confidential line to shelters, food, transport and recovery programs near you.'],
 state:['Your state emergency agency','Official alerts, evacuation orders and state recovery programs for {state}.'],
};
const es:Record<string,T>={
 fema:['Asistencia de FEMA por desastre','Solicita ayuda federal tras un desastre declarado: un lugar seguro donde quedarte, reparaciones y otros gastos. Solicitar es gratis.'],
 housing:['Ayuda con alquiler y vivienda temporal','FEMA puede ayudarte a pagar dónde quedarte mientras no puedes vivir en casa, incluido el alquiler y el hotel.'],
 redcross:['Refugio y ayuda de emergencia de la Cruz Roja','Encuentra un refugio abierto, comidas y suministros de emergencia. Los refugios son gratuitos y siempre aceptan animales de servicio.'],
 repair:['Ayuda para reparar tu vivienda','FEMA puede ayudar a que la casa que es tuya y donde vives vuelva a ser segura cuando el seguro no cubre el daño.'],
 disability:['Línea de Discapacidad y Desastres','Ayuda dirigida por personas con discapacidad, a toda hora, con refugios accesibles, equipos, beneficios y barreras de acceso. Llama, escribe o envía un correo.'],
 medicine:['Reponer medicamentos y equipo médico','Si no tienes seguro, este programa federal puede cubrir medicamentos y algún equipo médico perdido en un desastre, cuando está activo para tu desastre.'],
 documents:['Reponer documentos perdidos','Ayuda paso a paso para reponer la tarjeta del Seguro Social, actas de nacimiento, identificaciones y otros documentos.'],
 drc:['Centro de Recuperación por Desastre (en persona)','Habla en persona con personal de FEMA, la SBA y el estado sobre solicitudes, documentos perdidos y necesidades de accesibilidad.'],
 sba:['Préstamos por desastre a bajo interés (SBA)','Los propietarios pueden pedir un préstamo para reparar o reconstruir. Inquilinos y propietarios pueden reponer muebles, ropa y autos.'],
 flood:['Reclamo del seguro de inundación','Si tienes seguro de inundación, incluida la cobertura de bienes para inquilinos, inicia tu reclamo pronto y fotografía primero el daño.'],
 legal:['Ayuda legal gratuita por desastre','Abogados voluntarios ayudan con problemas con el arrendador, reclamos de seguro, contratistas y documentos legales, si no puedes pagar un abogado.'],
 transport:['Transporte a un lugar seguro y a servicios','El 211 y tu oficina local de emergencias pueden organizar traslados a refugios y centros de recuperación. Pregunta por ayuda para evacuar antes de necesitarla.'],
 pets:['Ayuda para tu mascota','Pregunta al 211 por refugios que acepten mascotas. Lleva comida, medicinas, su cartilla de vacunas y un transportín o correa.'],
 counseling:['Habla con un consejero de crisis','Apoyo gratuito y confidencial para el estrés tras un desastre, por llamada o texto, 24/7 y en muchos idiomas.'],
 call211:['211 ayuda local','Una línea gratuita y confidencial para encontrar refugios, comida, transporte y programas de recuperación cerca de ti.'],
 state:['Agencia de emergencias de tu estado','Alertas oficiales, órdenes de evacuación y programas estatales de recuperación para {state}.'],
};
const zh:Record<string,T>={
 fema:['FEMA 灾害援助','在已宣布的灾害后申请联邦援助：安全住处、房屋维修及其他灾害费用。申请免费。'],
 housing:['租房与临时住房援助','在您无法住在家中期间，FEMA 可帮助支付住处费用，包括房租和酒店费用。'],
 redcross:['红十字会避难所与紧急援助','查找开放的避难所、餐食和应急物资。避难所免费，服务动物始终可以进入。'],
 repair:['房屋维修援助','如果保险不赔付，FEMA 可帮助您自有并居住的房屋恢复到可安全居住的状态。'],
 disability:['残障与灾害热线','由残障人士主导的全天候帮助，涉及无障碍避难所、设备、福利和各类障碍。可致电、发短信或发邮件。'],
 medicine:['补领处方药和医疗设备','如果您没有保险，在该项目为您的灾害启动时，这个联邦项目可承担灾害中丢失的药品和部分医疗设备。'],
 documents:['补办丢失的证件','逐步指导您补办社会安全卡、出生证明、身份证件及其他重要证件。'],
 drc:['灾后恢复中心（现场）','与 FEMA、SBA 和州政府工作人员当面沟通申请、证件丢失和无障碍需求。'],
 sba:['低息灾害贷款（SBA）','房主可借款修复或重建房屋。租户和房主可借款补置家具、衣物和汽车等财物。'],
 flood:['洪水保险理赔','如果您有洪水保险（包括租户财物保险），请尽早提出理赔，并先拍下损坏情况。'],
 legal:['免费灾害法律援助','如果您请不起律师，志愿律师可帮助处理房东纠纷、保险理赔、承包商问题和法律文件补办。'],
 transport:['前往安全地点和服务的交通','211 和当地应急管理部门可安排前往避难所和恢复中心的交通。请提前询问撤离协助。'],
 pets:['宠物援助','向 211 询问可携带宠物的避难所。带上食物、药品、疫苗记录以及宠物箱或牵引绳。'],
 counseling:['与危机咨询员交谈','为灾后压力提供免费、保密的支持，可致电或发短信，全天候，多种语言。'],
 call211:['211 本地求助','免费、保密的热线，帮您找到附近的避难所、食物、交通和恢复项目。'],
 state:['您所在州的应急管理机构','{state} 的官方警报、疏散令和州恢复项目。'],
};
const vi:Record<string,T>={
 fema:['Hỗ trợ thiên tai của FEMA','Nộp đơn xin hỗ trợ liên bang sau thiên tai đã được công bố: chỗ ở an toàn, sửa nhà và các chi phí khác. Nộp đơn miễn phí.'],
 housing:['Hỗ trợ tiền thuê và nhà ở tạm thời','FEMA có thể giúp trả tiền chỗ ở khi bạn không thể ở nhà, gồm tiền thuê nhà và khách sạn.'],
 redcross:['Nơi trú ẩn và trợ giúp khẩn cấp của Hội Chữ thập đỏ','Tìm nơi trú ẩn đang mở, bữa ăn và đồ dùng khẩn cấp. Nơi trú ẩn miễn phí và luôn nhận động vật phục vụ.'],
 repair:['Hỗ trợ sửa nhà','FEMA có thể giúp căn nhà bạn sở hữu và đang ở trở lại an toàn khi bảo hiểm không chi trả thiệt hại.'],
 disability:['Đường dây Khuyết tật & Thiên tai','Trợ giúp do người khuyết tật điều hành, suốt ngày đêm, về nơi trú ẩn dễ tiếp cận, thiết bị, phúc lợi và rào cản tiếp cận. Gọi, nhắn tin hoặc email.'],
 medicine:['Thay thế thuốc và thiết bị y tế','Nếu bạn không có bảo hiểm, chương trình liên bang này có thể chi trả thuốc và một số thiết bị y tế bị mất trong thiên tai, khi được kích hoạt cho thiên tai của bạn.'],
 documents:['Làm lại giấy tờ bị mất','Hướng dẫn từng bước làm lại thẻ An sinh Xã hội, giấy khai sinh, giấy tờ tùy thân và các giấy tờ quan trọng khác.'],
 drc:['Trung tâm Phục hồi sau Thiên tai (trực tiếp)','Gặp trực tiếp nhân viên FEMA, SBA và tiểu bang về đơn xin, giấy tờ bị mất và nhu cầu trợ năng.'],
 sba:['Khoản vay thiên tai lãi suất thấp (SBA)','Chủ nhà có thể vay để sửa hoặc xây lại nhà. Người thuê và chủ nhà có thể vay để mua lại đồ đạc, quần áo và xe.'],
 flood:['Yêu cầu bồi thường bảo hiểm lũ lụt','Nếu bạn có bảo hiểm lũ lụt, kể cả bảo hiểm tài sản cho người thuê nhà, hãy nộp yêu cầu sớm và chụp ảnh thiệt hại trước.'],
 legal:['Trợ giúp pháp lý miễn phí sau thiên tai','Luật sư tình nguyện giúp về tranh chấp với chủ nhà, bồi thường bảo hiểm, nhà thầu và giấy tờ pháp lý, nếu bạn không đủ tiền thuê luật sư.'],
 transport:['Phương tiện đến nơi an toàn và dịch vụ','211 và văn phòng khẩn cấp địa phương có thể sắp xếp xe đến nơi trú ẩn và trung tâm phục hồi. Hãy hỏi về hỗ trợ sơ tán trước khi cần.'],
 pets:['Trợ giúp cho thú cưng','Hỏi 211 về nơi trú ẩn nhận thú cưng. Mang theo thức ăn, thuốc, hồ sơ tiêm phòng và lồng hoặc dây xích.'],
 counseling:['Nói chuyện với chuyên viên tư vấn khủng hoảng','Hỗ trợ miễn phí, bảo mật cho căng thẳng sau thiên tai, qua điện thoại hoặc tin nhắn, 24/7, nhiều ngôn ngữ.'],
 call211:['211 trợ giúp địa phương','Đường dây miễn phí, bảo mật để tìm nơi trú ẩn, thực phẩm, phương tiện và chương trình phục hồi gần bạn.'],
 state:['Cơ quan khẩn cấp của tiểu bang','Cảnh báo chính thức, lệnh sơ tán và chương trình phục hồi của tiểu bang {state}.'],
};
const ar:Record<string,T>={
 fema:['مساعدات FEMA في الكوارث','قدّم طلبًا للحصول على مساعدة اتحادية بعد كارثة معلنة: مكان آمن للإقامة وإصلاح المنزل وتكاليف أخرى. التقديم مجاني.'],
 housing:['المساعدة في الإيجار والسكن المؤقت','يمكن أن تساعد FEMA في دفع تكاليف مكان للإقامة ما دمت لا تستطيع العيش في منزلك، بما في ذلك الإيجار والفندق.'],
 redcross:['ملاجئ الصليب الأحمر والمساعدة الطارئة','ابحث عن ملجأ مفتوح ووجبات ولوازم طارئة. الملاجئ مجانية وتستقبل حيوانات الخدمة دائمًا.'],
 repair:['المساعدة في إصلاح المنزل','يمكن أن تساعد FEMA في جعل المنزل الذي تملكه وتسكنه آمنًا للسكن مجددًا عندما لا يغطي التأمين الضرر.'],
 disability:['الخط الساخن للإعاقة والكوارث','مساعدة يقودها أشخاص من ذوي الإعاقة على مدار الساعة بشأن الملاجئ الميسّرة والمعدات والمزايا وعوائق الوصول. اتصل أو راسل أو أرسل بريدًا إلكترونيًا.'],
 medicine:['تعويض الأدوية والمعدات الطبية','إذا لم يكن لديك تأمين، يمكن لهذا البرنامج الاتحادي تغطية الأدوية وبعض المعدات الطبية المفقودة في الكارثة، عند تفعيله لكارثتك.'],
 documents:['استبدال الوثائق المفقودة','مساعدة خطوة بخطوة لاستبدال بطاقة الضمان الاجتماعي وشهادة الميلاد والهوية والوثائق المهمة الأخرى.'],
 drc:['مركز التعافي من الكوارث (حضوريًا)','تحدّث وجهًا لوجه مع موظفي FEMA وSBA والولاية بشأن الطلبات والوثائق المفقودة واحتياجات الوصول.'],
 sba:['قروض الكوارث منخفضة الفائدة (SBA)','يمكن لأصحاب المنازل الاقتراض للإصلاح أو إعادة البناء. ويمكن للمستأجرين والملاك الاقتراض لاستبدال الأثاث والملابس والسيارات.'],
 flood:['مطالبة تأمين الفيضانات','إذا كان لديك تأمين ضد الفيضانات، بما في ذلك تغطية ممتلكات المستأجرين، قدّم مطالبتك مبكرًا وصوّر الضرر أولًا.'],
 legal:['مساعدة قانونية مجانية في الكوارث','يساعد محامون متطوعون في مشكلات المؤجر ومطالبات التأمين والمقاولين والوثائق القانونية، إذا لم تكن قادرًا على تحمّل أتعاب محامٍ.'],
 transport:['التنقل إلى أماكن آمنة وإلى الخدمات','يمكن لخط 211 ومكتب الطوارئ المحلي ترتيب وسيلة نقل إلى الملاجئ ومراكز التعافي. اسأل عن مساعدة الإخلاء قبل أن تحتاجها.'],
 pets:['مساعدة لحيوانك الأليف','اسأل 211 عن الملاجئ التي تقبل الحيوانات الأليفة. أحضر الطعام والدواء وسجل التطعيمات وقفصًا أو مقودًا.'],
 counseling:['تحدّث إلى مستشار أزمات','دعم مجاني وسري للتوتر بعد الكوارث، عبر الاتصال أو الرسائل النصية، على مدار الساعة وبلغات كثيرة.'],
 call211:['211 للمساعدة المحلية','خط مجاني وسري للوصول إلى الملاجئ والطعام والنقل وبرامج التعافي القريبة منك.'],
 state:['جهة الطوارئ في ولايتك','التنبيهات الرسمية وأوامر الإخلاء وبرامج التعافي في ولاية {state}.'],
};
const ko:Record<string,T>={
 fema:['FEMA 재난 지원','선포된 재난 후 연방 지원을 신청하세요. 안전한 거처, 주택 수리, 기타 재난 비용을 지원합니다. 신청은 무료입니다.'],
 housing:['임대료 및 임시 거처 지원','집에서 지낼 수 없는 동안 임대료와 숙박비 등 머물 곳의 비용을 FEMA가 지원할 수 있습니다.'],
 redcross:['적십자 대피소 및 긴급 지원','운영 중인 대피소, 식사, 긴급 물품을 찾으세요. 대피소는 무료이며 보조견은 언제나 함께할 수 있습니다.'],
 repair:['주택 수리 지원','보험으로 보상되지 않을 때, 본인 소유이며 거주 중인 집을 다시 안전하게 살 수 있도록 FEMA가 지원할 수 있습니다.'],
 disability:['장애 및 재난 핫라인','장애인이 운영하는 24시간 지원으로 접근 가능한 대피소, 장비, 혜택, 접근 장벽을 도와줍니다. 전화, 문자, 이메일로 연락하세요.'],
 medicine:['처방약 및 의료기기 교체','보험이 없다면, 해당 재난에 이 연방 프로그램이 시행 중일 때 재난으로 잃어버린 약과 일부 의료기기를 지원받을 수 있습니다.'],
 documents:['분실한 서류 재발급','사회보장카드, 출생증명서, 신분증 등 중요 서류를 단계별로 재발급하도록 도와줍니다.'],
 drc:['재난 복구 센터(방문)','FEMA, SBA, 주 정부 직원과 직접 만나 신청, 분실 서류, 접근성 필요를 상담하세요.'],
 sba:['저금리 재난 대출(SBA)','주택 소유자는 수리나 재건축을 위해 대출할 수 있습니다. 세입자와 소유자는 가구, 옷, 자동차 등 물품 교체를 위해 대출할 수 있습니다.'],
 flood:['홍수 보험 청구','세입자 동산 보험을 포함해 홍수 보험이 있다면 청구를 빨리 시작하고 먼저 피해 사진을 찍으세요.'],
 legal:['무료 재난 법률 지원','변호사를 선임할 여유가 없다면 자원봉사 변호사가 임대인 문제, 보험 청구, 시공업체, 법률 서류 문제를 도와줍니다.'],
 transport:['안전한 곳과 서비스까지의 이동','211과 지역 재난 관리 사무소가 대피소와 복구 센터까지 이동을 마련해 줄 수 있습니다. 필요하기 전에 대피 지원을 문의하세요.'],
 pets:['반려동물 지원','211에 반려동물을 받는 대피소를 문의하세요. 사료, 약, 예방접종 기록, 이동장이나 목줄을 챙기세요.'],
 counseling:['위기 상담사와 대화하기','재난 후 스트레스에 대한 무료 비밀 상담을 전화나 문자로 24시간, 여러 언어로 받을 수 있습니다.'],
 call211:['211 지역 지원','가까운 대피소, 식량, 교통, 복구 프로그램을 안내하는 무료 비밀 상담 전화입니다.'],
 state:['우리 주 재난 관리 기관','{state}의 공식 경보, 대피 명령, 주 복구 프로그램.'],
};
const ur:Record<string,T>={
 fema:['FEMA کی آفات میں امداد','اعلان شدہ آفت کے بعد وفاقی مدد کے لیے درخواست دیں: رہنے کی محفوظ جگہ، گھر کی مرمت اور دیگر اخراجات۔ درخواست مفت ہے۔'],
 housing:['کرایے اور عارضی رہائش میں مدد','جب تک آپ گھر میں نہیں رہ سکتے، FEMA رہنے کی جگہ کے اخراجات، بشمول کرایہ اور ہوٹل، میں مدد کر سکتا ہے۔'],
 redcross:['ریڈ کراس کی پناہ گاہ اور ہنگامی مدد','کھلی پناہ گاہ، کھانا اور ہنگامی سامان تلاش کریں۔ پناہ گاہیں مفت ہیں اور خدمت والے جانوروں کی ہمیشہ اجازت ہے۔'],
 repair:['گھر کی مرمت میں مدد','جب انشورنس نقصان پورا نہ کرے تو FEMA آپ کی ملکیت اور رہائش والے گھر کو دوبارہ محفوظ بنانے میں مدد کر سکتا ہے۔'],
 disability:['معذوری اور آفات ہاٹ لائن','معذور افراد کی زیرِ قیادت چوبیس گھنٹے مدد: قابلِ رسائی پناہ گاہ، آلات، مراعات اور رسائی کی رکاوٹیں۔ کال، ٹیکسٹ یا ای میل کریں۔'],
 medicine:['دوائیں اور طبی آلات دوبارہ حاصل کریں','اگر آپ کے پاس انشورنس نہیں تو یہ وفاقی پروگرام، آپ کی آفت کے لیے فعال ہونے پر، آفت میں ضائع ہونے والی دوائیں اور کچھ طبی آلات فراہم کر سکتا ہے۔'],
 documents:['گم شدہ دستاویزات دوبارہ بنوائیں','سوشل سیکیورٹی کارڈ، پیدائشی سرٹیفکیٹ، شناختی کارڈ اور دیگر اہم دستاویزات دوبارہ بنوانے کے لیے مرحلہ وار رہنمائی۔'],
 drc:['آفات سے بحالی کا مرکز (بالمشافہ)','درخواستوں، گم شدہ دستاویزات اور رسائی کی ضروریات کے بارے میں FEMA، SBA اور ریاستی عملے سے براہِ راست بات کریں۔'],
 sba:['کم سود پر آفات کے قرض (SBA)','مکان مالکان مرمت یا دوبارہ تعمیر کے لیے قرض لے سکتے ہیں۔ کرایہ دار اور مالکان فرنیچر، کپڑے اور گاڑیاں جیسا سامان دوبارہ لینے کے لیے قرض لے سکتے ہیں۔'],
 flood:['سیلاب انشورنس کا دعویٰ','اگر آپ کے پاس سیلاب انشورنس ہے، بشمول کرایہ داروں کے سامان کی کوریج، تو جلد دعویٰ کریں اور پہلے نقصان کی تصاویر لیں۔'],
 legal:['آفات میں مفت قانونی مدد','اگر آپ وکیل کا خرچ نہیں اٹھا سکتے تو رضاکار وکلا مالکِ مکان کے مسائل، انشورنس دعووں، ٹھیکیداروں اور قانونی دستاویزات میں مدد کرتے ہیں۔'],
 transport:['محفوظ جگہ اور خدمات تک سواری','211 اور مقامی ہنگامی دفتر پناہ گاہوں اور بحالی مراکز تک سواری کا انتظام کر سکتے ہیں۔ ضرورت سے پہلے انخلا میں مدد کے بارے میں پوچھیں۔'],
 pets:['آپ کے پالتو جانور کے لیے مدد','211 سے پالتو جانور قبول کرنے والی پناہ گاہوں کے بارے میں پوچھیں۔ خوراک، دوا، ویکسین کا ریکارڈ اور پنجرا یا پٹا ساتھ لائیں۔'],
 counseling:['بحران کے مشیر سے بات کریں','آفت کے بعد ذہنی دباؤ کے لیے مفت اور رازدارانہ مدد، کال یا ٹیکسٹ کے ذریعے، چوبیس گھنٹے اور کئی زبانوں میں۔'],
 call211:['211 مقامی مدد','آپ کے قریب پناہ گاہوں، کھانے، سواری اور بحالی کے پروگراموں تک پہنچنے کے لیے مفت اور رازدارانہ لائن۔'],
 state:['آپ کی ریاست کا ہنگامی ادارہ','{state} کے لیے سرکاری انتباہات، انخلا کے احکامات اور ریاستی بحالی کے پروگرام۔'],
};
const am:Record<string,T>={
 fema:['የ FEMA የአደጋ እርዳታ','ከታወጀ አደጋ በኋላ የፌዴራል እርዳታ ያመልክቱ፦ ደህንነቱ የተጠበቀ መኖሪያ፣ የቤት ጥገና እና ሌሎች የአደጋ ወጪዎች። ማመልከት ነፃ ነው።'],
 housing:['የኪራይ እና ጊዜያዊ መኖሪያ እርዳታ','በቤትዎ መኖር በማይችሉበት ጊዜ FEMA ለኪራይና ለሆቴል ጨምሮ የመኖሪያ ወጪዎችን ሊረዳ ይችላል።'],
 redcross:['የቀይ መስቀል መጠለያ እና አስቸኳይ እርዳታ','ክፍት መጠለያ፣ ምግብና አስቸኳይ አቅርቦቶችን ያግኙ። መጠለያዎች ነፃ ናቸው፤ አገልጋይ እንስሳት ሁልጊዜ ይፈቀዳሉ።'],
 repair:['የቤት ጥገና እርዳታ','መድን ጉዳቱን በማይሸፍንበት ጊዜ የራስዎና የሚኖሩበት ቤት እንደገና ለመኖር ደህንነቱ እንዲጠበቅ FEMA ሊረዳ ይችላል።'],
 disability:['የአካል ጉዳት እና አደጋ የስልክ መስመር','በአካል ጉዳተኞች የሚመራ የ24 ሰዓት እርዳታ ለተደራሽ መጠለያ፣ መሣሪያዎች፣ ጥቅማ ጥቅሞች እና የተደራሽነት እንቅፋቶች። ይደውሉ፣ የጽሑፍ መልእክት ወይም ኢሜይል ይላኩ።'],
 medicine:['መድኃኒቶችንና የሕክምና መሣሪያዎችን መተካት','መድን ከሌለዎት፣ ይህ የፌዴራል ፕሮግራም ለአደጋዎ ሲሠራ በአደጋው የጠፉ መድኃኒቶችንና አንዳንድ የሕክምና መሣሪያዎችን ሊሸፍን ይችላል።'],
 documents:['የጠፉ ሰነዶችን መተካት','የሶሻል ሴኩሪቲ ካርድ፣ የልደት ሰርተፊኬት፣ መታወቂያ እና ሌሎች አስፈላጊ ሰነዶችን ለመተካት ደረጃ በደረጃ እርዳታ።'],
 drc:['የአደጋ ማገገሚያ ማዕከል (በአካል)','ስለ ማመልከቻዎች፣ ስለጠፉ ሰነዶችና ስለ ተደራሽነት ፍላጎቶች ከ FEMA፣ SBA እና የግዛት ሠራተኞች ጋር ፊት ለፊት ይነጋገሩ።'],
 sba:['ዝቅተኛ ወለድ ያለው የአደጋ ብድር (SBA)','የቤት ባለቤቶች ለጥገና ወይም ለመልሶ ግንባታ መበደር ይችላሉ። ተከራዮችና ባለቤቶች የቤት ዕቃ፣ ልብስና መኪና የመሳሰሉትን ለመተካት መበደር ይችላሉ።'],
 flood:['የጎርፍ መድን ጥያቄ','የጎርፍ መድን ካለዎት፣ የተከራዮች የንብረት ሽፋንን ጨምሮ፣ ጥያቄዎን ቶሎ ይጀምሩና መጀመሪያ ጉዳቱን ፎቶ ያንሱ።'],
 legal:['ነፃ የአደጋ የሕግ እርዳታ','ጠበቃ መቅጠር ካልቻሉ በጎ ፈቃደኛ ጠበቆች በአከራይ ችግሮች፣ በመድን ጥያቄዎች፣ በኮንትራክተሮችና በሕጋዊ ሰነዶች ይረዳሉ።'],
 transport:['ወደ ደህና ቦታና አገልግሎቶች መጓጓዣ','211 እና የአካባቢው የአደጋ ጊዜ ቢሮ ወደ መጠለያዎችና የማገገሚያ ማዕከላት መጓጓዣ ሊያዘጋጁ ይችላሉ። ከመፈለግዎ በፊት ስለ መልቀቂያ እርዳታ ይጠይቁ።'],
 pets:['ለቤት እንስሳዎ እርዳታ','የቤት እንስሳትን የሚቀበሉ መጠለያዎችን 211ን ይጠይቁ። ምግብ፣ መድኃኒት፣ የክትባት መዝገብ እና መያዣ ወይም ማሰሪያ ይያዙ።'],
 counseling:['ከቀውስ አማካሪ ጋር ይነጋገሩ','ከአደጋ በኋላ ለሚፈጠር ጭንቀት ነፃና ምስጢራዊ ድጋፍ፣ በስልክ ወይም በጽሑፍ መልእክት፣ በ24 ሰዓት እና በብዙ ቋንቋዎች።'],
 call211:['211 የአካባቢ እርዳታ','በአቅራቢያዎ ያሉ መጠለያዎችን፣ ምግብን፣ መጓጓዣንና የማገገሚያ ፕሮግራሞችን የሚያገናኝ ነፃና ምስጢራዊ መስመር።'],
 state:['የግዛትዎ የአደጋ ጊዜ ተቋም','ለ {state} ኦፊሴላዊ ማስጠንቀቂያዎች፣ የመልቀቅ ትዕዛዞች እና የግዛት የማገገሚያ ፕሮግራሞች።'],
};
const fr:Record<string,T>={
 fema:['Aide de la FEMA en cas de catastrophe','Demandez une aide fédérale après une catastrophe déclarée : un logement sûr, des réparations et d’autres frais. La demande est gratuite.'],
 housing:['Aide au loyer et au logement temporaire','La FEMA peut vous aider à payer un endroit où rester tant que vous ne pouvez pas vivre chez vous, loyer et hôtel compris.'],
 redcross:['Refuge et aide d’urgence de la Croix-Rouge','Trouvez un refuge ouvert, des repas et des fournitures d’urgence. Les refuges sont gratuits et acceptent toujours les animaux d’assistance.'],
 repair:['Aide à la réparation du logement','La FEMA peut aider à rendre à nouveau habitable le logement dont vous êtes propriétaire et où vous vivez, si l’assurance ne couvre pas les dégâts.'],
 disability:['Ligne Handicap et Catastrophes','Une aide dirigée par des personnes handicapées, 24 h/24, pour les refuges accessibles, l’équipement, les prestations et les obstacles d’accès. Appel, SMS ou e-mail.'],
 medicine:['Remplacer médicaments et équipement médical','Sans assurance, ce programme fédéral peut couvrir des médicaments et certains équipements médicaux perdus lors d’une catastrophe, lorsqu’il est activé pour la vôtre.'],
 documents:['Remplacer des documents perdus','Une aide pas à pas pour remplacer carte de sécurité sociale, acte de naissance, pièce d’identité et autres documents essentiels.'],
 drc:['Centre de reconstruction (sur place)','Parlez en personne avec la FEMA, la SBA et l’État de vos demandes, de vos documents perdus et de vos besoins d’accessibilité.'],
 sba:['Prêts catastrophe à faible taux (SBA)','Les propriétaires peuvent emprunter pour réparer ou reconstruire. Locataires et propriétaires peuvent emprunter pour remplacer meubles, vêtements et voitures.'],
 flood:['Déclaration d’assurance inondation','Si vous avez une assurance inondation, y compris la garantie des biens des locataires, déclarez vite le sinistre et photographiez d’abord les dégâts.'],
 legal:['Aide juridique gratuite','Des avocats bénévoles aident pour les litiges avec le propriétaire, les assurances, les entrepreneurs et les documents juridiques, si vous ne pouvez pas payer un avocat.'],
 transport:['Transport vers la sécurité et les services','Le 211 et le bureau local des urgences peuvent organiser un trajet vers un refuge ou un centre de reconstruction. Renseignez-vous sur l’aide à l’évacuation avant d’en avoir besoin.'],
 pets:['Aide pour votre animal','Demandez au 211 les refuges qui acceptent les animaux. Emportez nourriture, médicaments, carnet de vaccination et une caisse ou une laisse.'],
 counseling:['Parler à un conseiller de crise','Un soutien gratuit et confidentiel face au stress après une catastrophe, par appel ou SMS, 24 h/24 et en plusieurs langues.'],
 call211:['211 aide locale','Une ligne gratuite et confidentielle vers les refuges, l’alimentation, le transport et les programmes de reconstruction près de chez vous.'],
 state:['Agence des urgences de votre État','Alertes officielles, ordres d’évacuation et programmes de reconstruction de l’État pour {state}.'],
};
const hi:Record<string,T>={
 fema:['FEMA आपदा सहायता','घोषित आपदा के बाद संघीय मदद के लिए आवेदन करें: रहने की सुरक्षित जगह, घर की मरम्मत और आपदा के अन्य खर्च। आवेदन मुफ़्त है।'],
 housing:['किराया और अस्थायी आवास सहायता','जब तक आप घर में नहीं रह सकते, FEMA रहने की जगह के खर्च में मदद कर सकता है, जिसमें किराया और होटल शामिल हैं।'],
 redcross:['रेड क्रॉस आश्रय और आपात सहायता','खुला आश्रय, भोजन और आपात सामान खोजें। आश्रय मुफ़्त हैं और सेवा पशुओं को हमेशा अनुमति है।'],
 repair:['घर की मरम्मत में सहायता','जब बीमा नुकसान को कवर न करे, तो FEMA आपके अपने और रहने वाले घर को फिर से रहने योग्य बनाने में मदद कर सकता है।'],
 disability:['विकलांगता और आपदा हॉटलाइन','विकलांग लोगों द्वारा चलाई जाने वाली चौबीसों घंटे मदद: सुलभ आश्रय, उपकरण, लाभ और पहुँच की बाधाएँ। कॉल, टेक्स्ट या ईमेल करें।'],
 medicine:['दवाएँ और चिकित्सा उपकरण बदलें','बीमा न होने पर, आपकी आपदा के लिए सक्रिय होने पर, यह संघीय कार्यक्रम आपदा में खोई दवाओं और कुछ चिकित्सा उपकरणों का खर्च उठा सकता है।'],
 documents:['खोए दस्तावेज़ दोबारा बनवाएँ','सामाजिक सुरक्षा कार्ड, जन्म प्रमाणपत्र, पहचान पत्र और अन्य ज़रूरी दस्तावेज़ दोबारा बनवाने के लिए चरण-दर-चरण मदद।'],
 drc:['आपदा पुनर्प्राप्ति केंद्र (व्यक्तिगत रूप से)','आवेदन, खोए दस्तावेज़ों और सुलभता ज़रूरतों के बारे में FEMA, SBA और राज्य कर्मचारियों से आमने-सामने बात करें।'],
 sba:['कम ब्याज वाले आपदा ऋण (SBA)','घर के मालिक मरम्मत या पुनर्निर्माण के लिए ऋण ले सकते हैं। किरायेदार और मालिक फ़र्नीचर, कपड़े और वाहन जैसे सामान बदलने के लिए ऋण ले सकते हैं।'],
 flood:['बाढ़ बीमा दावा','अगर आपके पास बाढ़ बीमा है, किरायेदार के सामान का कवर भी, तो जल्दी दावा करें और पहले नुकसान की तस्वीरें लें।'],
 legal:['मुफ़्त आपदा कानूनी सहायता','अगर आप वकील का खर्च नहीं उठा सकते, तो स्वयंसेवी वकील मकान मालिक, बीमा दावों, ठेकेदारों और कानूनी दस्तावेज़ों में मदद करते हैं।'],
 transport:['सुरक्षित जगह और सेवाओं तक पहुँचने का साधन','211 और आपका स्थानीय आपात कार्यालय आश्रयों और पुनर्प्राप्ति केंद्रों तक सवारी की व्यवस्था कर सकते हैं। ज़रूरत से पहले निकासी सहायता के बारे में पूछें।'],
 pets:['आपके पालतू जानवर के लिए मदद','पालतू जानवर स्वीकार करने वाले आश्रयों के बारे में 211 से पूछें। भोजन, दवा, टीकाकरण रिकॉर्ड और पिंजरा या पट्टा साथ लाएँ।'],
 counseling:['संकट परामर्शदाता से बात करें','आपदा के बाद तनाव के लिए मुफ़्त, गोपनीय सहायता, कॉल या टेक्स्ट से, चौबीसों घंटे और कई भाषाओं में।'],
 call211:['211 स्थानीय मदद','आपके पास के आश्रय, भोजन, परिवहन और पुनर्प्राप्ति कार्यक्रमों तक पहुँचने के लिए मुफ़्त, गोपनीय लाइन।'],
 state:['आपके राज्य की आपात एजेंसी','{state} के लिए आधिकारिक चेतावनियाँ, निकासी आदेश और राज्य पुनर्प्राप्ति कार्यक्रम।'],
};
const AID_TEXT:Record<Language,Record<string,T>>={en,es,zh,vi,ar,ko,ur,am,fr,hi};

export function aidText(language:Language,id:string):T{return AID_TEXT[language]?.[id]||en[id];}
