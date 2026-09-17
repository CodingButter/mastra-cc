// Copy next to model-driver.mjs in an isolated installed consumer before running.
import assert from 'node:assert/strict';
import {Agent} from '@mastra/core/agent';
import {pacedFetch} from './model-rate.mjs';
process.env.ANTHROPIC_API_KEY='offline-fixture-not-a-credential';
let calls=0,clock=0;const bodies=[];
const answer={id:'msg_test',type:'message',role:'assistant',content:[{type:'text',text:'OK'}],model:'claude-sonnet-4-5-20250929',stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:1}};
const original=globalThis.fetch;
globalThis.fetch=pacedFetch(async request=>{
 calls++;assert.equal(request.url,'https://api.anthropic.com/v1/messages');assert.equal(request.headers.get('x-api-key'),process.env.ANTHROPIC_API_KEY);assert.equal(request.headers.get('content-type'),'application/json');
 const body=await request.text();bodies.push(body);assert.deepEqual(JSON.parse(body).cache_control,{type:'ephemeral'});
 if(calls===1)return new Response('{}',{status:429,headers:{'Retry-After':'4'}});
 return Response.json(answer);
},{now:()=>clock,wait:async ms=>{clock+=ms;}});
try {const agent=new Agent({id:'offline-rate-probe',name:'offline-rate-probe',model:'anthropic/claude-sonnet-4-5-20250929',instructions:'Return OK'});const result=await agent.generate('OK',{maxSteps:1,modelSettings:{temperature:0,maxRetries:0}});assert.equal(result.text,'OK');assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);assert.equal(clock,4000);let failures=0;globalThis.fetch=pacedFetch(async()=>{failures++;return Response.json({type:'error',error:{type:'api_error',message:'offline fixture'}},{status:500});});await assert.rejects(agent.generate('OK',{maxSteps:1,modelSettings:{maxRetries:0}}));assert.equal(failures,1);console.log('GREEN: installed Mastra/Anthropic generate intercepted; identical 429 retry, headers preserved, JSON success decoded; persistent 500 makes one request; no network or desktop effects');}finally{globalThis.fetch=original;}assert.equal(globalThis.fetch,original);
