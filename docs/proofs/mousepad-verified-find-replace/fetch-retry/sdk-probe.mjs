// Run a copy beside model-rate.mjs in the isolated installed consumer.
import assert from 'node:assert/strict';
import {Agent} from '@mastra/core/agent';
import {pacedFetch} from './model-rate.mjs';
process.env.ANTHROPIC_API_KEY='offline-fixture-not-a-credential';
const original=globalThis.fetch;let calls=0,clock=0;const bodies=[];
const answer={id:'msg_test',type:'message',role:'assistant',content:[{type:'text',text:'OK'}],model:'claude-sonnet-4-5-20250929',stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:1}};
try {
 globalThis.fetch=pacedFetch(async request=>{calls++;bodies.push(await request.text());if(calls===1)throw new TypeError('other side closed');return Response.json(answer);},{now:()=>clock,wait:async ms=>{clock+=ms;}});
 const agent=new Agent({id:'offline-fetch-probe',name:'offline-fetch-probe',model:'anthropic/claude-sonnet-4-5-20250929',instructions:'Return OK'});
 const result=await agent.generate('OK',{maxSteps:1,modelSettings:{temperature:0,maxRetries:0}});
 assert.equal(result.text,'OK');assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);assert.equal(clock,3000);
 calls=0;globalThis.fetch=pacedFetch(async()=>{calls++;throw new TypeError('other side closed');},{now:()=>clock,wait:async ms=>{clock+=ms;}});
 await assert.rejects(agent.generate('OK',{maxSteps:1,modelSettings:{maxRetries:0}}));assert.equal(calls,3);
 console.log('GREEN: installed SDK retries only pre-response fetch; identical request, 3000ms spacing; persistent failure capped at three attempts; no network or desktop effects');
}finally{globalThis.fetch=original;}
