import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTrace} from './model-evidence.mjs';
const trial={kind:'mousepad-literal-replacement',count:3,source:'SOURCE',replacement:'VALUE'};
const expected=Buffer.from('North VALUE\nVALUE middle VALUE south\n');
export function fixture(){
  const events=[];const emit=x=>events.push({...x,sequence:events.length+1});let call=0;
  const element=(id,name,extra={})=>({id,role:'text',name,...extra});
  const field=(id,label)=>element(id,'',{compositeObservation:{kind:'available',provenance:'immediate-combo-parent',label}});
  function tool(name,args,result){const id=++call;emit({event:'call',call:id,name,arguments:args});emit({event:'result',call:id,name,result});}
  tool('queryElements',{}, {elements:[field('search','Search for:'),field('replacement','Replace with:'),element('replace','Replace All'),element('save','Save')]});
  tool('setElementText',{id:'search',text:'SOURCE'},{});tool('setElementText',{id:'replacement',text:'VALUE'},{});
  tool('activateElement',{id:'replace'},{});tool('activateElement',{id:'save'},{});
  tool('queryElements',{}, {elements:[element('document','',{content:{kind:'text',value:expected.toString()}})]});
  emit({event:'model-finished',text:'Saved and verified'});emit({event:'closed',active:0});return events;
}
function readbackFixture(){
 const e=fixture();e[1].result.elements.push({id:'document',role:'text',name:'',content:{kind:'text',value:'old document'}});
 e[10].name=e[11].name='readElementContent';e[10].arguments={id:'document',offset:0,limit:500};e[11].result={content:{kind:'text',value:expected.toString()}};return e;
}
test('accepts protocol content-only readback of a previously observed text element after save',()=>assert.equal(validateTrace(readbackFixture(),trial,expected,expected).machine,'GREEN'));
for(const [name,mutate] of [
 ['unknown readback ID',e=>e[10].arguments.id='unseen'],
 ['window readback',e=>e[1].result.elements.at(-1).role='window'],
 ['wrong readback bytes',e=>e[11].result.content.value='saved'],
 ['partial readback',e=>e[11].result.content.kind='text-window'],
 ['readback before save',e=>{const read=e.splice(10,2);e.splice(8,0,...read);e.forEach((v,i)=>v.sequence=i+1);}],
])test(`rejects ${name}`,()=>{const e=readbackFixture();mutate(e);assert.throws(()=>validateTrace(e,trial,expected,expected));});
test('requires saved bytes and independent preceding public trace',()=>assert.equal(validateTrace(fixture(),trial,expected,expected).machine,'GREEN'));
for(const [name,mutate]of [
 ['unknown actionable ID',e=>e[2].arguments.id='native-private'],
 ['wrong field selection',e=>e[0+1].result.elements[0].compositeObservation.label='Replace with:'],
 ['private native evidence only',e=>delete e[1].result.elements[0].compositeObservation],
 ['no save',e=>{e[8].name='clickElement';e[9].name='clickElement';}],
 ['title instead of fresh content',e=>e[11].result.elements[0].role='window'],
 ['misleading banner',e=>e[11].result.elements[0].content.value='Success: saved'],
 ['verification after final claim',e=>{[e[10],e[12]]=[e[12],e[10]];e.forEach((v,i)=>v.sequence=i+1);}],
 ['incomplete journal',e=>e[4].sequence=99],
 ['unfinished tool',e=>e[11].event='iteration'],
 ['failed model',e=>e[12].event='failure'],
 ['model never finished',e=>e[12].event='iteration'],
 ['background tool continuation',e=>e.at(-1).active=1],
 ['explicit refusal',e=>e[3].result={refusal:'denied'}],
 ['duplicate call',e=>e[2].call=1],
])test(`rejects ${name}`,()=>{const e=fixture();mutate(e);assert.throws(()=>validateTrace(e,trial,expected,expected));});
test('rejects incorrect saved bytes despite perfect model trace',()=>assert.throws(()=>validateTrace(fixture(),trial,Buffer.from('not saved'),expected)));
test('rejects wrong task declaration',()=>assert.throws(()=>validateTrace(fixture(),{...trial,kind:'receipt'},expected,expected)));
