import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../flyer');
const variants=[
  {source:'ledgr-master-a4.svg',name:'ledgr-gold-impact-a4',w:2480,h:3508,pdfW:595.276,pdfH:841.89},
  {source:'ledgr-whatsapp-portrait.svg',name:'ledgr-gold-impact-whatsapp-portrait',w:1080,h:1350,pdfW:810,pdfH:1012.5},
  {source:'ledgr-whatsapp-status.svg',name:'ledgr-gold-impact-whatsapp-status',w:1080,h:1920,pdfW:810,pdfH:1440},
  {source:'ledgr-social-square.svg',name:'ledgr-gold-impact-social-square',w:1080,h:1080,pdfW:810,pdfH:810},
];
function makeGoldImpact(svg) {
  const marker='<!-- illustrative product panel';
  const at=svg.indexOf(marker);
  if(at<0) throw new Error('Could not find hero boundary in source SVG');
  let hero=svg.slice(0,at), rest=svg.slice(at);
  hero=hero.replace('fill="url(#navy)"','fill="url(#gold)"')
    .replaceAll('fill="#fff"','fill="#102344"')
    .replaceAll('fill="#E4EAF3"','fill="#33445D"')
    .replaceAll('fill="#D4DEEB"','fill="#33445D"')
    .replaceAll('fill="#FFD45B"','fill="#102344"');
  return hero+rest;
}
function writePdf(svg,file,w,h){return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:[w,h],margin:0,compress:true});
  const stream=doc.pipe(requireStream(file));
  stream.once('finish',resolve);stream.once('error',reject);
  SVGtoPDF(doc,svg,0,0,{width:w,height:h,assumePt:true});doc.end();
});}
function requireStream(file){
  // pdfkit accepts a write stream; the caller waits for its completion.
  return createWriteStream(file);
}
import { createWriteStream } from 'node:fs';
await fs.mkdir(path.join(root,'output'),{recursive:true});
for(const v of variants){
  const source=await fs.readFile(path.join(root,'output',v.source),'utf8');
  const svg=makeGoldImpact(source),base=path.join(root,'output',v.name);
  await fs.writeFile(base+'.svg',svg);
  await sharp(Buffer.from(svg),{density:96}).resize(v.w,v.h,{fit:'fill'}).png({compressionLevel:9}).toFile(base+'.png');
  await writePdf(svg,base+'.pdf',v.pdfW,v.pdfH);
  console.log(`${v.name}: PNG, vector PDF, editable SVG`);
}
