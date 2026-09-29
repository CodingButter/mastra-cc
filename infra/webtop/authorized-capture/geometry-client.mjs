import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from '/opt/mastra-cc/transport/index.mjs';
const client = await connect({socketPath: process.env.MASTRA_CC_SOCKET});
async function mode(mode) {
  const command = {mode, nonce: Date.now()};
  writeFileSync('/tmp/authorized-fixture-command.tmp', JSON.stringify(command));
  renameSync('/tmp/authorized-fixture-command.tmp', '/tmp/authorized-fixture-command.json');
  for (let i=0; i<100; i++) {
    try { if (JSON.parse(readFileSync('/tmp/authorized-fixture-ack.json','utf8')).nonce === command.nonce) return; } catch {}
    await sleep(50);
  }
  throw Error('fixture command acknowledgement deadline');
}
function pixelRows(image) {
  const png=Buffer.from(image.data,'base64'), chunks=[];
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  for(let offset=8;offset<png.length;) {
    const length=png.readUInt32BE(offset);
    if(png.toString('ascii',offset+4,offset+8)==='IDAT') chunks.push(png.subarray(offset+8,offset+8+length));
    offset+=length+12;
  }
  const raw=inflateSync(Buffer.concat(chunks));
  assert.equal(raw.length,(image.width*3+1)*image.height);
  return (x,y)=>{
    const row=y*(image.width*3+1);
    assert.equal(raw[row],0);
    return [...raw.subarray(row+1+x*3,row+4+x*3)];
  };
}
try {
  const {elements}=await client.queryElements({limit:1000});
  const target=elements.find(e=>e.name==='Solid capture target');
  assert(target);
  for(const scenario of ['overlap','clip']) {
    await mode(scenario);
    const bounds=JSON.parse(readFileSync('/tmp/authorized-fixture-geometry.json','utf8'));
    const {image,refusal}=await client.captureElement({id:target.id});
    assert(image,JSON.stringify(refusal));
    const expectedWidth=Math.max(0,Math.min(1024,bounds.x+bounds.width)-Math.max(0,bounds.x));
    assert.equal(image.width,expectedWidth);
    assert.equal(image.height,bounds.height);
    const pixel=pixelRows(image);
    if(scenario==='overlap') {
      assert.deepEqual(pixel(20,30),[24,96,168]);
      assert.deepEqual(pixel(120,30),[208,40,32]);
    } else {
      assert(image.width>16 && image.width<bounds.width,'fixture must truly cross the screen edge');
      assert.deepEqual(pixel(8,30),[24,96,168]);
    }
    console.log(`GEOMETRY ${scenario}: ${image.width}x${image.height}, independent bounds ${JSON.stringify(bounds)}, pixels verified`);
  }
  for(const scenario of ['move','resize']) {
    await mode(scenario);
    let refused=false;
    for(let i=0;i<15;i++) {
      const result=await client.captureElement({id:target.id});
      if(result.refusal?.code==='UnperformableElementError' && JSON.stringify(result.refusal).includes('bounds changed')) {
        assert(!result.image); refused=true; break;
      }
    }
    assert(refused,`${scenario} must trigger changed-bounds refusal`);
    console.log(`GEOMETRY ${scenario}: changed-bounds refusal, no image`);
  }
} finally {
  await mode('normal');
  await client.close();
}
