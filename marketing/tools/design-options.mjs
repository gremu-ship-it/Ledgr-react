import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../flyer/output');
const original=await fs.readFile(path.join(root,'ledgr-master-a4.svg'),'utf8');
function option({name,heroFill,heroText,gold}) {
 const marker='<!-- illustrative product panel'; const i=original.indexOf(marker);
 let head=original.slice(0,i), tail=original.slice(i);
 head=head.replace('fill="url(#navy)"',`fill="${heroFill}"`)
   .replaceAll('fill="#fff"',`fill="${heroText}"`)
   .replaceAll('fill="#E4EAF3"',`fill="${heroText==='#102344'?'#43536A':'#E4EAF3'}"`)
   .replaceAll('fill="#D4DEEB"',`fill="${heroText==='#102344'?'#43536A':'#D4DEEB'}"`)
   .replaceAll('fill="#FFD45B"',`fill="${gold}"`);
 // Use a restrained contrasting grid on light and saturated covers.
 if(heroFill!=='url(#navy)') head=head.replace('stroke="#ffffff" stroke-opacity=".045"','stroke="#102344" stroke-opacity=".055"');
 return head+tail;
}
const configs=[
 {name:'design-option-b-editorial',heroFill:'#FFF8E9',heroText:'#102344',gold:'#B9820B'},
 {name:'design-option-c-gold-impact',heroFill:'url(#gold)',heroText:'#102344',gold:'#102344'}
];
for(const cfg of configs){const svg=option(cfg),base=path.join(root,cfg.name);await fs.writeFile(base+'.svg',svg);await sharp(Buffer.from(svg),{density:72}).resize(1240,1754).png().toFile(base+'.png');console.log(base)}
