import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, 'output'), {recursive:true});
const temp = mkdtempSync(path.join(root, 'output/place-ui-'));
const entry = path.join(temp, 'fixture.js');
writeFileSync(entry, `
import { createApp, nextTick } from 'vue';
import { mapLocalConditions } from '../../modules/story-state/ambient.js';
import MapApp from '../../modules/xiaobai-os/apps/map/ui/MapApp.vue';
const state = {chatIdentity:'fiction',status:'ready',map:{atlas:{
    locations:[{key:'world',name:'群岛',scale:'world'},{key:'coast',parent:'world',name:'北岸',scale:'region'},
        {key:'dock',parent:'coast',scale:'outdoor',name:'旧渡口',brief:'从集市可以望见吊机和仓门。',atmosphere:'潮气裹着煤灰',
            features:[{name:'吊机',description:'岸边的旧吊机',state:'停用',purpose:'装卸货箱',placement:{bearing:'W',relativeTo:'仓门'}},{name:'仓门',placement:{bearing:'N'}},'旧桶']},
        {key:'town',parent:'coast',scale:'city',name:'集市'},{key:'inn',parent:'coast',scale:'building',name:'旅舍'}],
    links:[{id:'1',from:'dock',to:'town',kind:'path',bidirectional:false}],
    actors:[{actorKey:'player',locationKey:'dock'}]},scenes:{}}};
let publish;
const bridge = {subscribe:listener=>{publish=listener;return ()=>{};}, request:async()=>({result:{presets:[],bindings:{}}})};
async function inspect() {
    createApp(MapApp,{initialState:state,bridge}).mount('#app');
    await nextTick();
    const click = async element => {
        if (!element) throw new Error('缺少控件');
        element.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await nextTick();
    };
    const named = label => Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===label);
    const labelled = label => document.querySelector('[aria-label="'+label+'"]');
    const title = () => document.querySelector('article h3').textContent;
    const rows = () => Array.from(document.querySelectorAll('.geo-row')).map(row=>row.textContent);
    const initial = rows();
    const atmosphere = document.querySelector('article').textContent;
    const here = () => document.querySelector('article [aria-label="此刻"]');
    const beforeFestival = here() === null;
    const world = {worldId:'islands',branchId:'main',entities:[],modules:{story:{records:[]}}};
    const festival = {id:'lights',title:'河灯节',kind:'situation',flavor:'scenery',scope:'旧渡口',status:'open',phase:'开市',impact:'灯摊占着青石坡，挑担的人侧身上岸。'};
    const deliver = async status => {
        world.modules.story.records = [{record:{...festival,status},end:7,version:1,nature:'established_fact'}];
        const localConditions = mapLocalConditions(world,null,state.map.atlas);
        publish({type:'map/state',payload:{state:{...state,localConditions}}});
        await nextTick();
    };
    await deliver('open');
    const duringFestival = here()?.textContent;
    await click(Array.from(document.querySelectorAll('article .mention')).find(b=>b.textContent==='集市'));
    const nearby = here() === null;
    await deliver('done');
    await click(named('回到当前位置'));
    const afterFestival = here() === null && document.querySelector('article').textContent.includes('潮气裹着煤灰');
    const mention = name => Array.from(document.querySelectorAll('article .mention')).find(b=>b.textContent===name);
    await click(mention('集市'));
    const fromProse = title();
    await click(named('回到当前位置'));
    await click(mention('吊机'));
    const fromFeatureLink = title();
    await click(named('局部地图'));
    const local = labelled('局部示意图');
    const relative = local.querySelector('[aria-label="参照：仓门"] [data-bearing="W"] button');
    const absolute = local.querySelector('[aria-label="参照：旧渡口"] [data-bearing="N"] button');
    const unknown = local.querySelector('.unplaced button').textContent;
    await click(absolute);
    const north = title();
    await click(relative);
    const west = title();
    await click(named('地点列表'));
    await click(labelled('收起群岛'));
    const collapsed = rows().length;
    await click(labelled('展开群岛'));
    await click(Array.from(document.querySelectorAll('.entry')).find(entry=>entry.textContent.includes('吊机')));
    const feature = document.querySelector('article').textContent;
    await click(named('区域地图'));
    const edges = document.querySelectorAll('.atlas line').length;
    const oneWay = !!document.querySelector('.atlas line[marker-end]');
    const mapNodes = document.querySelectorAll('.atlas [role=button]').length;
    await click(labelled('查看集市'));
    const destination = title();
    const incoming = document.querySelector('article li').textContent;
    await click(named('旧渡口'));
    const outbound = Array.from(document.querySelectorAll('article li button')).find(b=>b.textContent==='集市').parentElement.textContent;
    await click(labelled('查看旅舍'));
    await click(named('回到当前位置'));
    const controlHeight = document.querySelector('.place-index > footer').getBoundingClientRect().height;
    const dataHeight = document.querySelector('.place-index > .tk-module-data').getBoundingClientRect().height;
    const settingsOpen = !document.querySelector('.place-index > footer [data-setting-section="function"]').hidden;
    return {controlRatio:controlHeight / (controlHeight + dataHeight),settingsOpen,nearby,beforeFestival,duringFestival,afterFestival,fromProse,fromFeatureLink,north,west,unknown,initial,collapsed,atmosphere,feature,edges,oneWay,mapNodes,destination,incoming,outbound,current:title(),player:state.map.atlas.actors[0].locationKey};
}
inspect().then(result=>fetch('/result',{method:'POST',body:JSON.stringify(result)}))
    .catch(error=>fetch('/result',{method:'POST',body:JSON.stringify(String(error))}));
`);
await build({configFile:false,root,define:{'process.env.NODE_ENV':'"production"'},plugins:[vue()],logLevel:'error',
    build:{outDir:path.join(temp,'build'),lib:{entry,name:'PlaceCheck',formats:['iife'],fileName:()=>'fixture.js'}}});
const styles = readdirSync(path.join(temp,'build')).filter(file=>file.endsWith('.css'))
    .map(file=>readFileSync(path.join(temp,'build',file),'utf8')).join('\n');
const {promise,resolve,reject}=Promise.withResolvers();
const server = http.createServer((req,res)=>{
    if (req.url === '/result' && req.method === 'POST') {
        let body='';
        req.setEncoding('utf8').on('data',part=>{body+=part;}).on('end',()=>{res.end();resolve(body);});
    } else if (req.url === '/fixture.js') {
        res.setHeader('Content-Type','text/javascript');
        res.end(readFileSync(path.join(temp,'build/fixture.js')));
    } else {
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.end('<!doctype html><meta charset="utf-8"><style>html,body,#app{height:100%;margin:0}' + styles + '</style><div id="app"></div><script src="/fixture.js"></script>');
    }
});
await new Promise(ready=>server.listen(0,'127.0.0.1',ready));
const child=spawn(process.env.CHROMIUM_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless','--disable-extensions','--no-first-run','--user-data-dir='+path.join(temp,'profile'),'http://127.0.0.1:'+server.address().port],{windowsHide:true,stdio:'ignore'});
child.on('error',reject);
const timeout=setTimeout(()=>reject(new Error('Browser timed out')),30000);
try {
    const result=JSON.parse(await promise);
    assert.deepEqual(result.initial.slice(0,4).map(value=>value.replace(/\s+/g,'')),['▾世界群岛','▾地区北岸','▾地点旧渡口·当前位置','地点要素吊机']);
    assert.deepEqual([result.fromProse,result.fromFeatureLink,result.north,result.west,result.unknown],['集市','吊机','仓门','吊机','旧桶']);
    assert.ok(Math.abs(result.controlRatio - 1 / 3) < .015, JSON.stringify(result));
    assert.equal(result.settingsOpen,true);
    assert.equal(result.nearby,true);
    assert.equal(result.beforeFestival,true);
    assert.match(result.duringFestival,/河灯节.*灯摊占着青石坡/s);
    assert.equal(result.afterFestival,true);
    assert.equal(result.collapsed,1);
    assert.match(result.atmosphere,/潮气裹着煤灰/);
    assert.match(result.feature,/装卸货箱/);
    assert.equal(result.edges,1); assert.equal(result.oneWay,true); assert.equal(result.mapNodes,3);
    assert.equal(result.current,'旧渡口'); assert.equal(result.player,'dock');
    assert.match(result.feature,/岸边的旧吊机.*停用/s);
    assert.equal(result.destination,'集市');
    assert.match(result.outbound,/通往/);
    assert.match(result.incoming,/来自/);
    console.log('四层折叠、要素、地图交互及渡口平日／节中／节后重访通过');
} finally {
    clearTimeout(timeout); child.kill(); server.closeAllConnections(); server.close();
}
