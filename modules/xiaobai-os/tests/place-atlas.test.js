import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapPromptRuntime } from '../apps/map/host/prompt-runtime.ts';
import { createEmptyMapDomain } from '../domains/map/state.ts';
import { parseMapDomain } from '../domains/map/invariants.ts';
import { buildMapPromptBlock } from '../domains/map/projection.ts';
import { compileAtlasIntent } from '../apps/map/tools/atlas-intent-compiler.ts';
import { readAtlas } from '../apps/map/tools/atlas-reader.ts';
import { MAP_MAINTENANCE_TOOLS } from '../apps/map/tools/tool-contract.ts';
import { createMapManagementTools } from '../apps/map/management/tool-contract.ts';
import { linkPlaceMentions, mentionIndex } from '../apps/map/ui/place-mentions.ts';
import { buildAtlasTree } from '../apps/map/ui/atlas-tree.ts';
import { layoutWorldMap } from '../apps/map/ui/world-map.ts';
import { placeFeatures } from '../domains/map/features.ts';

test('the map writes, reloads and projects named features and directed links using atlas tools only', () => {
    const player = { actorKey: 'player', displayName: '旅人' };
    const edits = {
        locations: [
            { key:'harbor', name:'港区', scale:'region' },
            { key:'quay', parent:'harbor', name:'码头', scale:'outdoor', features:['旧吊机','售票亭'] },
            { key:'station', parent:'harbor', name:'车站', scale:'building' },
        ],
        links:[{ from:'quay', to:'station', kind:'road', bidirectional:false, label:'货运便道' }],
        actors:[{ ...player, locationKey:'quay' }],
    };
    const compiled = compileAtlasIntent(createEmptyMapDomain(), edits, player);
    assert.equal(compiled.result.ok, true, JSON.stringify(compiled.result));
    const saved = parseMapDomain(JSON.parse(JSON.stringify(compiled.domain)));
    const document = readAtlas(saved,{mode:'document'}).data;
    assert.deepEqual(document.atlas.locations.find(p => p.key === 'quay').features, [{name:'旧吊机'},{name:'售票亭'}]);
    assert.equal(document.atlas.links[0].bidirectional,false);
    assert.match(buildMapPromptBlock(saved),/旧吊机/);
    for (const tools of [MAP_MAINTENANCE_TOOLS, createMapManagementTools().map(t=>t.definition)]) {
        assert.deepEqual(tools.map(t=>t.function.name),['MapAtlasRead','MapAtlasEdit']);
    }
    assert.equal(compileAtlasIntent(saved,{locations:[{key:'quay',name:'码头',features:[42]}]},player).result.ok,false);
});

test('older named scene elements are readable while secrets and duplicate labels stay out of the place entry', () => {
    const place = { sceneKey:'quay' };
    const map = { scenes:{ quay:{ elements:[
        {category:'marker', label:'栈桥'}, {category:'label', label:'栈桥'}, {category:'secret', label:'暗门'}, {category:'wall'},
    ] } } };
    assert.deepEqual(placeFeatures(map,place),[{name:'栈桥'}]);
    assert.deepEqual(placeFeatures(map,{...place,features:[]}),[]);
});

test('partial landmark updates survive reload, repeated delivery and explicit removal', () => {
    const player = {actorKey:'player',displayName:'旅人'};
    const compile = (domain, location) => compileAtlasIntent(domain,{ locations:[location] },player);
    const place = {key:'port',name:'港口',scale:'region'};
    const begin = compile(createEmptyMapDomain(),{...place,features:['售票亭','吊机']}).domain;
    const patch = (domain, updates) => compile(domain,{...place,featureUpdates:updates});
    const first = patch(begin,[{name:'售票亭',description:'墙上留着班次表',state:'营业中'}]);
    const edited = patch(first.domain,[{name:'售票亭',state:'已封窗'}]);
    const repeat = patch(parseMapDomain(JSON.parse(JSON.stringify(edited.domain))),[{name:'售票亭',state:'已封窗'}]);
    assert.deepEqual(repeat.domain,edited.domain);
    assert.deepEqual(placeFeatures(repeat.domain,repeat.domain.atlas.locations[0]),[
        {name:'售票亭',description:'墙上留着班次表',state:'已封窗'},{name:'吊机'},
    ]);
    assert.equal(patch(repeat.domain,[{name:'吊机',state:3}]).result.ok,false);
    assert.deepEqual(patch(repeat.domain,[{name:'售票亭',description:null},{name:'吊机',remove:true}]).domain.atlas.locations[0].features,
        [{name:'售票亭',state:'已封窗'}]);
});

test('foreground uses current path and exits, plus places relevant to this request; browsing and old turns do not relocate the player', async () => {
    const player = {actorKey:'player',displayName:'旅人'};
    const locations = [
        {key:'coast',name:'海岸',scale:'region'}, {key:'port',parent:'coast',name:'港区',scale:'city'},
        {key:'dock',parent:'port',name:'码头',scale:'outdoor',featureUpdates:[{name:'售票亭',state:'已封窗'}]},
        {key:'market',parent:'port',name:'集市',scale:'outdoor'},
        {key:'island',name:'雾岛',scale:'region',brief:'海峡外的岛屿',featureUpdates:[{name:'铜钟',state:'破损'}]},
        {key:'valley',name:'隐谷',scale:'region'},
    ];
    const map = compileAtlasIntent(createEmptyMapDomain(), {locations,actors:[{...player,locationKey:'dock'},
        {actorKey:'keeper',displayName:'守钟人',locationKey:'island'}],
        links:[{from:'dock',to:'market',kind:'road',bidirectional:false}]},player).domain;
    let events, block;
    const runtime = createMapPromptRuntime({ readCurrentMap:()=>map,setPrompt:text=>{block=text;},subscribe:handlers=>{events=handlers;return ()=>{};} });
    await runtime.startBackground();
    const chat = [{is_user:true,mes:'隐谷在哪里？'},{mes:'在山后。'},{is_user:true,mes:'我们看看售票亭。'}];
    events.intercept(chat,'normal');
    assert.match(block,/海岸 › 港区 › 码头/); assert.match(block,/已封窗/); assert.match(block,/集市/);
    assert.doesNotMatch(block,/隐谷|雾岛/);
    chat.push({mes:'守钟人提起了铜钟。'});
    events.intercept(chat,'continue'); assert.match(block,/雾岛/); assert.match(block,/破损/); assert.doesNotMatch(block,/隐谷/);
    events.intercept(chat,'swipe'); assert.doesNotMatch(block,/雾岛/);
    chat.push({is_user:true,mes:'想去雾岛。'}); events.intercept(chat,'normal');
    assert.ok(Array.from(block).length <= 800);
    assert.match(block,/当前位置：码头/); assert.match(block,/海峡外的岛屿/);
    events.requestBuilt(); assert.equal(block,''); await runtime.stopBackground();
});

test('四层图册保存有依据的词条、方位和要素，局部更新可重放', () => {
    const player = {actorKey:'player',displayName:'旅人'};
    const make = (domain, locations) => compileAtlasIntent(domain,{locations},player);
    const root = {key:'sea',name:'群岛',scale:'world',customs:'依潮历记日'};
    const region = {key:'shore',parent:'sea',name:'北岸',scale:'region',landscape:'黑沙海岸'};
    const place = {key:'quay',parent:'shore',name:'码头',scale:'outdoor',bearing:'N',life:'清晨卸盐',
        atmosphere:'潮气裹着煤灰',featureUpdates:[{name:'吊机',positionHint:'栈桥尽头',purpose:'装卸盐袋',history:'旧铭牌有磨痕'}]};
    const built = make(createEmptyMapDomain(),[place,region,root,{key:'south',name:'货站',parent:'shore',scale:'building',bearing:'S'}]);
    assert.equal(built.result.ok,true);
    const saved = parseMapDomain(JSON.parse(JSON.stringify(built.domain)));
    const tree = buildAtlasTree(saved);
    const quay = tree[0].children[0].children.find(node => node.key==='quay');
    assert.deepEqual([tree[0].name,tree[0].children[0].name,quay.name,quay.children[0].name],['群岛','北岸','码头','吊机']);
    const locations = saved.atlas.locations.filter(location=>location.parent==='shore');
    const layout = layoutWorldMap(saved.atlas,{locations,positionParent:'shore'});
    assert.ok(layout.nodes.find(n=>n.location.key==='quay').y < layout.nodes.find(n=>n.location.key==='south').y);
    const changes = [{key:'quay',name:'码头',access:'夜里封闸',life:null,featureUpdates:[{name:'吊机',purpose:null,state:'停用'}]}];
    const edited = make(saved,changes);
    assert.deepEqual(make(edited.domain,changes).domain,edited.domain);
    const match = readAtlas(edited.domain,{mode:'locations',query:'旧铭牌'}).data.locations[0];
    assert.equal(match.atmosphere,'潮气裹着煤灰');
    assert.equal(match.bearing,'N');
    assert.equal(match.access,'夜里封闸');
    assert.equal(match.life,undefined);
    assert.deepEqual(match.features,[{name:'吊机',positionHint:'栈桥尽头',history:'旧铭牌有磨痕',state:'停用'}]);
    assert.equal(make(saved,[{key:'quay',name:'码头',atmosphere:123}]).result.ok,false);
    assert.equal(make(saved,[{key:'quay',name:'码头',bearing:'up'}]).result.ok,false);
});

test('旧聊天缺少归属时仍可浏览全部地点，同名地点按所属世界区分', () => {
    const locations = [{key:'a',scale:'world',name:'甲'}, {key:'b',scale:'world',name:'乙'},
        ...['a','b'].flatMap(key => [
            {key:key+'r',parent:key,scale:'region',name:'港区'},
            {key:key+'p',parent:key+'r',scale:'outdoor',name:'码头',features:['钟']},
        ]),
        {key:'old',scale:'outdoor',name:'无名湾',features:['礁石']}];
    const map = {scenes:{},atlas:{locations}};
    const before = structuredClone(map);
    const roots = buildAtlasTree(map);
    assert.deepEqual(roots.map(world=>world.children[0].children[0].key),['ap','bp','old']);
    assert.equal(roots[2].children[0].children[0].children[0].name,'礁石');
    assert.deepEqual(map,before);
});

test('local placements survive replay and removal of a reference feature clears only dependent placements', () => {
    const player = {actorKey:'player',displayName:'旅人'};
    const dock = {key:'dock',parent:'coast',scale:'outdoor',name:'码头'};
    const region = {key:'coast',name:'海岸',scale:'region'};
    const changes = [{name:'吊机',placement:{bearing:'W',relativeTo:'仓门'},state:'停用'},{name:'仓门',placement:{bearing:'N'}}];
    const first = compileAtlasIntent(createEmptyMapDomain(),{locations:[region,{...dock,featureUpdates:changes}],
        actors:[{...player,locationKey:'dock'}]},player);
    assert.equal(first.result.ok,true);
    const saved = parseMapDomain(JSON.parse(JSON.stringify(first.domain)));
    const patch = updates => compileAtlasIntent(saved,{locations:[{...dock,featureUpdates:updates}]},player);
    assert.deepEqual(patch(changes).domain,saved);
    assert.match(buildMapPromptBlock(saved,'看吊机'),/仓门的西侧/);
    for (const placement of [{bearing:'up'},{bearing:'N',relativeTo:'海岸'},{bearing:'W',relativeTo:'吊机'}]) {
        assert.equal(patch([{name:'吊机',placement}]).result.ok,false);
    }
    const removed = patch([{name:'仓门',remove:true}]);
    assert.deepEqual(removed.domain.atlas.locations.find(p=>p.key==='dock').features,[{name:'吊机',state:'停用'}]);
    const cleared = patch([{name:'仓门',placement:null}]);
    assert.deepEqual(cleared.domain.atlas.locations.find(p=>p.key==='dock').features[0].placement,changes[0].placement);
});

test('panorama links preserve ambiguous names, word boundaries, markup text and the longest exact landmark', () => {
    const locations = [{name:'北门',key:'a'},{name:'北门',key:'b'},{name:'Dock',key:'c'}];
    const names = mentionIndex(locations,'owner',[{name:'门'},{name:'旧吊机'},{name:'吊机'}]);
    const line = '北门旁的旧吊机 <img> Dockyard Dock';
    const parts = linkPlaceMentions(line,names,{key:'owner'});
    assert.equal(parts.map(p=>p.text).join(''),line);
    assert.deepEqual(parts.filter(p=>p.target).map(p=>p.text),['旧吊机','Dock']);
});
