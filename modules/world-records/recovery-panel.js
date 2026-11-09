import { turnEffectConflicts } from './turn-ledger.js';

// History remains in the existing data page; it never displays event titles or
// hidden world contents. A restore forks the selected prefix, preserving the old branch.
export function createWorldRecoveryPanel({ service, getIdentity, getStamp, readState = () => service.read() }) {
    let root, doc, epoch=0, request=0, editing=false, busy=false, loading=false, message='', viewed, statusNode;
    const el = (tag,text,className) => {
        const node=doc.createElement(tag);
        if (text !== undefined) node.textContent=text;
        if (className) node.className=className;
        return node;
    };
    const button = (text,action) => { const node=el('button',text,'btn btn-sm');node.type='button';node.addEventListener('click',action);return node; };
    const label = (text,control) => { const node=el('label',undefined,'tk-world-history-field');node.append(el('span',text),control);control.setAttribute('aria-label',text);return node; };
    const select = (items,value) => {
        const node=el('select',undefined,'text_pole');
        for (const [key,title] of items) { const option=el('option',title);option.value=String(key);node.append(option); }
        node.value=String(value);return node;
    };
    const branchLabel = item => `分支 ${item.branchId.slice(-8)} · 第 ${item.version} 版`;
    function valid(owner,scope,stamp) { return owner === getIdentity() && scope === service.scopeVersion() && stamp === getStamp(); }
    function errorView(error) {
        if (!root) return;
        viewed=statusNode=null;
        root.hidden=false;const details=el('details',undefined,'tk-world-history');details.open=true;
        details.append(el('summary','世界版本与恢复'),el('p',`${message ? '已切换，但' : ''}读取世界版本失败：${error.message || '请重试。'}`,'settings-hint'));
        details.append(button('重新读取',()=>{refresh().catch(error=>errorView(error));}));root.replaceChildren(details);
    }
    async function show(state) {
        if (!root || editing || busy) return;
        const token=epoch, serial=++request, owner=getIdentity(), scope=service.scopeVersion(), stamp=getStamp();
        let branches=[];
        try { if (owner && state) branches=await service.branches(); }
        catch (error) {
            if (token === epoch && serial === request && owner === getIdentity()) errorView(error);
            return;
        }
        if (token !== epoch || serial !== request || editing || busy || !valid(owner,scope,stamp)) return;
        if (state && !branches.some(item=>item.branchId===state.branchId && item.version===state.version)) {
            errorView(new Error('世界已变化，请重新读取。'));return;
        }
        const wasOpen=!!root.querySelector('details')?.open;
        root.hidden=false;root.replaceChildren();
        const details=el('details',undefined,'tk-world-history');details.open=wasOpen;
        details.append(el('summary','世界版本与恢复'));
        if (message) { const saved=el('p',message,'settings-hint');saved.setAttribute('role','status');details.append(saved);message=''; }
        if (!owner || !state) { viewed=statusNode=null;details.append(el('p',owner ? '当前聊天还没有世界记录。' : '选择聊天后可查看世界版本。','settings-hint'));root.append(details);return; }
        details.append(el('p',`当前${branchLabel(state)}`,'settings-hint'));
        details.append(el('p','恢复会建立新分支，原分支仍可切回。聊天和剧情总结不会回退；编剧札记按分支独立保存。当前总结和地图仍可能重新提供资料。后厨卡只包含导出时的当前分支。','settings-hint'));
        const conflicts=turnEffectConflicts(state);
        const recommended=conflicts.length ? Math.max(0,conflicts.reduce((min,receipt)=>Math.min(min,receipt.version),state.version)-1) : Math.max(0,state.version-1);
        if (conflicts.length) {
            const hint=el('p',`已写入变化的正文来源有变，建议恢复到第 ${recommended} 版或更早，再核对世界。`,'settings-hint');hint.setAttribute('role','status');details.append(hint);
        }
        const status=el('p',undefined,'settings-hint');status.setAttribute('role','status');
        viewed={owner,scope,stamp,branchId:state.branchId,version:state.version};statusNode=status;
        const confirmation=el('div',undefined,'tk-world-history-confirm');
        const retry=button('重新读取',()=>{editing=false;refresh().catch(error=>{status.setAttribute('role','alert');status.textContent=error.message;});});
        const actions=[];
        const guard=()=>{if (!valid(owner,scope,stamp)) throw new Error('聊天、总结或世界已变化，请重新读取后再操作。');return true;};
        const run = async task => {
            if (busy) return;
            busy=true;const actionEpoch=epoch;
            const controls=[...details.querySelectorAll('button,input,select')];const disabled=controls.map(node=>node.disabled);
            controls.forEach(node=>{node.disabled=true;});status.setAttribute('role','status');status.textContent='正在保存…';
            try {
                if (!guard()) throw new Error('聊天、总结或世界已变化，请重新读取后再操作。');
                const next=await task();
                if (actionEpoch !== epoch || owner !== getIdentity()) return;
                message=`已切换到第 ${next.version} 版；原分支保留。`;
                editing=false;busy=false;
                await refresh();
            } catch (error) {
                if (actionEpoch === epoch && owner === getIdentity()) {status.setAttribute('role','alert');status.textContent=error.message || '操作失败，请重新读取后重试。';}
            } finally {
                if (actionEpoch === epoch) {busy=false;controls.forEach((node,index)=>{node.disabled=disabled[index];});}
            }
        };
        function confirm(kind,description,task) {
            editing=true;confirmation.replaceChildren(el('p',description,'settings-hint'));
            const inputs=[...details.querySelectorAll('select,input')], disabled=inputs.map(node=>node.disabled);
            inputs.forEach(node=>{node.disabled=true;});
            const yes=button(kind==='fork' ? '确认恢复' : '确认切换',()=>run(task));
            const cancel=button('取消',()=>{confirmation.replaceChildren();editing=false;actions.forEach(node=>{node.disabled=false;});inputs.forEach((node,index)=>{node.disabled=disabled[index];});});
            confirmation.append(yes,cancel);actions.forEach(node=>{node.disabled=true;});yes.focus();
        }
        if (state.version > 0) {
            const versions=new Set([0,recommended,state.version-1]);
            for (const event of state.events.slice(-120)) if (event.version > 0) versions.add(event.version-1);
            const choices=[...versions].filter(value=>value>=0 && value<state.version).sort((a,b)=>b-a).map(version=>{
                const at=version ? state.events[version-1]?.at : '', date=at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleString() : '';
                return [version,`第 ${version} 版${version===0 ? ' · 初始' : date ? ' · '+date : ''}${conflicts.length && version===recommended ? ' · 建议' : ''}`];
            });
            choices.push(['custom','输入其他版本']);
            const version=select(choices,recommended), custom=el('input',undefined,'text_pole');
            custom.type='number';custom.min='0';custom.max=String(state.version-1);custom.step='1';custom.value=String(recommended);custom.hidden=true;
            const customLabel=label('其他世界版本',custom);customLabel.hidden=true;
            version.addEventListener('change',()=>{editing=true;custom.hidden=customLabel.hidden=version.value!=='custom';});
            custom.addEventListener('input',()=>{editing=true;});
            const restore=button('恢复到此版本',()=>{
                const value=version.value==='custom' ? custom.value : version.value;
                const target=Number(value);
                if (!value.trim() || !Number.isSafeInteger(target) || target<0 || target>=state.version) {
                    status.setAttribute('role','alert');status.textContent='请输入当前版本之前的有效版本号。';return;
                }
                confirm('fork',`从第 ${target} 版建立新世界分支？该版本之后的世界变化不进入新分支；原分支保留。聊天和总结不变。`,
                    ()=>service.fork(state,target,{guard}));
            });
            actions.push(restore);details.append(label('恢复到的世界版本',version),customLabel,restore);
        }
        if (branches.length>1) {
            const options=branches.slice().sort((a,b)=>a.branchId===state.branchId?-1:b.branchId===state.branchId?1:a.branchId.localeCompare(b.branchId));
            const target=select(options.map(item=>[item.branchId,branchLabel(item)+(item.branchId===state.branchId?' · 当前':'')]),state.branchId);
            const change=button('切换分支',()=>{
                if (!target.value || target.value===state.branchId) {status.setAttribute('role','alert');status.textContent='请选择另一条分支。';return;}
                const chosen=options.find(item=>item.branchId===target.value);
                if (!chosen) return;
                confirm('select',`切换到${branchLabel(chosen)}？当前分支保留。聊天和总结不变；如正文来源已改变，仍需核对。`,
                    ()=>service.selectBranch(chosen.branchId,state,{guard}));
            });
            target.addEventListener('change',()=>{editing=true;});actions.push(change);details.append(label('保留的世界分支',target),change);
        }
        details.append(confirmation,retry,status);root.append(details);
    }
    async function refresh() {
        if (!root || busy || loading) return;
        editing=false;loading=true;const owner=getIdentity(),token=epoch;
        try {
            const state=owner ? await readState() : null;
            if (token===epoch && owner===getIdentity()) {loading=false;await show(state);}
        } catch (error) { if (token===epoch && owner===getIdentity()) errorView(error); }
        finally { if (token===epoch) loading=false; }
    }
    return {
        mount(target) {root=target;doc=target.ownerDocument;},
        refresh,
        noteChange(state) {
            if (!viewed || !statusNode || busy || loading) return;
            const stale=()=>{statusNode.setAttribute('role','alert');statusNode.textContent='聊天、总结或世界已变化，请重新读取。';};
            try { if (valid(viewed.owner,viewed.scope,viewed.stamp) && state?.branchId===viewed.branchId && state?.version===viewed.version) return; }
            catch {stale();return;}
            stale();
        },
        reset() {epoch++;request++;editing=busy=loading=false;viewed=statusNode=null;message='';if(root){root.replaceChildren();root.hidden=true;}},
    };
}
