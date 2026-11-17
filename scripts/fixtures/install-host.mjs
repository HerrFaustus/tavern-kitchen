/* eslint-env browser */
// Minimal Tavern fixture for loading a packaged extension through its real manifest.
export function startFixture() {
    if (window.parent !== window) {
        window.fixture = window.parent.fixture;
        window.SillyTavern = window.parent.SillyTavern;
        return;
    }
    const saved = key => JSON.parse(localStorage.getItem(key) || 'null');
    const chat = saved('chat') || [{name:'旅人',mes:'进镇。',is_user:true,send_date:'u1'}, {name:'店主',mes:'东桥有守卫。',send_date:'a1'}];
    const chat_metadata = saved('metadata') || {};
    const extension_settings = saved('settings') || {};
    const listeners = new Map();
    const event_types = new Proxy({}, {get:(_,name)=>name});
    const eventSource = {
        on(name, handler) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(handler); },
        makeLast(name,handler) { this.on(name,handler); }, makeFirst(name,handler) { this.on(name,handler); },
        once(name, handler) { const once = (...args) => { this.removeListener(name,once); return handler(...args); }; this.on(name,once); },
        removeListener(name,handler) { listeners.get(name)?.delete(handler); }, off(name,handler) { this.removeListener(name,handler); },
        async emit(name,...args) { for (const handler of listeners.get(name) || []) await handler(...args); },
    };
    const ctx = { name1:'旅人', name2:'店主', characterId:0, groupId:null, chatId:localStorage.getItem('fixtureChatId') || '清河县', chat, chatMetadata:chat_metadata, extensionSettings:extension_settings,
        characters:[{name:'店主',avatar:'merchant.png',chat:'清河县'}], groups:[], eventSource,eventTypes:event_types,
        maxContext:8192, getTokenCountAsync:async value=>String(value).length, getRequestHeaders:()=>({'Content-Type':'application/json'}),
        saveMetadata:async()=>{ fixture.writes++; localStorage.setItem('metadata', JSON.stringify(chat_metadata)); },
    };
    ctx.POPUP_TYPE = {INPUT:'input',CONFIRM:'confirm'};
    ctx.POPUP_RESULT = {AFFIRMATIVE:true,NEGATIVE:false};
    ctx.Popup = class {
        constructor(text,type,initial){ Object.assign(this,{text,type,initial}); }
        show(){ return this.type === 'input' ? window.prompt(this.text.textContent,this.initial) : window.confirm(this.text.textContent); }
    };
    const noop = ()=>{};
    const fixture = window.fixture = { ctx,chat,chat_metadata,extension_settings,writes:0,generated:0,event_types,eventSource,extension_prompts:{},requests:[],
        getCurrentChatId:()=>ctx.chatId,getContext:()=>ctx,getCurrentUserHandle:()=> 'fixture-user',getRequestHeaders:ctx.getRequestHeaders,
        saveSettings:async()=>{localStorage.setItem('settings',JSON.stringify(extension_settings)); return true;}, debounce:fn=>fn,
        doNavbarIconClick(){ const node=document.querySelector('#tk-workspace'); node.classList.toggle('closedDrawer', !node.classList.toggle('openDrawer')); },
        getCharaFilename:()=> 'merchant',substituteParams:text=>text,extension_prompt_roles:{SYSTEM:0},extension_prompt_types:{IN_CHAT:1},
        setExtensionPrompt:noop,chat_completion_sources:{CUSTOM:'custom'},world_names:[],selected_world_info:[],INJECTION_POSITION:{},
        SlashCommandParser:{addCommandObject:noop}, SlashCommand:{fromProps:v=>v}, SlashCommandArgument:{fromProps:v=>v}, SlashCommandNamedArgument:{fromProps:v=>v}, ARGUMENT_TYPE:{},
        DOMPurify:{sanitize:text=>text},power_user:{},oai_settings:{},openai_settings:{},openai_setting_names:[], getWorldInfoSettings:()=>({}),
    };
    window.SillyTavern = { getContext:()=>ctx }; window.toastr = {error:noop,warning:noop,info:noop,success:noop};
    window.StoryStringManager = {};
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input,options) => {
        const url=new URL(typeof input === 'string' ? input : input.url,location.href);
        if (url.pathname === '/api/chats/get') return Response.json([{chat_metadata:saved('metadata') || {}}]);
        if (url.pathname === '/api/files/upload') {
            const {name,data}=JSON.parse(options.body);
            localStorage.setItem('file:'+name,new TextDecoder().decode(Uint8Array.from(atob(data),c=>c.charCodeAt(0))));
            return Response.json({path:'/user/files/'+name});
        }
        if (url.pathname.startsWith('/user/files/')) {
            const value=localStorage.getItem('file:'+decodeURIComponent(url.pathname.split('/').pop()));
            return new Response(value,{status:value ? 200 : 404});
        }
        return originalFetch(input, options);
    };
    fixture.storedRows = async (name,table) => {
        if (!(await indexedDB.databases()).some(db => db.name === name)) return [];
        const db = await new Promise((resolve,reject) => {
            const open=indexedDB.open(name);open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
        });
        try {
            return await new Promise((resolve,reject) => {
                const rows=db.transaction(table).objectStore(table).getAll();rows.onsuccess=()=>resolve(rows.result);rows.onerror=()=>reject(rows.error);
            });
        } finally { db.close(); }
    };
    fixture.installOld = async old => {
        const open = (name, upgrade) => new Promise((resolve,reject) => {
            const request = indexedDB.open(name,1);
            request.onupgradeneeded = () => upgrade(request.result);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const archive = await open('TavernKitchen_WorldArchive', db => {
            db.createObjectStore('branches',{keyPath:'branchId'});
            db.createObjectStore('bindings');
            db.createObjectStore('owners',{keyPath:'branchId'}).createIndex('identity','identity');
        });
        const write = (db, names, apply) => new Promise((resolve,reject) => {
            const tx = db.transaction(names,'readwrite'); apply(tx);
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        await write(archive,['branches','owners','bindings'],tx => {
            for(const world of old.branches){
                tx.objectStore('branches').put(world);
                tx.objectStore('owners').put({branchId:world.branchId,identity:old.identity,title:world.title,version:world.version});
            }
            tx.objectStore('bindings').put(old.selected,old.identity);
        });
        archive.close();
        const notes=await open('TavernKitchen.StoryPlanner',db=>db.createObjectStore('notes',{keyPath:'id'}).createIndex('owner','owner'));
        await write(notes,['notes'],tx=>old.notes.forEach(note=>tx.objectStore('notes').put(note))); notes.close();
        localStorage.setItem('metadata', JSON.stringify(old.metadata));
        localStorage.setItem('chat', JSON.stringify(old.chat));
    };
    fixture.generate = async type => { let aborted=false; await eventSource.emit(event_types.GENERATION_STARTED,type,{},false);
        await window.tavernKitchenGenerateInterceptor?.(chat,8192,()=>{aborted=true;},type);
        if (!aborted) fixture.generated++; await eventSource.emit(event_types.GENERATION_ENDED); return !aborted; };
}
