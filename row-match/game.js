// ===== CANVAS =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

const W = canvas.width;
const H = canvas.height;

// ===== HELPERS =====
const rand = (a,b)=>Math.random()*(b-a)+a;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

function rectHit(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x &&
         a.y < b.y+b.h && a.y+a.h > b.y;
}

// ===== LOAD IMAGES =====
function load(src){
  return new Promise((res,rej)=>{
    const i=new Image();
    i.onload=()=>res(i);
    i.onerror=rej;
    i.src=src;
  });
}

const FILES={
  idle:"assets/idle.png",
  jump:"assets/jump.png",
  fall:"assets/fall.png",
  run:[...Array(7)].map((_,i)=>`assets/run${i+1}.png`),
  enemies:["assets/enemy1.png","assets/enemy2.png","assets/enemy3.png"]
};

let IMG;

// ===== GAME STATE =====
const game={
  running:false,
  over:false,
  score:0,
  time:0,
  speed:420,
  gravity:2400,
  groundY:H-90,
  shake:0
};

const player={
  x:140,
  y:0,
  vy:0,
  w:80,
  h:120,
  anim:"idle",
  frame:0,
  ft:0,
  fr:0.09,
  onGround:true,
  coyote:0,
  buffer:0
};

let enemies=[];
let platforms=[];
let enemyT=1.2;
let platformT=2.4;

// ===== RESET =====
function reset(){
  game.running=true;
  game.over=false;
  game.score=0;
  game.time=0;
  game.speed=420;
  enemies=[];
  platforms=[];
  enemyT=1.2;
  platformT=2.4;

  player.y=game.groundY-player.h;
  player.vy=0;
  player.onGround=true;
  player.anim="run";
  player.frame=0;
  player.coyote=0;
  player.buffer=0;

  statusEl.textContent="Space / Tap to jump";
}

// ===== INPUT =====
window.addEventListener("keydown",e=>{
  if(e.code==="Space"){
    e.preventDefault();
    if(!game.running)return;
    player.buffer=0.12;
  }
  if(e.code==="KeyR" && game.over) reset();
});
window.addEventListener("pointerdown",()=>{
  if(!game.running)return;
  player.buffer=0.12;
});

// ===== SPAWN ENEMY =====
function spawnEnemy(){
  const img=IMG.enemies[(Math.random()*IMG.enemies.length)|0];
  const h=100, s=h/img.height;
  enemies.push({
    img,
    x:W+40,
    y:game.groundY-h+8,
    w:img.width*s,
    h
  });
  enemyT=rand(1.1,1.8);
}

// ===== SPAWN PLATFORM =====
function spawnPlatform(){
  const widths=[120,160,200];
  const w=widths[(Math.random()*widths.length)|0];
  platforms.push({
    x:W+40,
    y:rand(game.groundY-220,game.groundY-120),
    w,
    h:26
  });
  platformT=rand(2.4,3.4);
}

// ===== UPDATE =====
function update(dt){
  if(!game.running)return;

  game.time+=dt;
  game.score+=dt*10;
  game.speed=clamp(420+game.time*6,420,760);

  // gravity
  player.vy+=game.gravity*dt;
  player.y+=player.vy*dt;

  let landed=false;
  const prevY=player.y-player.vy*dt;

  // platform collision
  for(const p of platforms){
    const falling=prevY+player.h<=p.y && player.y+player.h>=p.y;
    const within=player.x+player.w*0.6>p.x && player.x+player.w*0.4<p.x+p.w;
    if(falling && within){
      player.y=p.y-player.h;
      player.vy=0;
      player.onGround=true;
      player.coyote=0.12;
      landed=true;
    }
  }

  // ground
  const ground=game.groundY-player.h;
  if(!landed && player.y>=ground){
    player.y=ground;
    player.vy=0;
    player.onGround=true;
    player.coyote=0.12;
  }else if(!landed){
    player.onGround=false;
    player.coyote-=dt;
  }

  // jump buffer
  if(player.buffer>0){
    player.buffer-=dt;
    if(player.coyote>0){
      player.vy=-980;
      player.buffer=0;
      player.coyote=0;
    }
  }

  // animation
  if(!player.onGround){
    player.anim=player.vy<0?"jump":"fall";
  }else{
    player.anim="run";
  }

  if(player.anim==="run"){
    player.ft+=dt;
    if(player.ft>player.fr){
      player.ft=0;
      player.frame=(player.frame+1)%IMG.run.length;
    }
  }

  // spawn
  enemyT-=dt;
  if(enemyT<=0) spawnEnemy();

  platformT-=dt;
  if(platformT<=0) spawnPlatform();

  enemies.forEach(e=>e.x-=game.speed*dt);
  platforms.forEach(p=>p.x-=game.speed*dt);

  enemies=enemies.filter(e=>e.x+e.w>-50);
  platforms=platforms.filter(p=>p.x+p.w>-50);

  // collisions
  const pHit={
    x:player.x+player.w*0.2,
    y:player.y+player.h*0.1,
    w:player.w*0.6,
    h:player.h*0.85
  };

  for(const e of enemies){
    const eHit={
      x:e.x+e.w*0.15,
      y:e.y+e.h*0.15,
      w:e.w*0.7,
      h:e.h*0.7
    };
    if(rectHit(pHit,eHit)){
      game.over=true;
      game.shake=12;
      statusEl.textContent="Game Over — Press R";
    }
  }

  game.shake*=0.9;
}

// ===== DRAW =====
function draw(){
  ctx.save();
  if(game.shake>0){
    ctx.translate(rand(-game.shake,game.shake),rand(-game.shake,game.shake));
  }

  // sky
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,"#7dd3fc");
  sky.addColorStop(1,"#e0f2fe");
  ctx.fillStyle=sky;
  ctx.fillRect(0,0,W,H);

  // mountains
  ctx.fillStyle="#cbd5f5";
  for(let i=0;i<6;i++){
    ctx.beginPath();
    ctx.moveTo(i*260-(game.time*20)%260,game.groundY);
    ctx.lineTo(i*260+130,game.groundY-160);
    ctx.lineTo(i*260+260,game.groundY);
    ctx.fill();
  }

  // ground
  ctx.fillStyle="#e5e7eb";
  ctx.fillRect(0,game.groundY,W,H-game.groundY);

  // platforms
  platforms.forEach(p=>{
    ctx.fillStyle="#f8fafc";
    ctx.fillRect(p.x,p.y,p.w,p.h);
    ctx.fillStyle="#cbd5e1";
    ctx.fillRect(p.x,p.y+p.h-6,p.w,6);
  });

  // player
  let img=IMG.idle;
  if(player.anim==="run") img=IMG.run[player.frame];
  if(player.anim==="jump") img=IMG.jump;
  if(player.anim==="fall") img=IMG.fall;
  ctx.drawImage(img,player.x,player.y,player.w,player.h);

  // enemies
  enemies.forEach(e=>ctx.drawImage(e.img,e.x,e.y,e.w,e.h));

  // UI
  ctx.fillStyle="#0f172a";
  ctx.font="bold 22px system-ui";
  ctx.fillText(`Score: ${Math.floor(game.score)}`,20,30);

  if(game.over){
    ctx.fillStyle="rgba(0,0,0,0.5)";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#fff";
    ctx.font="bold 44px system-ui";
    ctx.fillText("GAME OVER",W/2-150,H/2);
  }

  ctx.restore();
}

// ===== LOOP =====
let last=performance.now();
function loop(t){
  const dt=(t-last)/1000;
  last=t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ===== BOOT =====
(async()=>{
  statusEl.textContent="Loading...";
  try{
    const [idle,jump,fall,...rest]=await Promise.all([
      load(FILES.idle),
      load(FILES.jump),
      load(FILES.fall),
      ...FILES.run.map(load),
      ...FILES.enemies.map(load)
    ]);
    IMG={
      idle,
      jump,
      fall,
      run:rest.slice(0,7),
      enemies:rest.slice(7)
    };
    reset();
    requestAnimationFrame(loop);
  }catch{
    statusEl.textContent="Error loading images";
  }
})();
