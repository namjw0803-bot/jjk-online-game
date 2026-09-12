const http=require('http');
const fs=require('fs');
const path=require('path');
const WebSocket=require('ws');

const PORT=process.env.PORT||8080;
const HOST='0.0.0.0';
const ROOT=__dirname;

function serve(res,file,type){
  fs.readFile(file,(err,data)=>{
    if(err){
      res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
      return res.end('Not found');
    }
    res.writeHead(200,{
      'Content-Type':type,
      'Cache-Control':'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  });
}

const clients=new Map();

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');

  if(u.pathname==='/' || u.pathname==='/index.html')
    return serve(res,path.join(ROOT,'index.html'),'text/html; charset=utf-8');

  if(u.pathname==='/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      ok:true,
      players:clients.size,
      uptime:Math.floor(process.uptime())
    }));
  }

  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
  res.end('Not found');
});

const wss=new WebSocket.Server({server});
let nextId=1;

function send(ws,obj){
  if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));
}
function broadcast(room,obj,except=null){
  for(const [ws,c] of clients){
    if(ws!==except && c.room===room)send(ws,obj);
  }
}
function snapshot(room){
  const players=[];
  for(const [,c] of clients){
    if(c.room===room)players.push({id:c.id,state:c.state||{}});
  }
  for(const [ws,c] of clients){
    if(c.room===room)send(ws,{type:'snapshot',players});
  }
}

wss.on('connection',(ws)=>{
  const c={
    id:String(nextId++),
    room:null,
    state:{},
    alive:true
  };
  clients.set(ws,c);

  ws.on('pong',()=>{c.alive=true;});
  send(ws,{type:'welcome',id:c.id});

  ws.on('message',(raw)=>{
    let msg;
    try{msg=JSON.parse(raw.toString())}catch{return;}

    if(msg.type==='join'){
      c.room=String(msg.room||'AUTO')
        .replace(/[^A-Z0-9_-]/gi,'')
        .slice(0,16)||'AUTO';
      snapshot(c.room);
      return;
    }

    if(msg.type==='state' && c.room){
      const s=msg.state||{};
      c.state={
        x:Number(s.x)||0,
        y:Number(s.y)||0,
        z:Number(s.z)||0,
        yaw:Number(s.yaw)||0,
        visible:s.visible!==false,
        miniVoid:!!s.miniVoid
      };
      broadcast(c.room,{type:'state',id:c.id,state:c.state},ws);
    }
  });

  ws.on('close',()=>{
    const {room,id}=c;
    clients.delete(ws);
    if(room)broadcast(room,{type:'left',id});
  });

  ws.on('error',()=>{});
});

// Keep public WebSocket connections healthy through proxies / cloud hosts.
const heartbeat=setInterval(()=>{
  for(const [ws,c] of clients){
    if(!c.alive){
      try{ws.terminate()}catch{}
      continue;
    }
    c.alive=false;
    try{ws.ping()}catch{}
  }
},25000);

wss.on('close',()=>clearInterval(heartbeat));

server.listen(PORT,HOST,()=>{
  console.log(`JJK PUBLIC ONLINE server running on ${HOST}:${PORT}`);
});
