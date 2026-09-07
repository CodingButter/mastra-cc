import assert from 'node:assert/strict';
// The oracle consumes only predeclared bytes and the public model transcript.
export function validateTrace(events, trial, saved, expected) {
  assert.equal(trial.kind,'mousepad-literal-replacement');
  assert.equal(trial.count,3);
  assert.ok(trial.source && trial.replacement && !trial.replacement.includes(trial.source));
  assert.deepEqual(saved,expected,'entire saved document must match predeclared bytes');
  assert.equal(saved.toString('utf8').split(trial.replacement).length-1,3);
  const calls=new Map(), settled=new Set(), known=new Map(), ledger=[];
  let sourceEdit, replacementEdit, replace, save, verified, finished;
  function elements(value) {
    if(!value||typeof value!=='object')return [];
    if(typeof value.id==='string'&&typeof value.role==='string')return [value];
    return Object.values(value).flatMap(elements);
  }
  for(let i=0;i<events.length;i++) {
    const event=events[i];assert.equal(event.sequence,i+1,'complete ordered journal');
    assert.ok(!['failure','deadline','tool-error'].includes(event.event),'failed session');
    if(event.event==='call') {
      assert.ok(!finished,'calls after final answer');assert.ok(!calls.has(event.call),'duplicate call');
      const id=event.arguments?.id;
      if(id) {
        assert.ok(known.has(id),'ID must originate in preceding public result');
        const prior=known.get(id);ledger.push({call:event.call,id,evidenceCall:prior.call,evidenceSequence:prior.sequence,element:prior.element});
        event.selectedEvidence=prior;
      }
      calls.set(event.call,event);
    }
    if(event.event==='result') {
      const call=calls.get(event.call);assert.ok(call,'result without call');assert.ok(!settled.has(event.call),'duplicate result');
      assert.equal(event.name,call.name);settled.add(event.call);
      assert.ok(!event.result?.refusal,'refused tool call');
      const prior=call.selectedEvidence?.element;
      if(call.name==='setElementText') {
        const label=prior?.compositeObservation;
        assert.ok(label?.kind==='available'&&label.provenance==='immediate-combo-parent','pre-edit field evidence');
        if(call.arguments.text===trial.source) {assert.equal(label.label,'Search for:');sourceEdit=event;}
        else if(call.arguments.text===trial.replacement) {assert.equal(label.label,'Replace with:');replacementEdit=event;}
        else assert.fail('unexpected direct text edit');
      }
      if(call.name==='activateElement'&&/^Replace(?: All)?$/.test(prior?.name?.trim()??'')) {
        assert.ok(sourceEdit&&replacementEdit,'fields before replacement');replace=event;
      }
      if(call.name==='activateElement'&&prior?.name?.trim()==='Save') {assert.ok(replace,'replacement before save');save=event;}
      if(save&&['readElementContent','queryElements'].includes(call.name)&&call.sequence>save.sequence) {
        const observations=call.name==='readElementContent' ? [{role:prior?.role,content:event.result?.content}] : elements(event.result);
        if(observations.some(e=>['text','textbox'].includes(e.role)&&e.content?.kind==='text'&&e.content.value===expected.toString('utf8')))verified=event;
      }
      for(const element of elements(event.result))known.set(element.id,{element,call:event.call,sequence:event.sequence});
    }
    if(event.event==='model-finished') {
      assert.ok(!finished,'duplicate completion');assert.ok(save&&verified,'fresh document text after save before final answer');
      assert.equal(settled.size,calls.size,'unfinished tools');finished=event;
    }
  }
  assert.ok(finished,'model unfinished');
  assert.ok(events.at(-1)?.event==='closed'&&events.at(-1).active===0,'unsettled driver');
  return {machine:'GREEN',oracle:'GREEN',visual:'REVIEW_PENDING',human:'PENDING',ledger,sourceEdit:sourceEdit.call,replacementEdit:replacementEdit.call,replace:replace.call,save:save.call,verification:verified.call};
}
