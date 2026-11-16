import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../flyer');
const tpl = await fs.readFile(path.join(root, 'design.svg.tpl'), 'utf8');
const data = JSON.parse(await fs.readFile(path.join(root, 'campaign.json'), 'utf8'));
const variants = [
  {name:'ledgr-master-a4',w:2480,h:3508,mode:'a4'},
  {name:'ledgr-whatsapp-portrait',w:1080,h:1350,mode:'portrait'},
  {name:'ledgr-whatsapp-status',w:1080,h:1920,mode:'status'},
  {name:'ledgr-social-square',w:1080,h:1080,mode:'square'},
];
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function render(v) {
  const {w:W,h:H,mode}=v, s=W/1080, px=n=>Math.round(n*s);
  const compact=mode==='square', status=mode==='status', portrait=mode==='portrait';
  const PAD=px(70), CW=W-2*PAD;
  const HERO=px(compact?365:portrait?575:status?660:610), HERO_END=HERO+px(22), W_MINUS=W;
  const TOP=px(compact?25:38), BRAND_TAG_X=W-PAD, TAG_SIZE=px(18), KICK_Y=px(compact?92:108), KICK_SIZE=px(compact?14:16);
  const HEAD_SIZE=px(compact?35:status?57:portrait?50:54), HEAD_Y=px(compact?135:170), HEAD_Y2=px(compact?175:220), HEAD_Y3=px(compact?215:270), SUB_Y=px(compact?240:310), SUB_SIZE=px(compact?14:17);
  const PANEL_X=PAD, PANEL_Y=px(compact?220:status?330:portrait?325:325), PANEL_W=CW, PANEL_H=px(compact?120:portrait?265:270), PANEL_W_MINUS=PANEL_W-40, PANEL_RIGHT=PANEL_W-20;
  const CARDH=px(compact?26:portrait?78:62), WID1=Math.floor((PANEL_W-px(68))/3), WID2=WID1,WID3=WID1,X2=px(24)+WID1+px(10),X3=X2+WID2+px(10),X2PLUS=X2+px(12),X3PLUS=X3+px(12),NUMSIZE=px(compact?10:13);
  const CHARTTITLE_Y=px(compact?104:170), LINE1=px(compact?125:195),LINE2=px(compact?145:220),LINE3=px(compact?165:245), PANEL_RIGHT_MINUS=PANEL_W-24;
  const cx=[px(45),px(140),px(235),px(330),px(425)], ybase=px(220);
  const CHART1=`M${cx[0]} ${px(246)} L${cx[1]} ${px(230)} L${cx[2]} ${px(239)} L${cx[3]} ${px(210)} L${cx[4]} ${px(218)}`;
  const CHART2=`M${cx[0]} ${px(258)} L${cx[1]} ${px(250)} L${cx[2]} ${px(255)} L${cx[3]} ${px(244)} L${cx[4]} ${px(247)}`;
  const [DOT1X,DOT1Y,DOT2X,DOT2Y,DOT3X,DOT3Y]=[cx[1],px(230),cx[3],px(210),cx[4],px(218)];
  const BADGE_Y=px(compact?220:status?185:185), BADGE_W=px(250), BADGE_TX=px(145), BADGE_TY=BADGE_Y+px(19);
  const MODULE_TITLE_Y=px(compact?410:portrait?670:status?740:690), MODULE_SUB_Y=MODULE_TITLE_Y+px(34), SECTION_SIZE=px(compact?19:28), SMALL=px(13);
  const gridTop=MODULE_SUB_Y+px(28), gap=px(compact?8:portrait?7:mode==='a4'?8:12), cardH=px(compact?56:portrait?58:status?112:mode==='a4'?76:94), colW=(CW-gap)/2;
  const icons=['₭','↗','▤','◎','⌂','⌁','✦'];
  const modules=data.modules.map((m,i)=>{
    const col=i%2,row=Math.floor(i/2),x=PAD+col*(colW+gap),y=gridTop+row*(cardH+gap),titleSize=px(compact?15:17),descSize=px(compact?11:12);
    return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${colW}" height="${cardH}" rx="${px(12)}" fill="#fff"/><rect x="${x+px(13)}" y="${y+px(15)}" width="${px(34)}" height="${px(34)}" rx="${px(10)}" fill="#FFF4D1"/><text x="${x+px(30)}" y="${y+px(38)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${px(17)}" font-weight="700" fill="#926B16">${icons[i]}</text><text x="${x+px(57)}" y="${y+px(30)}" font-family="Inter,Arial,sans-serif" font-size="${titleSize}" font-weight="750" fill="#142443">${esc(m.title)}</text><text x="${x+px(57)}" y="${y+px(52)}" font-family="Inter,Arial,sans-serif" font-size="${descSize}" fill="#66768B">${esc(m.description)}</text></g>`;
  }).join('');
  const rows=Math.ceil(data.modules.length/2), moduleEnd=gridTop+rows*(cardH+gap)-gap;
  const BENEFIT_Y=moduleEnd+px(compact?14:portrait?15:26), BENEFIT_H=px(compact?100:portrait?110:mode==='a4'?120:145), PAD_IN=PAD+px(22), BENEFIT_HEAD_Y=BENEFIT_Y+px(compact?26:portrait?28:35), BENEFIT_SIZE=px(compact?18:portrait?18:22);
  const benefitItems=compact?data.benefits.slice(0,4):data.benefits;
  const BENEFITS=benefitItems.map((b,i)=>{const cols=compact?2:3,col=i%cols,row=Math.floor(i/cols), bx=PAD_IN+col*px(compact?460:315), by=BENEFIT_Y+px(67)+row*px(30);return `<circle cx="${bx}" cy="${by-px(5)}" r="${px(4)}" fill="#E7B441"/><text x="${bx+px(13)}" y="${by}" font-family="Inter,Arial,sans-serif" font-size="${px(compact?12:13)}" font-weight="650" fill="#32435B">${esc(b)}</text>`}).join('');
  const CTA_Y=BENEFIT_Y+BENEFIT_H+px(compact?12:portrait?12:20), CTA_H=H-CTA_Y, CTA_HEAD_Y=CTA_Y+px(compact?38:portrait?38:54), CTA_HEAD_Y2=CTA_HEAD_Y+px(compact?30:portrait?31:38), CTA_HEAD_SIZE=px(compact?22:portrait?25:32);
  const BUTTON_Y=CTA_HEAD_Y2+px(compact?12:portrait?12:20), BUTTON_H=px(compact?38:portrait?40:52), BUTTON_W=px(compact?345:portrait?360:392),BUTTON_R=px(14),BUTTON_TEXT_X=PAD+BUTTON_W/2,BUTTON_TEXT_Y=BUTTON_Y+px(compact?26:portrait?27:33),BUTTON_SIZE=px(compact?13:portrait?14:16);
  const CTA_SUPPORT_Y=BUTTON_Y+BUTTON_H+px(compact?18:portrait?17:27),FOOT_SIZE=px(compact?11:portrait?12:14), CONTACT_LINE_Y=CTA_SUPPORT_Y+px(compact?16:portrait?15:24),CONTACT_RIGHT=W-PAD,CONTACT_SIZE=px(compact?11:portrait?12:15);
  const PHONE_Y=CONTACT_LINE_Y+px(compact?24:portrait?24:31),PHONE_X=PAD+px(compact?112:portrait?145:180),EMAIL_Y=PHONE_Y+px(compact?22:portrait?23:28),EMAIL_X=PAD+px(compact?46:portrait?54:65),FOOTER_Y=H-px(compact?15:portrait?14:19),PANEL_OPACITY=compact?0:1,FOOTER_OPACITY=0;
  const vars={W,H,HERO,HERO_END,W_MINUS,PAD,TOP,BRAND_TAG_X,TAG_SIZE,KICK_Y,KICK_SIZE,HEAD_Y,HEAD_Y2,HEAD_Y3,HEAD_SIZE,SUB_Y,SUB_SIZE,PANEL_X,PANEL_Y,PANEL_W,PANEL_H,PANEL_W_MINUS,PANEL_RIGHT,CARDH,WID1,WID2,WID3,X2,X3,X2PLUS,X3PLUS,NUMSIZE,CHARTTITLE_Y,LINE1,LINE2,LINE3,PANEL_RIGHT_MINUS,CHART1,CHART2,DOT1X,DOT1Y,DOT2X,DOT2Y,DOT3X,DOT3Y,BADGE_Y,BADGE_W,BADGE_TX,BADGE_TY,MODULE_TITLE_Y,MODULE_SUB_Y,SECTION_SIZE,SMALL,MODULES:modules,CONTENT_W:CW,BENEFIT_Y,BENEFIT_H,PAD_IN,BENEFIT_HEAD_Y,BENEFIT_SIZE,BENEFITS,CTA_Y,CTA_H,CTA_HEAD_Y,CTA_HEAD_Y2,CTA_HEAD_SIZE,BUTTON_Y,BUTTON_H,BUTTON_R,BUTTON_W,BUTTON_TEXT_X,BUTTON_TEXT_Y,BUTTON_SIZE,CTA_SUPPORT_Y,FOOT_SIZE,CONTACT_LINE_Y,CONTACT_RIGHT,CONTACT_SIZE,PHONE_Y,PHONE_X,EMAIL_Y,EMAIL_X,FOOTER_Y,PANEL_OPACITY,FOOTER_OPACITY};
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g,(_,k)=>String(vars[k]??''));
}
async function pdf(svg, file, w, h) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:[w,h],margin:0,compress:true}); const out=fs.open(file,'w');
    out.then(handle=>{const stream=handle.createWriteStream();stream.on('finish',resolve);stream.on('error',reject);doc.pipe(stream);SVGtoPDF(doc,svg,0,0,{width:w,height:h,assumePt:true});doc.end();}).catch(reject);
  });
}
await fs.mkdir(path.join(root,'output'),{recursive:true});
for(const v of variants){
  const svg=render(v), base=path.join(root,'output',v.name), svgPath=base+'.svg';
  await fs.writeFile(svgPath,svg);
  const png=await sharp(Buffer.from(svg),{density:v.name==='ledgr-master-a4'?150:96}).resize(v.w,v.h,{fit:'fill'}).png({compressionLevel:9}).toBuffer();
  await fs.writeFile(base+'.png',png);
  const pointsW=v.name==='ledgr-master-a4'?595.276:v.w*72/96, pointsH=v.name==='ledgr-master-a4'?841.89:v.h*72/96;
  await pdf(svg,base+'.pdf',pointsW,pointsH);
  console.log(`${v.name}: ${v.w}x${v.h} PNG + vector PDF + editable SVG`);
}
