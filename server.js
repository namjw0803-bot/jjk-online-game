const http=require('http');
const fs=require('fs');
const path=require('path');
const WebSocket=require('ws');

const PORT=process.env.PORT||8080;
const HOST='0.0.0.0';
const ROOT=__dirname;
const clients=new Map();

function serve(res,file,type){
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache, no-store, must-revalidate','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
}
function serveGame(res){
  fs.readFile(path.join(ROOT,'index.html'),'utf8',(err,html)=>{
    if(err){res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});return res.end('index read error');}
    let patch='',css='';
    try{patch=fs.readFileSync(path.join(ROOT,'v168_patch.js'),'utf8')}catch{}
    try{css=fs.readFileSync(path.join(ROOT,'v168_patch.css'),'utf8')}catch{}
    if(css)html=html.replace('</style>',css+'\n</style>');
    if(patch){const i=html.lastIndexOf('</script>');if(i>=0)html=html.slice(0,i)+'\n'+patch+'\n'+html.slice(i);}
    html=html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">','<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','X-Content-Type-Options':'nosniff'});
    res.end(html);
  });
}

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/'||u.pathname==='/index.html')return serveGame(res);
  if(u.pathname==='/v168_patch.js')return serve(res,path.join(ROOT,'v168_patch.js'),'application/javascript; charset=utf-8');
  if(u.pathname==='/v168_patch.css')return serve(res,path.join(ROOT,'v168_patch.css'),'text/css; charset=utf-8');
  if(u.pathname==='/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok:true,players:clients.size,uptime:Math.floor(process.uptime()),version:'V168'}));
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');
});

const wss=new WebSocket.Server({server});
let nextId=1;
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function broadcast(room,obj,except=null){for(const [ws,c] of clients){if(ws!==except&&c.room===room)send(ws,obj);}}
function snapshot(room){const players=[];for(const [,c] of clients){if(c.room===room)players.push({id:c.id,state:c.state||{}});}for(const [ws,c] of clients){if(c.room===room)send(ws,{type:'snapshot',players});}}

wss.on('connection',ws=>{
  const c={id:String(nextId++),room:null,state:{},alive:true};clients.set(ws,c);
  ws.on('pong',()=>{c.alive=true});send(ws,{type:'welcome',id:c.id});
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw.toString())}catch{return}
    if(msg.type==='join'){
      c.room=String(msg.room||'AUTO').replace(/[^A-Z0-9_-]/gi,'').slice(0,16)||'AUTO';snapshot(c.room);return;
    }
    if(msg.type==='state'&&c.room){
      const s=msg.state||{};c.state={x:Number(s.x)||0,y:Number(s.y)||0,z:Number(s.z)||0,yaw:Number(s.yaw)||0,visible:s.visible!==false,miniVoid:!!s.miniVoid};
      broadcast(c.room,{type:'state',id:c.id,state:c.state},ws);return;
    }
    if(msg.type==='presence'&&c.room){
      broadcast(c.room,{type:'presence',id:c.id,name:String(msg.name||'PLAYER').slice(0,16),hp:Math.max(0,Math.min(100,Number(msg.hp)||0)),maxHp:100},ws);return;
    }
    if(msg.type==='skill'&&c.room){
      const allowed=new Set(['blue','red','purple','domain','miniVoid','blueOverhead','selfPurple']);const skill=String(msg.skill||'');if(!allowed.has(skill))return;
      broadcast(c.room,{type:'skill',id:c.id,skill,x:Number(msg.x)||0,y:Number(msg.y)||0,z:Number(msg.z)||0,yaw:Number(msg.yaw)||0},ws);return;
    }
    if(msg.type==='chat'&&c.room){
      const name=String(msg.name||'PLAYER').slice(0,16),text=String(msg.text||'').trim().slice(0,120);if(!text)return;
      broadcast(c.room,{type:'chat',id:c.id,name,text},ws);return;
    }
  });
  ws.on('close',()=>{const {room,id}=c;clients.delete(ws);if(room)broadcast(room,{type:'left',id});});
  ws.on('error',()=>{});
});

const heartbeat=setInterval(()=>{for(const [ws,c] of clients){if(!c.alive){try{ws.terminate()}catch{}continue;}c.alive=false;try{ws.ping()}catch{}}},25000);
wss.on('close',()=>clearInterval(heartbeat));
server.listen(PORT,HOST,()=>console.log(`JJK PUBLIC ONLINE V168 server running on ${HOST}:${PORT}`));
