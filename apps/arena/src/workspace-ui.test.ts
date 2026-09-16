import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const dir = new URL('../public/', import.meta.url);
const file = (name:string) => readFileSync(new URL(name,dir),'utf8');
describe('evidence workspace assets',()=>{
 it('retains the complete prior component stylesheet',()=>{
   const b=Buffer.from(file('style-base.css'));
   expect(createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')).toBe('8d782f894f5e7d0b9c74dbbbdcbad5b3866d6788');
 });
 it('loads only existing local stylesheets from the runtime entry',()=>{
   const css=file('style.css');expect(css).toContain("'./style-base.css'");expect(css).toContain("'./workspace.css'");
   expect(file('index.html')).toContain('href="style.css"');
   expect(css).not.toMatch(/https?:|data:/);
 });
 it('places transcript and evidence separately while preserving hidden state',()=>{
   const css=file('workspace.css');expect(css).toContain('grid-area:transcript');expect(css).toContain('grid-area:evidence');expect(css).toContain('[hidden]{display:none!important}');
   for(const id of ['transcript','evidence-list','mission-list','play-form','result-wrap','intake-panel'])expect(file('index.html')).toContain(`id="${id}"`);
 });
 it('includes narrow-view and reduced-motion behavior',()=>{
   const css=file('workspace.css');expect(css).toContain('max-width:900px');expect(css).toContain('prefers-reduced-motion');expect(css).toContain('min-height:44px');
 });
});
